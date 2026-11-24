<#
.SYNOPSIS
  Opens Mantel full screen. Used by the Start Menu shortcut and, if chosen, at sign-in.
.DESCRIPTION
  Chrome with --kiosk and its own profile folder (so the display's key survives restarts).
  Edge's kiosk mode is avoided on purpose: it runs InPrivate. Without Chrome, falls back to
  the default browser, windowed. Alt+F4 leaves kiosk mode.
#>
param([string] $Url = '', [string] $Path = '', [switch] $Windowed)
if (-not $Url) {
  # The installer's "show a Mantel that runs on another computer" choice, else this computer's
  # server on its configured port.
  $dataDir = Join-Path $env:ProgramData 'Mantel'
  $displayFile = Join-Path $dataDir 'display.json'
  if (Test-Path $displayFile) {
    try { $Url = [string] (Get-Content $displayFile -Raw | ConvertFrom-Json).server } catch { }
  }
  if ($Url -notmatch '^https?://') {
    $port = 8787
    $portFile = Join-Path $dataDir 'port.txt'
    if (Test-Path $portFile) { $n = 0; if ([int]::TryParse((Get-Content $portFile -Raw).Trim(), [ref] $n)) { $port = $n } }
    $Url = "http://localhost:$port"
  }
}
$Url = $Url.TrimEnd('/')
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

# Give the server a moment after boot.
for ($i = 0; $i -lt 30; $i++) {
  # Straight to the server: a system proxy or the missing Internet Explorer engine must not get in the way.
  try {
    $req = [System.Net.WebRequest]::Create("$Url/api/health"); $req.Proxy = $null; $req.Timeout = 2000
    $req.GetResponse().Close(); break
  } catch { Start-Sleep -Seconds 2 }
}
# Settings and other pages open in the same Chrome profile as the display, which is already paired.
$Url = $Url + $Path

if (-not $chrome) { Start-Process $Url; return }
$profile = Join-Path $env:LocalAppData 'Mantel\chrome'
$chromeArgs = @("--user-data-dir=`"$profile`"", '--no-first-run', '--disable-pinch',
  '--overscroll-history-navigation=0', '--noerrdialogs', '--disable-session-crashed-bubble',
  '--disable-features=TranslateUI')
if ($Windowed) { $chromeArgs += "--app=$Url" } else { $chromeArgs += '--kiosk'; $chromeArgs += $Url }
Start-Process -FilePath $chrome -ArgumentList $chromeArgs
