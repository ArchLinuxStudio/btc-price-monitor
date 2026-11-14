# Verifies Task Scheduler definitions in memory. Never registers/deletes/runs a task.
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri/src/autostart/windows_task.rs') -Raw
$embedded = [regex]::Match($source, '(?s)const SCRIPT: &str = r#"(.*?)"#;').Groups[1].Value
if (!$embedded) { throw 'Missing embedded startup script.' }
$tokens = $null; $errors = $null
$null = [Management.Automation.Language.Parser]::ParseInput($embedded, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($file in @('native/pawnio/cleanup-tasks.ps1', 'scripts/prepare-pawnio.ps1')) {
    $null = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repoRoot $file), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw ($errors | Out-String) }
}
$body = [regex]::Match($embedded, '(?m)^try \{\r?\n    \$operation')
if (!$body.Success) { throw 'Missing startup script entry point.' }
$definitions = $embedded.Substring(0, $body.Index)
. ([scriptblock]::Create($definitions))
# Override only filesystem preflight; fixture paths deliberately do not exist.
function Assert-ProtectedExecutable { param($exe) $script:checkedPath = $exe }
$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()
$folder = [pscustomobject]@{}
$folder | Add-Member ScriptMethod RegisterTaskDefinition {
    param($name, $definition, $flags, $user, $password, $logon, $sddl)
    if ($null -ne $password -or $flags -ne 0x16 -or $logon -ne 3) { throw 'Unexpected registration contract.' }
    $script:definition = $definition
    $script:permissions = New-Object Security.AccessControl.RawSecurityDescriptor($sddl)
}
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$path = 'C:\Program Files\' + [char]0x6D4B + [char]0x8BD5 + ' & $cash`'' Top\crypto-top-monitor.exe'
Register-ProductTask $service $folder ('com.cryptotop.monitor.' + $sid) $sid $path
if ($script:permissions.Owner.Value -ne 'S-1-5-32-544') { throw 'Task owner must be Administrators.' }
$userAce = @($script:permissions.DiscretionaryAcl | Where-Object { $_.SecurityIdentifier.Value -eq $sid })
if ($userAce.Count -ne 1 -or $userAce[0].AccessMask -ne 0x1200A9) { throw 'Unelevated user must have only read/execute access.' }
[xml]$xml = $script:definition.XmlText
if ($xml.Task.Actions.Exec.Command -ne $path -or $script:checkedPath -ne $path) { throw 'Executable path was not preserved as data.' }
if ($xml.Task.Principals.Principal.RunLevel -ne 'HighestAvailable' -or
    $xml.Task.Principals.Principal.LogonType -ne 'InteractiveToken' -or
    $xml.Task.Triggers.LogonTrigger.UserId -ne $sid -or
    $xml.Task.Settings.ExecutionTimeLimit -ne 'PT0S') { throw 'Invalid login task definition.' }
$task = [pscustomobject]@{ Enabled = $true; Definition = $script:definition }
Assert-OwnedTask $task $sid
if (!(Test-CurrentTask $task $sid $path)) { throw 'Valid task rejected.' }
$task.Enabled = $false
if (Test-CurrentTask $task $sid $path) { throw 'Disabled task reported enabled.' }
$task.Enabled = $true
$failed = $false
try { $null = Test-CurrentTask $task $sid 'C:\wrong.exe' } catch { $failed = $true }
if (!$failed) { throw 'Stale task path accepted.' }
Write-Output 'Windows startup definition, escaping, readback and script parsing passed. No task was registered.'
