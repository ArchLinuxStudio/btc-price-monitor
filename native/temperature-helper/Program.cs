using System;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using LibreHardwareMonitor.Hardware;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace CryptoTop.TemperatureHelper;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test")
            return SelfTest.Run();
        if (args.Length == 1 && args[0] == "--probe")
        {
            using var sampler = new TemperatureSampler();
            Write(sampler.Sample());
            return 0;
        }
        if (args.Length != 0)
            return 2;

        // The foreground thread owns stdin lifetime. EOF terminates this process
        // even if a third-party hardware call stalls on the background worker.
        // Only one request may be pending, and only this worker touches hardware.
        var requests = new SemaphoreSlim(0, 1);
        var worker = new Thread(() =>
        {
            using var sampler = new TemperatureSampler();
            while (true)
            {
                requests.Wait();
                try { Write(sampler.Sample()); }
                catch (System.IO.IOException) { return; }
            }
        }) { IsBackground = true, Name = "temperature-reader" };
        worker.Start();
        string? line;
        while ((line = Console.ReadLine()) != null)
        {
            if (line != "sample")
                return 2;
            try { requests.Release(); }
            catch (SemaphoreFullException) { return 2; }
        }
        return 0;
    }

    private static void Write(Snapshot snapshot)
    {
        Console.WriteLine(new JavaScriptSerializer().Serialize(snapshot));
        Console.Out.Flush();
    }
}

internal sealed class Snapshot
{
    public long sampledAtMs { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public double? cpuTemperatureC { get; set; }
    public double? memoryTemperatureC { get; set; }
    public string cpuStatus { get; set; } = "unavailable";
    public string memoryStatus { get; set; } = "unavailable";

    internal static Snapshot Failure(string status) => new Snapshot
    {
        cpuStatus = status,
        memoryStatus = status
    };
}

internal sealed class TemperatureSampler : IDisposable
{
    private Computer? computer;
    private DateTime nextOpenAttempt;

    public Snapshot Sample()
    {
        var sample = new Snapshot();
        try
        {
            // Check the registry afresh so installing the driver can recover on
            // the next request. No service/driver installation or elevation here.
            if (!IsDriverInstalled())
                return Snapshot.Failure("driver-missing");
            var accessError = CheckDriverAccess();
            if (accessError != null)
                return Snapshot.Failure(accessError);

            if (computer == null)
            {
                if (DateTime.UtcNow < nextOpenAttempt)
                    return Snapshot.Failure("error");
                nextOpenAttempt = DateTime.UtcNow.AddSeconds(30);
                computer = new Computer { IsCpuEnabled = true, IsMemoryEnabled = true };
                computer.Open();
            }

            foreach (var hardware in computer.Hardware)
                ReadHardware(hardware, sample);
            if (sample.cpuTemperatureC.HasValue)
                sample.cpuStatus = "available";
            if (sample.memoryTemperatureC.HasValue)
                sample.memoryStatus = "available";
            return sample;
        }
        catch
        {
            Dispose();
            return new Snapshot
            {
                sampledAtMs = sample.sampledAtMs,
                cpuStatus = "error",
                memoryStatus = "error"
            };
        }
    }

    private static bool IsDriverInstalled()
    {
        using var registry = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
        using var key = registry.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO");
        return Version.TryParse(key?.GetValue("DisplayVersion") as string, out _)
            && LibreHardwareMonitor.PawnIo.PawnIo.IsInstalled;
    }

    private static string? CheckDriverAccess()
    {
        // Match LHM's device-open flags. Check effective device access rather
        // than guessing from the account's group membership; never change ACLs.
        using var handle = CreateFile(@"\\?\GLOBALROOT\Device\PawnIO", 3, 3, IntPtr.Zero, 3, 128, IntPtr.Zero);
        if (!handle.IsInvalid)
            return null;
        return Marshal.GetLastWin32Error() == 5 ? "permission-required" : "error";
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint desiredAccess, uint shareMode,
        IntPtr securityAttributes, uint creationDisposition, uint flags, IntPtr templateFile);

    private static void ReadHardware(IHardware hardware, Snapshot sample)
    {
        var kind = hardware.HardwareType;
        if (kind != HardwareType.Cpu && kind != HardwareType.Memory)
            return;
        try
        {
            if (kind == HardwareType.Cpu && hardware.GetType().Name.StartsWith("Amd", StringComparison.Ordinal))
            {
                // LHM's AMD Execute wrapper returns zero-filled buffers on IOCTL
                // failure. Never publish those unchecked library temperatures.
                sample.cpuTemperatureC = Highest(sample.cpuTemperatureC, CheckedAmdTemperature.Read(hardware));
                return;
            }
            // LHM 0.9.6 DIMM updates retain the previous Value when a read fails.
            // Clear only the library's in-memory reading before refresh. The
            // public Value setter is on an internal concrete Sensor class; this
            // pinned reflection does not issue any hardware write/control call.
            foreach (var sensor in hardware.Sensors.Where(sensor => IsCandidate(hardware, sensor)))
                ClearReading(sensor);
            hardware.Update();
            foreach (var sensor in hardware.Sensors.Where(sensor => IsCandidate(hardware, sensor)))
            {
                double? value = ValidTemperature(sensor.Value);
                if (kind == HardwareType.Cpu)
                    sample.cpuTemperatureC = Highest(sample.cpuTemperatureC, value);
                else
                    sample.memoryTemperatureC = Highest(sample.memoryTemperatureC, value);
            }
        }
        catch
        {
            if (kind == HardwareType.Cpu)
                sample.cpuStatus = "error";
            else
                sample.memoryStatus = "error";
        }
        foreach (var child in hardware.SubHardware)
            ReadHardware(child, sample);
    }

    private static bool IsCandidate(IHardware hardware, ISensor sensor) => IsCandidate(
        hardware.HardwareType, hardware.Identifier.ToString(), sensor.SensorType, sensor.Index, sensor.Name);

    internal static bool IsCandidate(HardwareType hardwareType, string identifier,
        SensorType sensorType, int index, string name)
    {
        if (sensorType != SensorType.Temperature)
            return false;
        if (hardwareType == HardwareType.Memory)
            return identifier.StartsWith("/memory/dimm/", StringComparison.Ordinal) && index == 0;
        return hardwareType == HardwareType.Cpu
            && name.IndexOf("Distance", StringComparison.OrdinalIgnoreCase) < 0
            && name.IndexOf("Limit", StringComparison.OrdinalIgnoreCase) < 0;
    }

    internal static void ClearReading(object sensor)
    {
        var property = sensor.GetType().GetProperty("Value", BindingFlags.Instance | BindingFlags.Public);
        if (property?.SetMethod == null)
            throw new InvalidOperationException("Unsupported temperature sensor API");
        property.SetValue(sensor, null);
        if (sensor is ISensor hardwareSensor)
            hardwareSensor.ValuesTimeWindow = TimeSpan.Zero;
    }

    internal static double? ValidTemperature(float? value) => value.HasValue
        && !float.IsNaN(value.Value) && !float.IsInfinity(value.Value)
        && value >= -20 && value <= 150 ? (double?)value.Value : null;

    internal static double? Highest(double? first, double? second) =>
        first.HasValue && second.HasValue ? Math.Max(first.Value, second.Value) : first ?? second;

    public void Dispose()
    {
        var old = computer;
        computer = null;
        try { old?.Close(); }
        catch { /* OS process teardown also releases device handles. */ }
    }
}

// Register addresses/conversions follow LibreHardwareMonitor's MPL-2.0 sources:
// https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/v0.9.6/LibreHardwareMonitorLib/Hardware/Cpu
// Copyright (C) LibreHardwareMonitor contributors and Michael Moller.
// This adapter adds checked IOCTL results without modifying the upstream library.
internal static class CheckedAmdTemperature
{
    private const BindingFlags InstanceFields = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
    private static readonly Assembly Library = typeof(Computer).Assembly;
    private static readonly MethodInfo WaitPci = StaticMethod("LibreHardwareMonitor.Hardware.Mutexes", "WaitPciBus");
    private static readonly MethodInfo ReleasePci = StaticMethod("LibreHardwareMonitor.Hardware.Mutexes", "ReleasePciBus");
    private static readonly MethodInfo SetAffinity = StaticMethod("LibreHardwareMonitor.Hardware.ThreadAffinity", "Set");

    internal static double? Read(IHardware hardware)
    {
        var wrapper = Field(hardware, "_pawnModule");
        var pawn = (LibreHardwareMonitor.PawnIo.PawnIo)(FindField(wrapper.GetType(), "_pawnIo")
            ?? FindField(wrapper.GetType(), "_pawnIO")
            ?? throw new InvalidOperationException("Unsupported AMD module API")).GetValue(wrapper)!;
        if (!pawn.IsLoaded) return null;

        var cpus = (Array)Field(hardware, "_cpuId");
        var firstCore = (Array)cpus.GetValue(0)!;
        var cpu = firstCore.GetValue(0)!;
        var affinity = (GroupAffinity)cpu.GetType().GetProperty("Affinity")!.GetValue(cpu)!;
        var previous = (GroupAffinity)SetAffinity.Invoke(null, new object[] { affinity })!;
        if (previous == GroupAffinity.Undefined) return null;
        try
        {
            if (!(bool)WaitPci.Invoke(null, new object[] { 10 })!) return null;
            try { return ReadLocked(hardware, pawn); }
            finally { ReleasePci.Invoke(null, null); }
        }
        finally { SetAffinity.Invoke(null, new object[] { previous }); }
    }

    private static double? ReadLocked(IHardware hardware, LibreHardwareMonitor.PawnIo.PawnIo pawn)
    {
        var type = hardware.GetType().Name;
        if (type == "Amd17Cpu")
        {
            // Same signed module, address and conversion as pinned LHM 0.9.6.
            // Derive directly from the checked result, avoiding a preflight/read race.
            var raw = ReadRegister(pawn, "ioctl_read_smn", 0x59800);
            double? highest = raw.HasValue ? ZenTemperature(raw.Value) : null;
            uint model = (uint)Field(hardware, "_model");
            if (model is 0x31 or 0x71 or 0x21 or 0x61 or 0x44)
            {
                uint address = model is 0x61 or 0x44 ? 0x59b08u : 0x59954u;
                for (int i = 0; i < 8; i++)
                {
                    var ccd = ReadRegister(pawn, "ioctl_read_smn", address + i * 4);
                    if (ccd.HasValue) highest = TemperatureSampler.Highest(highest, CcdTemperature(ccd.Value));
                }
            }
            return highest;
        }

        int index = (int)hardware.GetType().GetProperty("Index")!.GetValue(hardware)!;
        if (type == "Amd10Cpu")
        {
            bool useSmu = (bool)Field(hardware, "_hasSmuTemperatureRegister");
            var raw = useSmu
                ? ReadRegister(pawn, "ioctl_read_smu", 0xD8200CA4)
                : ReadRegister(pawn, "ioctl_read_miscctl", index, 0xA4);
            if (!raw.HasValue) return null;
            var sensor = (ISensor)Field(hardware, "_coreTemperature");
            // LHM 0.9.6's extended-range condition is inconsistent. Decline that
            // legacy range rather than invent an offset or accept a wrong value.
            uint family = (uint)Field(hardware, "_family");
            if ((family is 0x15 or 0x16) && (raw.Value & 0x30000) != 0) return null;
            return TemperatureSampler.ValidTemperature(((raw.Value >> 21) & 0x7FF) / 8f + sensor.Parameters[0].Value);
        }
        if (type == "Amd0FCpu")
        {
            double? highest = null;
            foreach (ISensor sensor in (Array)Field(hardware, "_coreTemperatures"))
            {
                var raw = ReadRegister(pawn, "ioctl_get_thermtrip", index, sensor.Index);
                if (raw.HasValue)
                    highest = TemperatureSampler.Highest(highest, TemperatureSampler.ValidTemperature(
                        ((raw.Value >> 16) & 0xFF) + sensor.Parameters[0].Value));
            }
            return highest;
        }
        return null;
    }

    private static uint? ReadRegister(LibreHardwareMonitor.PawnIo.PawnIo pawn, string command, params long[] input)
    {
        if (!pawn.IsLoaded) return null;
        long[] output = new long[1];
        int hr = pawn.ExecuteHr(command, input, (uint)input.Length, output, 1, out uint count);
        return CheckedResult(pawn.IsLoaded, hr, count, output[0]);
    }

    internal static uint? CheckedResult(bool loaded, int hr, uint count, long value) =>
        loaded && hr == 0 && count == 1 && value >= 0 && value <= uint.MaxValue ? (uint?)value : null;

    internal static double? ZenTemperature(uint raw) => TemperatureSampler.ValidTemperature(
        (raw >> 21) * 0.125f - ((raw & 0x80000) != 0 ? 49f : 0f));

    internal static double? CcdTemperature(uint raw)
    {
        raw &= 0xFFF;
        float value = raw * 0.125f - 305f;
        return raw > 0 && value < 125 ? TemperatureSampler.ValidTemperature(value) : null;
    }

    private static MethodInfo StaticMethod(string type, string name) =>
        Library.GetType(type, true)!.GetMethod(name, BindingFlags.Static | BindingFlags.Public)
        ?? throw new InvalidOperationException("Unsupported AMD synchronization API");

    private static FieldInfo? FindField(Type type, string name)
    {
        for (Type? current = type; current != null; current = current.BaseType)
        {
            var field = current.GetField(name, InstanceFields | BindingFlags.DeclaredOnly);
            if (field != null) return field;
        }
        return null;
    }

    private static object Field(object value, string name) =>
        FindField(value.GetType(), name)?.GetValue(value)
        ?? throw new InvalidOperationException("Unsupported AMD hardware metadata");

    internal static void VerifyPinnedApi()
    {
        foreach (var name in new[] { "Amd17Cpu", "Amd10Cpu", "Amd0FCpu" })
        {
            var type = Library.GetType("LibreHardwareMonitor.Hardware.Cpu." + name, true)!;
            var module = FindField(type, "_pawnModule") ?? throw new InvalidOperationException("Missing AMD module");
            if ((FindField(module.FieldType, "_pawnIo") ?? FindField(module.FieldType, "_pawnIO"))?.FieldType
                != typeof(LibreHardwareMonitor.PawnIo.PawnIo)) throw new InvalidOperationException("Missing PawnIO handle");
            if (FindField(type, "_cpuId") == null || type.GetProperty("Index") == null)
                throw new InvalidOperationException("Missing CPU identity");
            string[] fields = name switch
            {
                "Amd17Cpu" => new[] { "_model" },
                "Amd10Cpu" => new[] { "_family", "_hasSmuTemperatureRegister", "_coreTemperature" },
                _ => new[] { "_coreTemperatures" }
            };
            foreach (var field in fields)
                if (FindField(type, field) == null) throw new InvalidOperationException("Missing AMD thermal metadata");
        }
        if (Library.GetType("LibreHardwareMonitor.Hardware.Cpu.CpuId", true)!.GetProperty("Affinity")?.PropertyType
            != typeof(GroupAffinity)) throw new InvalidOperationException("Missing CPU affinity");
    }
}

internal static class SelfTest
{
    private sealed class Reading { public float? Value { get; set; } = 52; }

    public static int Run()
    {
        Check(TemperatureSampler.IsCandidate(HardwareType.Memory, "/memory/dimm/0", SensorType.Temperature, 0, "DIMM #0"));
        for (int index = 1; index <= 5; index++)
            Check(!TemperatureSampler.IsCandidate(HardwareType.Memory, "/memory/dimm/0", SensorType.Temperature, index, "Thermal Sensor High Limit"));
        Check(!TemperatureSampler.IsCandidate(HardwareType.GpuNvidia, "/gpu-nvidia/0", SensorType.Temperature, 0, "GPU Memory"));
        Check(!TemperatureSampler.IsCandidate(HardwareType.Memory, "/ram", SensorType.Temperature, 0, "Memory"));
        Check(!TemperatureSampler.IsCandidate(HardwareType.Cpu, "/intelcpu/0", SensorType.Temperature, 2, "Core Distance to TjMax"));
        Check(TemperatureSampler.IsCandidate(HardwareType.Cpu, "/intelcpu/0", SensorType.Temperature, 0, "CPU Package"));
        Check(TemperatureSampler.ValidTemperature(float.NaN) == null);
        Check(TemperatureSampler.ValidTemperature(float.PositiveInfinity) == null);
        Check(TemperatureSampler.ValidTemperature(151) == null);
        Check(TemperatureSampler.ValidTemperature(48) == 48);
        Check(TemperatureSampler.Highest(40, 60) == 60);
        Check(TemperatureSampler.Highest(null, 60) == 60);
        Check(TemperatureSampler.Highest(null, null) == null);
        var stale = new Reading();
        TemperatureSampler.ClearReading(stale);
        Check(stale.Value == null); // A failed refresh cannot re-publish old data.
        var sensorType = typeof(Computer).Assembly.GetType("LibreHardwareMonitor.Hardware.Sensor", true)!;
        Check(sensorType.GetProperty("Value", BindingFlags.Instance | BindingFlags.Public)?.SetMethod != null);
        var dimmSensorType = typeof(Computer).Assembly.GetType("LibreHardwareMonitor.Hardware.Memory.Sensors.SpdThermalSensor", true)!;
        Check(dimmSensorType.GetProperty("Value", BindingFlags.Instance | BindingFlags.Public)?.SetMethod != null);
        var sample = Snapshot.Failure("driver-missing");
        var json = new JavaScriptSerializer().Serialize(sample);
        var decoded = new JavaScriptSerializer().Deserialize<Snapshot>(json);
        Check(decoded.cpuTemperatureC == null && decoded.memoryTemperatureC == null);
        Check(decoded.cpuStatus == "driver-missing" && decoded.sampledAtMs > 0);
        CheckedAmdTemperature.VerifyPinnedApi();
        Check(CheckedAmdTemperature.CheckedResult(false, 0, 0, 0) == null);
        Check(CheckedAmdTemperature.CheckedResult(true, unchecked((int)0x80070005), 1, 0) == null);
        Check(CheckedAmdTemperature.CheckedResult(true, 0, 0, 0) == null);
        Check(CheckedAmdTemperature.CheckedResult(true, 0, 2, 42) == null);
        Check(CheckedAmdTemperature.CheckedResult(true, 0, 1, 0) == 0); // A successful zero is not a failed read.
        Check(CheckedAmdTemperature.CheckedResult(true, 0, 1, 0x19000000) == 0x19000000);
        Check(CheckedAmdTemperature.ZenTemperature(400u << 21) == 50);
        Check(CheckedAmdTemperature.ZenTemperature((800u << 21) | 0x80000) == 51);
        Check(CheckedAmdTemperature.CcdTemperature(0) == null);
        Check(CheckedAmdTemperature.CcdTemperature(2840) == 50);
        Console.WriteLine("Temperature helper self-tests passed.");
        return 0;
    }

    private static void Check(bool success)
    {
        if (!success)
            throw new InvalidOperationException("Temperature helper self-test failed.");
    }
}
