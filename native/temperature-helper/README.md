# Windows temperature collector

This small .NET Framework 4.7.2 x64 child process integrates the unmodified
LibreHardwareMonitorLib **0.9.6** NuGet package. The complete graph is pinned by
`packages.lock.json`; no external monitor application or WMI publisher is needed.
Runtime requires .NET Framework 4.7.2 or later (included in modern Windows 10/11). Building
requires .NET SDK 8; it does not require a separately installed reference pack.

Build with `powershell -NoProfile -File scripts/build-temperature-helper.ps1`
from the repository root. The generated `src-tauri/resources/temperature-helper/`
folder is bundled only in Windows packages. Test without accessing hardware:

```powershell
& src-tauri/resources/temperature-helper/CryptoTop.TemperatureHelper.exe --self-test
```

`--probe` performs one read-only sample. Ordinary operation uses redirected stdin
and stdout: each `sample` line requests one JSON response. Fields are
`sampledAtMs`, nullable `cpuTemperatureC` / `memoryTemperatureC`, and `cpuStatus` /
`memoryStatus` (`available`, `driver-missing`, `permission-required`, `unavailable`,
or `error`). The timestamp precedes hardware work. Only one background worker
samples; stdin EOF ends the process even when the worker is stalled. The Rust
parent owns deadlines, hidden process creation and restart backoff.

The helper only enables CPU and memory devices. The footer reports the highest
valid current temperature among the readable CPU sensors / DIMM sensors. Memory
temperature accepts only `/memory/dimm/` hardware and temperature sensor index 0.
Other DDR4/DDR5 temperature fields are **limits or resolution**, not live readings.
CPU distance-to-TjMax measurements are also excluded. Invalid and missing readings
stay null. Before each refresh, the helper clears the in-memory library readings
using the concrete sensor's public `Value` setter, preventing LHM 0.9.6's retained
value on a failed DIMM read from being published as fresh. This is not a device
write; unsupported library APIs fail closed. The dependency version is pinned to
keep that compatibility boundary explicit.

AMD temperatures use checked reads through the same signed PawnIO modules,
under LHM's PCI mutex and the selected processor's thread affinity. The adapter
requires an open module, successful HRESULT and exactly one returned register
before converting a value. This avoids LHM 0.9.6's unchecked AMD wrapper treating
an IOCTL failure as a zero-temperature reading; successful zero values remain
valid. AMD17-family control/CCD temperatures and legacy AMD10/AMD0F core readings
follow the pinned source's addresses and sensor metadata. Unknown metadata and
ambiguous legacy AMD10 extended-range values remain unavailable instead of using
an invented offset. The conversions are based on the
[upstream CPU sources](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/v0.9.6/LibreHardwareMonitorLib/Hardware/Cpu).

## Driver and access

CPU MSR and DIMM SMBus reads require the **PawnIO** driver, supplied by the main
Windows application installer as a separate unmodified official dependency.
The helper checks installation and actual device access before opening hardware.
It never installs a driver, starts a service, prompts for UAC, changes permissions,
or disables any Windows protection. Missing driver and denied access are distinct
statuses. Windows release builds request administrator rights automatically;
debug builds retain ordinary privileges for non-disruptive tests. A detected driver still does not guarantee every DIMM has
a temperature sensor or that every chipset's SMBus is supported.

The installer source is the [official PawnIO project](https://pawnio.eu/); integration uses
LHM's signed modules and does not use WinRing0. See `THIRD-PARTY-NOTICES.md` and
`licenses/` for package licensing and exact source locations.
