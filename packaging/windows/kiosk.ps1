<#
.SYNOPSIS
  Opens Mantel full screen. Used by the Start Menu shortcut and, if chosen, at sign-in.
.DESCRIPTION
  Chrome with --kiosk and its own profile folder (so the display's key survives restarts).
  Edge's kiosk mode is avoided on purpose: it runs InPrivate. Without Chrome, falls back to
  the default browser, windowed. Alt+F4 leaves kiosk mode.
#>
param([string] $Url = 'http://localhost:8787', [switch] $Windowed)
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

# Give the server a moment after boot.
for ($i = 0; $i -lt 30; $i++) {
  try { Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 2 }
}

if (-not $chrome) { Start-Process $Url; return }
$profile = Join-Path $env:LocalAppData 'Mantel\chrome'
$args = @("--user-data-dir=`"$profile`"", '--no-first-run', '--disable-pinch',
  '--overscroll-history-navigation=0', '--noerrdialogs', '--disable-session-crashed-bubble',
  '--disable-features=TranslateUI')
if ($Windowed) { $args += "--app=$Url" } else { $args += '--kiosk'; $args += $Url }
Start-Process -FilePath $chrome -ArgumentList $args
