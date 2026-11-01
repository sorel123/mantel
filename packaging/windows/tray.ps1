<#
.SYNOPSIS
  Mantel's notification-area (system tray) icon: status, address and port, start at boot,
  start/stop, change port, open.
.DESCRIPTION
  Runs hidden from the Start Menu and at sign-in. The icon is green when the server answers,
  grey when it does not, and a balloon tells you when that changes. Right-click for:
    status and address (click the address to copy it)
    Open Mantel full screen / in a window / Settings
    Start when Windows starts        (checkbox)
    Start server / Stop server
    Change port...
    Exit                             (leaves the server running)
  Starting, stopping and the port change run service.ps1 elevated, so Windows asks once.

    tray.ps1 -Status [-Port 8787]    print the state as JSON and exit (used by CI and for support)
#>
param([switch] $Status, [int] $Port = 0)
$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $env:ProgramData 'Mantel'
$TaskName = 'Mantel server'

function Get-ConfiguredPort {
  $f = Join-Path $DataDir 'port.txt'
  if (Test-Path $f) {
    $n = 0
    if ([int]::TryParse((Get-Content $f -Raw).Trim(), [ref] $n) -and $n -ge 1 -and $n -le 65535) { return $n }
  }
  return 8787
}

function Get-LanAddress {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' }
  $pick = $ips | Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)' } | Select-Object -First 1
  if (-not $pick) { $pick = $ips | Select-Object -First 1 }
  if ($pick) { return $pick.IPAddress }
  return $null
}

function Get-State([int] $UsePort) {
  if ($UsePort -le 0) { $UsePort = Get-ConfiguredPort }
  $running = $false
  $version = $null
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$UsePort/api/health" -TimeoutSec 2
    $running = [bool] $h.ok
    $version = $h.version
  } catch { }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $lan = Get-LanAddress
  [pscustomobject] @{
    running   = $running
    version   = $version
    port      = $UsePort
    address   = if ($lan) { "http://${lan}:$UsePort" } else { "http://localhost:$UsePort" }
    local     = "http://localhost:$UsePort"
    installed = [bool] $task
    autoStart = [bool] ($task -and $task.Triggers.Count -gt 0)
  }
}

if ($Status) { Get-State $Port | ConvertTo-Json; return }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, Microsoft.VisualBasic
[System.Windows.Forms.Application]::EnableVisualStyles()

# One tray icon at a time.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\MantelTray', [ref] $created)
if (-not $created) { return }

function New-DotIcon([System.Drawing.Color] $color) {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush $color), 3, 3, 26, 26)
  $g.DrawEllipse((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 255, 255, 255)), 2), 3, 3, 26, 26)
  $g.Dispose()
  [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}
$iconOn = New-DotIcon ([System.Drawing.Color]::FromArgb(46, 160, 67))
$iconOff = New-DotIcon ([System.Drawing.Color]::FromArgb(140, 140, 140))

function Invoke-Service([string[]] $serviceArgs) {
  $script = Join-Path $Here 'service.ps1'
  try {
    Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait `
      -ArgumentList (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$script`"") + $serviceArgs)
  } catch {
    # The person said no to the Windows prompt.
  }
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$miStatus = $menu.Items.Add('Checking…'); $miStatus.Enabled = $false
$miAddress = $menu.Items.Add('')
$miAddress.ToolTipText = 'Click to copy. Type this into a tablet or phone on your network.'
[void] $menu.Items.Add('-')
$miFull = $menu.Items.Add('Open Mantel full screen')
$miWindow = $menu.Items.Add('Open Mantel in a window')
$miSettings = $menu.Items.Add('Open settings')
[void] $menu.Items.Add('-')
$miAuto = New-Object System.Windows.Forms.ToolStripMenuItem 'Start when Windows starts'
$miAuto.CheckOnClick = $false
[void] $menu.Items.Add($miAuto)
$miToggle = $menu.Items.Add('Stop server')
$miPort = $menu.Items.Add('Change port…')
[void] $menu.Items.Add('-')
$miExit = $menu.Items.Add('Hide this icon (server keeps running)')
$tray.ContextMenuStrip = $menu

$script:state = $null
$script:wasRunning = $null

function Update-Tray {
  $s = Get-State 0
  $script:state = $s
  if ($s.running) {
    $miStatus.Text = "Mantel is running (version $($s.version))"
    $tray.Icon = $iconOn
    $tray.Text = "Mantel is running`n$($s.address)"
    $miToggle.Text = 'Stop server'
  } else {
    $miStatus.Text = if ($s.installed) { 'Mantel is stopped' } else { 'Mantel is not installed' }
    $tray.Icon = $iconOff
    $tray.Text = 'Mantel is stopped'
    $miToggle.Text = 'Start server'
  }
  $miAddress.Text = "Address: $($s.address)"
  $miAuto.Checked = $s.autoStart
  $miToggle.Enabled = $s.installed
  $miPort.Enabled = $s.installed
  $miAuto.Enabled = $s.installed
  if ($null -ne $script:wasRunning -and $script:wasRunning -ne $s.running) {
    if ($s.running) { $tray.ShowBalloonTip(4000, 'Mantel', "Running at $($s.address)", 'Info') }
    else { $tray.ShowBalloonTip(6000, 'Mantel stopped', 'The server is not answering. Right-click the icon to start it.', 'Warning') }
  }
  $script:wasRunning = $s.running
}

$kiosk = Join-Path $Here 'kiosk.ps1'
function Open-Wall([bool] $windowed) {
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$kiosk`"", '-Url', $script:state.local)
  if ($windowed) { $a += '-Windowed' }
  Start-Process powershell.exe -ArgumentList $a -WindowStyle Hidden
}

$miAddress.add_Click({ [System.Windows.Forms.Clipboard]::SetText($script:state.address); $tray.ShowBalloonTip(2000, 'Mantel', 'Address copied', 'Info') })
$miFull.add_Click({ Open-Wall $false })
$miWindow.add_Click({ Open-Wall $true })
$tray.add_DoubleClick({ Open-Wall $true })
$miSettings.add_Click({ Start-Process "$($script:state.local)/settings" })
$miAuto.add_Click({
  Invoke-Service @('-AutoStart', $(if ($script:state.autoStart) { 'off' } else { 'on' }))
  Update-Tray
})
$miToggle.add_Click({
  Invoke-Service @($(if ($script:state.running) { '-Stop' } else { '-Start' }))
  Start-Sleep -Seconds 2
  Update-Tray
})
$miPort.add_Click({
  $answer = [Microsoft.VisualBasic.Interaction]::InputBox(
    "Port for Mantel (1024 to 65535). Tablets will need the new address, and the display on this computer follows automatically.`n`nCurrent port: $($script:state.port)",
    'Change Mantel port', "$($script:state.port)")
  if (-not $answer) { return }
  $n = 0
  if (-not [int]::TryParse($answer.Trim(), [ref] $n) -or $n -lt 1024 -or $n -gt 65535) {
    [void] [System.Windows.Forms.MessageBox]::Show('Please enter a number from 1024 to 65535.', 'Mantel')
    return
  }
  Invoke-Service @('-SetPort', "$n")
  Start-Sleep -Seconds 3
  Update-Tray
})
$miExit.add_Click({
  $timer.Stop(); $tray.Visible = $false; $tray.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({ Update-Tray })
Update-Tray
$timer.Start()
[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
