param([string]$Dotnet = '')

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$project = Join-Path $repoRoot 'native/temperature-helper/TemperatureHelper.csproj'
$output = [IO.Path]::GetFullPath((Join-Path $repoRoot 'src-tauri/resources/temperature-helper'))
$expectedOutput = [IO.Path]::Combine($repoRoot, 'src-tauri', 'resources', 'temperature-helper')

$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'

if (!$Dotnet) {
    $localSdk = Join-Path $repoRoot 'artifacts/dotnet-sdk/dotnet.exe'
    if (Test-Path -LiteralPath $localSdk) { $Dotnet = $localSdk }
    else { $Dotnet = (Get-Command dotnet -ErrorAction Stop).Source }
}

& $Dotnet restore $project --locked-mode
if ($LASTEXITCODE -ne 0) { throw 'Temperature helper dependency restore failed.' }

# This one generated resource directory is the entire deletion scope. Validate
# its absolute path before clearing stale DLLs from earlier dependency versions.
if (![StringComparer]::OrdinalIgnoreCase.Equals($output, $expectedOutput)) {
    throw 'Invalid temperature helper output directory.'
}
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Path $output -Force | Out-Null
& $Dotnet build $project --no-restore --configuration Release --output $output
if ($LASTEXITCODE -ne 0) { throw 'Temperature helper build failed.' }

$licenseOutput = Join-Path $output 'licenses'
New-Item -ItemType Directory -Path $licenseOutput -Force | Out-Null
Copy-Item -Path (Join-Path $repoRoot 'native/temperature-helper/licenses/*') -Destination $licenseOutput
Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination (Join-Path $licenseOutput 'CryptoTop-GPL-3.0.txt')
Copy-Item -LiteralPath (Join-Path $repoRoot 'native/temperature-helper/THIRD-PARTY-NOTICES.md') -Destination $output

# Include exact NuGet copyright/repository/version metadata and package notices,
# using the resolved cache paths rather than assuming a particular user's home.
$assets = Get-Content -LiteralPath (Join-Path $repoRoot 'native/temperature-helper/obj/project.assets.json') -Raw | ConvertFrom-Json
foreach ($entry in $assets.libraries.PSObject.Properties) {
    if ($entry.Value.type -ne 'package' -or $entry.Name.StartsWith('Microsoft.NETFramework.ReferenceAssemblies')) { continue }
    $packagePath = $null
    foreach ($folder in $assets.packageFolders.PSObject.Properties.Name) {
        $candidate = Join-Path $folder $entry.Value.path
        if (Test-Path -LiteralPath $candidate) { $packagePath = $candidate; break }
    }
    if (!$packagePath) { throw "Missing restored package: $($entry.Name)" }
    $noticePath = Join-Path $licenseOutput ($entry.Name.Replace('/', '-'))
    New-Item -ItemType Directory -Path $noticePath -Force | Out-Null
    foreach ($notice in Get-ChildItem -LiteralPath $packagePath -File) {
        if ($notice.Name -match '(?i)(license|copying|notice|readme)|\.nuspec$') {
            Copy-Item -LiteralPath $notice.FullName -Destination $noticePath
        }
    }
}

Write-Host "Temperature helper built: $output"
