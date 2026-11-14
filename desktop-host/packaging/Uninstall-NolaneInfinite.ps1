[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Programs\NolaneInfiniteBridge"),
    [switch]$RemoveUserData
)

$ErrorActionPreference = "Stop"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
if (Test-Path -LiteralPath $runKey) {
    Remove-ItemProperty -LiteralPath $runKey -Name "NolaneInfiniteBridge" -ErrorAction SilentlyContinue
    Remove-ItemProperty -LiteralPath $runKey -Name "NolaneInfiniteBridgeStartupChoice" -ErrorAction SilentlyContinue
}
$preferencesKey = "HKCU:\Software\Nolane\NolaneInfiniteBridge"
if (Test-Path -LiteralPath $preferencesKey) {
    Remove-Item -LiteralPath $preferencesKey -Recurse -Force
}

Get-Process -Name "Nolane.DesktopHost" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

$programs = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
if (-not [string]::IsNullOrWhiteSpace($programs)) {
    $shortcut = Join-Path $programs "Nolane Infinite.url"
    if (Test-Path -LiteralPath $shortcut) {
        Remove-Item -LiteralPath $shortcut -Force
    }
}

$fullInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$scriptRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
if ($scriptRoot.Equals($fullInstallRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Run this uninstaller from the extracted Windows ZIP, not from inside the installation folder."
}
if (Test-Path -LiteralPath $fullInstallRoot) {
    Remove-Item -LiteralPath $fullInstallRoot -Recurse -Force
}

if ($RemoveUserData) {
    $userData = Join-Path $env:LOCALAPPDATA "Nolane\NativeWebView2\UserData"
    if (Test-Path -LiteralPath $userData) {
        Remove-Item -LiteralPath $userData -Recurse -Force
    }
    Write-Host "Nolane browser profiles, Library and download history were removed."
}
else {
    Write-Host "Browser profiles, Library data and download history were kept."
}
Write-Host "Nolane Infinite background bridge has been uninstalled."
