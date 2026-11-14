param([Parameter(Mandatory = $true)][string]$InstallPath)
$ErrorActionPreference = 'Stop'
$expected = [IO.Path]::GetFullPath((Join-Path $InstallPath 'crypto-top-monitor.exe'))
$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$folder = $scheduler.GetFolder('\')
foreach ($task in @($folder.GetTasks(1))) {
    if (!$task.Name.StartsWith('com.cryptotop.monitor.', [StringComparison]::Ordinal)) { continue }
    $definition = $task.Definition
    if ($definition.RegistrationInfo.URI -ne 'com.cryptotop.monitor/autostart/v1') { continue }
    if ($definition.Actions.Count -ne 1) { continue }
    $action = $definition.Actions.Item(1)
    if ($action.Type -ne 0) { continue }
    if (![StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($action.Path), $expected)) { continue }
    $folder.DeleteTask($task.Name, 0)
}
