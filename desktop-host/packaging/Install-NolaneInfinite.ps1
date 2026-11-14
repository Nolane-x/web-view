[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Programs\NolaneInfiniteBridge")
)

$ErrorActionPreference = "Stop"
$sourceRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$targetRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$sourceExe = Join-Path $sourceRoot "Nolane.DesktopHost.exe"

if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
    throw "Nolane.DesktopHost.exe was not found. Extract the complete Windows ZIP before running this installer."
}
if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw "The current Windows user's Local AppData folder is unavailable."
}

if (-not $sourceRoot.Equals($targetRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    $parent = Split-Path -Parent $targetRoot
    $stage = "$targetRoot.staging.$PID"
    $backup = "$targetRoot.backup.$PID"
    New-Item -ItemType Directory -Path $parent -Force | Out-Null

    $running = Get-Process -Name "Nolane.DesktopHost" -ErrorAction SilentlyContinue
    if ($running) {
        Write-Warning "Nolane is currently running. Updating will close it; finish or cancel active downloads first."
        $answer = Read-Host "Continue with the update? (Y/N)"
        if ($answer -notmatch "^(y|yes)$") {
            Write-Host "Installation cancelled. The current background bridge was left running."
            exit 0
        }
        $running | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 600
    }

    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null

    try {
        Get-ChildItem -LiteralPath $sourceRoot -Force |
            Where-Object {
                $_.Name -notin @(
                    "Install-NolaneInfinite.ps1",
                    "Install-NolaneInfinite.cmd",
                    "Uninstall-NolaneInfinite.ps1",
                    "Uninstall-NolaneInfinite.cmd"
                )
            } |
            ForEach-Object {
                Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse -Force
            }

        if (-not (Test-Path -LiteralPath (Join-Path $stage "Nolane.DesktopHost.exe") -PathType Leaf)) {
            throw "The staged installation is missing Nolane.DesktopHost.exe."
        }

        if (Test-Path -LiteralPath $targetRoot) {
            Move-Item -LiteralPath $targetRoot -Destination $backup
        }
        try {
            Move-Item -LiteralPath $stage -Destination $targetRoot
        }
        catch {
            if (Test-Path -LiteralPath $backup) {
                Move-Item -LiteralPath $backup -Destination $targetRoot
            }
            throw
        }
        if (Test-Path -LiteralPath $backup) {
            Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    finally {
        if (Test-Path -LiteralPath $stage) {
            Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

$installedExe = Join-Path $targetRoot "Nolane.DesktopHost.exe"
if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
    throw "The Nolane background bridge is not installed at $targetRoot."
}

$programs = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
if (-not [string]::IsNullOrWhiteSpace($programs)) {
    New-Item -ItemType Directory -Path $programs -Force | Out-Null
    $shortcut = Join-Path $programs "Nolane Infinite.url"
    @(
        "[InternetShortcut]"
        "URL=https://nolane-x.github.io/web-view/"
    ) | Set-Content -LiteralPath $shortcut -Encoding ASCII
}

Start-Process -FilePath $installedExe -ArgumentList @("--background") -WorkingDirectory $targetRoot
Write-Host "Nolane Infinite background bridge installed."
Write-Host "Install folder: $targetRoot"
Write-Host "Open https://nolane-x.github.io/web-view/ and click Connect Windows bridge once."
Write-Host "No administrator permission or Chrome extension is required."
