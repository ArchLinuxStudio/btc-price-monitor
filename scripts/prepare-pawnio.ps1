$ErrorActionPreference = 'Stop'
# npm can pass a PowerShell 7 module path into Windows PowerShell 5.1. Load
# these built-ins from this host so hashing/signature checks stay available.
foreach ($module in @('Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Security')) {
    Import-Module (Join-Path $PSHOME "Modules/$module/$module.psd1") -Force
}
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$metadata = Get-Content -LiteralPath (Join-Path $repoRoot 'native/pawnio/dependency.json') -Raw | ConvertFrom-Json
$output = Join-Path $repoRoot 'src-tauri/resources/pawnio'
$installer = Join-Path $output 'PawnIO_setup.exe'
New-Item -ItemType Directory -Force -Path $output | Out-Null

function Assert-PawnIOInstaller([string]$Path) {
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $metadata.sha256) {
        throw 'PawnIO dependency hash mismatch; refusing to package it.'
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $metadata.signerThumbprint) {
        throw 'PawnIO dependency publisher signature is invalid; refusing to package it.'
    }
}

if (!(Test-Path -LiteralPath $installer)) {
    $pending = Join-Path $output 'PawnIO_setup.download'
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $metadata.url -OutFile $pending
        Assert-PawnIOInstaller $pending
        Move-Item -LiteralPath $pending -Destination $installer -Force
    } finally {
        if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force }
    }
} else {
    Assert-PawnIOInstaller $installer
}

Write-Host "Prepared unmodified PawnIO $($metadata.version) dependency. No installer was executed."
