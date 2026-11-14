//! Narrow Task Scheduler adapter. Executable paths are data, never PowerShell source.
//!
//! InteractiveToken + Highest supports the administrator manifest at user login
//! without storing a password or launching a SYSTEM/session-zero process.

#[cfg(windows)]
pub(super) enum Operation {
    Query,
    Enable,
    Disable,
    Migrate,
}

#[cfg(windows)]
impl Operation {
    fn name(&self) -> &'static str {
        match self {
            Self::Query => "query",
            Self::Enable => "enable",
            Self::Disable => "disable",
            Self::Migrate => "migrate",
        }
    }
}

// Only these two environment values cross the boundary. The script itself is
// compile-time fixed; no Invoke-Expression, shell-built path or arbitrary XML.
const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function Remove-LegacyRun {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run', $true)
    if ($null -ne $key) {
        try { $key.DeleteValue('com.cryptotop.monitor', $false) } finally { $key.Dispose() }
    }
}
function Get-LegacyRun {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run', $false)
    if ($null -eq $key) { return $false }
    try {
        $value = $key.GetValue('com.cryptotop.monitor', $null)
        if ($null -eq $value) { return $false }
        if ($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value)) { throw 'Legacy startup entry is invalid.' }
        # A nonempty legacy entry records the prior explicit opt-in. Do not run
        # or copy its command: migration always uses the current trusted exe.
        return $true
    } finally { $key.Dispose() }
}
function Get-ProductTask {
    param($folder, $name)
    try { return $folder.GetTask($name) }
    catch {
        $errorCode = $_.Exception.HResult
        if ($null -ne $_.Exception.InnerException) { $errorCode = $_.Exception.InnerException.HResult }
        if ($errorCode -eq -2147024894) { return $null } # HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)
        throw
    }
}
function Test-Identity {
    param($identity, $sid)
    try {
        if ($identity -match '^S-1-') {
            $resolved = [Security.Principal.SecurityIdentifier]::new($identity).Value
        } else {
            $resolved = [Security.Principal.NTAccount]::new($identity).Translate([Security.Principal.SecurityIdentifier]).Value
        }
        return $resolved -eq $sid
    } catch { return $false }
}
function Assert-OwnedTask {
    param($task, $sid)
    $definition = $task.Definition
    if ($definition.RegistrationInfo.URI -ne 'com.cryptotop.monitor/autostart/v1' -or
        !(Test-Identity $definition.Principal.UserId $sid) -or
        $definition.Actions.Count -ne 1 -or $definition.Actions.Item(1).Type -ne 0 -or
        [IO.Path]::GetFileName($definition.Actions.Item(1).Path) -ne 'crypto-top-monitor.exe' -or
        ![string]::IsNullOrEmpty($definition.Actions.Item(1).Arguments)) {
        throw 'The startup task does not match Crypto Top. It was left unchanged.'
    }
}
function Test-CurrentTask {
    param($task, $sid, $exe)
    if (!$task.Enabled) { return $false }
    $definition = $task.Definition
    if ($definition.Principal.LogonType -ne 3 -or $definition.Principal.RunLevel -ne 1 -or
        $definition.Triggers.Count -ne 1 -or $definition.Triggers.Item(1).Type -ne 9 -or
        !$definition.Triggers.Item(1).Enabled -or !(Test-Identity $definition.Triggers.Item(1).UserId $sid) -or
        ![StringComparer]::OrdinalIgnoreCase.Equals($definition.Actions.Item(1).Path, $exe)) {
        throw 'The startup task requires migration. Reopen Settings to retry.'
    }
    return $true
}
function Assert-ProtectedExecutable {
    param($exe)
    $inside = $false
    $machine = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
    $folders = $machine.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion')
    try { $roots = @($folders.GetValue('ProgramFilesDir'), $folders.GetValue('ProgramFilesDir (x86)')) }
    finally { if ($null -ne $folders) { $folders.Dispose() }; $machine.Dispose() }
    foreach ($root in $roots) {
        if ($root -and $exe.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { $inside = $true }
    }
    if (!$inside -or ![IO.File]::Exists($exe) -or [IO.Path]::GetFileName($exe) -ne 'crypto-top-monitor.exe') {
        throw 'Install Crypto Top in Program Files before enabling administrator startup.'
    }
    # Do not schedule an elevated executable through a directory junction/link
    # into a user-writable location, even if its textual path is under Program Files.
    $entry = Get-Item -LiteralPath $exe -Force
    while ($null -ne $entry) {
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked startup paths are not supported.' }
        if ($entry -is [IO.FileInfo]) { $entry = $entry.Directory } else { $entry = $entry.Parent }
    }
}
function Register-ProductTask {
    param($service, $folder, $name, $sid, $exe)
    Assert-ProtectedExecutable $exe
    $definition = $service.NewTask(0)
    $definition.RegistrationInfo.URI = 'com.cryptotop.monitor/autostart/v1'
    $definition.RegistrationInfo.Description = 'Crypto Top: administrator monitor at this user logon'
    $definition.Principal.UserId = $sid
    $definition.Principal.LogonType = 3 # TASK_LOGON_INTERACTIVE_TOKEN
    $definition.Principal.RunLevel = 1 # TASK_RUNLEVEL_HIGHEST
    $definition.Settings.Enabled = $true
    $definition.Settings.AllowDemandStart = $true
    $definition.Settings.StartWhenAvailable = $true
    $definition.Settings.DisallowStartIfOnBatteries = $false
    $definition.Settings.StopIfGoingOnBatteries = $false
    $definition.Settings.ExecutionTimeLimit = 'PT0S'
    $definition.Settings.MultipleInstances = 2 # TASK_INSTANCES_IGNORE_NEW
    $trigger = $definition.Triggers.Create(9) # TASK_TRIGGER_LOGON
    $trigger.UserId = $sid
    $trigger.Enabled = $true
    $action = $definition.Actions.Create(0) # TASK_ACTION_EXEC
    $action.Path = $exe
    $action.WorkingDirectory = [IO.Path]::GetDirectoryName($exe)
    # Administrator/SYSTEM may update; the current user's unelevated token can
    # read/run but cannot replace a privileged action with arbitrary code.
    $sddl = 'O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;' + $sid + ')'
    # TASK_CREATE_OR_UPDATE | TASK_DONT_ADD_PRINCIPAL_ACE: preserve the exact
    # restricted principal access above instead of adding a scheduler default.
    $null = $folder.RegisterTaskDefinition($name, $definition, 0x16, $sid, $null, 3, $sddl)
}
try {
    $operation = $env:CRYPTOTOP_STARTUP_OPERATION
    if ($operation -notin @('query', 'enable', 'disable', 'migrate')) { throw 'Invalid startup operation.' }
    $exe = [IO.Path]::GetFullPath($env:CRYPTOTOP_STARTUP_EXECUTABLE)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $name = 'com.cryptotop.monitor.' + $sid
    $service = New-Object -ComObject 'Schedule.Service'
    $service.Connect()
    $folder = $service.GetFolder('\')
    $task = Get-ProductTask $folder $name
    if ($null -ne $task) { Assert-OwnedTask $task $sid }
    $legacy = Get-LegacyRun
    if ($operation -eq 'disable') {
        if ($null -ne $task) { $folder.DeleteTask($name, 0) }
        Remove-LegacyRun
        [Console]::WriteLine('false')
    } elseif ($operation -eq 'enable') {
        Register-ProductTask $service $folder $name $sid $exe
        $task = Get-ProductTask $folder $name
        if ($null -eq $task) { throw 'Task Scheduler did not retain the startup task.' }
        Assert-OwnedTask $task $sid
        $enabled = Test-CurrentTask $task $sid $exe
        if (!$enabled) { throw 'Task Scheduler did not enable the startup task.' }
        Remove-LegacyRun
        [Console]::WriteLine('true')
    } elseif ($operation -eq 'migrate') {
        if ($null -ne $task -and !$task.Enabled) {
            # An explicitly disabled task overrides an obsolete Run value.
            Remove-LegacyRun
            [Console]::WriteLine('false')
        } elseif ($null -ne $task -or $legacy) {
            $needsMigration = $legacy
            if ($null -ne $task) {
                try { $null = Test-CurrentTask $task $sid $exe } catch { $needsMigration = $true }
            }
            if ($needsMigration) {
                Register-ProductTask $service $folder $name $sid $exe
                $task = Get-ProductTask $folder $name
                if ($null -eq $task) { throw 'Task Scheduler did not retain the migrated task.' }
                Assert-OwnedTask $task $sid
                if (!(Test-CurrentTask $task $sid $exe)) { throw 'Task Scheduler did not enable the migrated task.' }
                Remove-LegacyRun
            }
            [Console]::WriteLine('true')
        } else { [Console]::WriteLine('false') }
    } else {
        if ($null -ne $task) { [Console]::WriteLine((Test-CurrentTask $task $sid $exe).ToString().ToLowerInvariant()) }
        elseif ($legacy) { throw 'Legacy startup registration requires migration. Reopen Settings to retry.' }
        else { [Console]::WriteLine('false') }
    }
    exit 0
} catch {
    $message = $_.Exception.Message
    if ($message.Length -gt 500) { $message = $message.Substring(0, 500) }
    [Console]::WriteLine('ERROR: ' + $message)
    exit 1
}
"#;

#[cfg(windows)]
pub(super) fn run(operation: Operation, executable: &std::path::Path) -> Result<bool, String> {
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let executable = executable
        .to_str()
        .ok_or("startup executable is not valid Unicode")?;
    validate_path(executable)?;
    let mut child = Command::new(system_powershell()?)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &encode_script(SCRIPT),
        ])
        .env("CRYPTOTOP_STARTUP_OPERATION", operation.name())
        .env("CRYPTOTOP_STARTUP_EXECUTABLE", executable)
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;
    let begin = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if begin.elapsed() < Duration::from_secs(20) => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Windows startup registration timed out or became unavailable".into());
            }
        }
    };
    let mut output = String::new();
    if let Some(stdout) = child.stdout.take() {
        stdout
            .take(2048)
            .read_to_string(&mut output)
            .map_err(|error| error.to_string())?;
    }
    parse_response(status.success(), &output)
}

#[cfg(windows)]
fn system_powershell() -> Result<std::path::PathBuf, String> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemDirectoryW(buffer: *mut u16, size: u32) -> u32;
    }
    let mut buffer = [0_u16; 32768];
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length == 0 || length >= buffer.len() {
        return Err("Windows system directory is unavailable".into());
    }
    Ok(std::path::PathBuf::from(
        String::from_utf16(&buffer[..length]).map_err(|error| error.to_string())?,
    )
    .join("WindowsPowerShell/v1.0/powershell.exe"))
}

fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.chars().any(|ch| ch == '"' || ch.is_control()) {
        return Err("startup executable path is invalid".into());
    }
    Ok(())
}

fn parse_response(success: bool, output: &str) -> Result<bool, String> {
    match (success, output.trim()) {
        (true, "true") => Ok(true),
        (true, "false") => Ok(false),
        (_, message) if message.starts_with("ERROR: ") => Err(message[7..].to_owned()),
        _ => Err("Windows startup registration returned an invalid response".into()),
    }
}

fn encode_script(script: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut result = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for block in bytes.chunks(3) {
        let a = u32::from(block[0]);
        let b = block.get(1).copied().map(u32::from).unwrap_or(0);
        let c = block.get(2).copied().map(u32::from).unwrap_or(0);
        result.push(TABLE[(a >> 2) as usize] as char);
        result.push(TABLE[(((a & 3) << 4) | (b >> 4)) as usize] as char);
        result.push(if block.len() > 1 {
            TABLE[(((b & 15) << 2) | (c >> 6)) as usize] as char
        } else {
            '='
        });
        result.push(if block.len() > 2 {
            TABLE[(c & 63) as usize] as char
        } else {
            '='
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powershell_encoding_preserves_unicode_without_interpolating_paths() {
        assert_eq!(encode_script("A"), "QQA=");
        assert_eq!(encode_script("AB"), "QQBCAA==");
        assert_eq!(encode_script("中文"), "LU6HZQ==");
        assert!(
            validate_path(r"C:\Program Files\用户 $cash`' & Top\crypto-top-monitor.exe").is_ok()
        );
        assert!(validate_path("bad\"name").is_err());
        assert!(validate_path("bad\nname").is_err());
        assert!(!SCRIPT.contains("Invoke-Expression"));
    }

    #[test]
    fn readback_failures_are_not_reported_as_disabled_or_successful() {
        assert_eq!(parse_response(true, "true\r\n"), Ok(true));
        assert_eq!(parse_response(true, "false"), Ok(false));
        assert!(parse_response(false, "true").is_err());
        assert!(parse_response(true, "anything").is_err());
        assert_eq!(
            parse_response(false, "ERROR: access denied"),
            Err("access denied".into())
        );
    }

    #[test]
    fn fixed_task_contract_uses_interactive_user_and_protected_action() {
        assert!(SCRIPT.contains("$definition.Principal.LogonType = 3"));
        assert!(SCRIPT.contains("$definition.Principal.RunLevel = 1"));
        assert!(SCRIPT.contains("$trigger.UserId = $sid"));
        assert!(SCRIPT.contains("$action.Path = $exe"));
        assert!(SCRIPT.contains("Assert-ProtectedExecutable $exe"));
        assert!(SCRIPT.contains("elseif ($null -ne $task -or $legacy)"));
        assert!(!SCRIPT.contains("$action.Arguments ="));
        assert!(encode_script(SCRIPT).len() < 30000);
    }
}
