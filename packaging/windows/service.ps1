<#
.SYNOPSIS
  Installs, starts, stops or removes the "Mantel server" background task, and changes its
  port and start-at-boot setting. Run by the installer and by the tray icon (elevated).
.DESCRIPTION
  A scheduled task running as SYSTEM keeps the server up without anyone signed in and
  restarts it if it stops, with no extra service software.
    service.ps1 -Install [-AutoStart on|off]  register the task, open the firewall, start it
    service.ps1 -Start / -Stop                start or stop the server now
    service.ps1 -AutoStart on|off             start the server when Windows starts, or not
    service.ps1 -SetPort 8800                 change the port (restarts the server)
    service.ps1 -Remove                       stop and unregister it, close the firewall rule
#>
param(
  [switch] $Install,
  [switch] $Start,
  [switch] $Stop,
  [switch] $Remove,
  [ValidateSet('on', 'off', '')] [string] $AutoStart = '',
  [int] $SetPort = 0
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Mantel server'
$Rule = 'Mantel server'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $env:ProgramData 'Mantel'
$PortFile = Join-Path $DataDir 'port.txt'

function Get-MantelPort {
  if (Test-Path $PortFile) {
    $n = 0
    if ([int]::TryParse((Get-Content $PortFile -Raw).Trim(), [ref] $n) -and $n -ge 1 -and $n -le 65535) { return $n }
  }
  return 8787
}

function Stop-Mantel {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq (Join-Path $Here 'node.exe') } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

function Register-MantelTask([bool] $AtStartup) {
  $run = Join-Path $Here 'run-server.cmd'
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$run`""
  # With no trigger the task only runs when started by hand (tray icon or Start Menu).
  $triggers = if ($AtStartup) { @(New-ScheduledTaskTrigger -AtStartup) } else { @() }
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  $reg = @{ TaskName = $TaskName; Action = $action; Principal = $principal; Settings = $settings; Force = $true }
  if ($triggers.Count -gt 0) { $reg.Trigger = $triggers }
  Register-ScheduledTask @reg | Out-Null
}

function Set-Firewall([int] $Port) {
  # Tablets and phones on the home network reach the server through this rule (private networks only).
  Remove-NetFirewallRule -DisplayName $Rule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $Rule -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort $Port -Profile Private | Out-Null
}

function Test-AutoStart {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  return [bool]($t -and $t.Triggers.Count -gt 0)
}

if ($Remove) {
  Stop-Mantel
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -DisplayName $Rule -ErrorAction SilentlyContinue
  return
}

if ($Install) {
  Stop-Mantel
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  # An upgrade keeps the person's choice unless the installer states one.
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $atStartup = if ($AutoStart) { $AutoStart -eq 'on' } elseif ($existing) { Test-AutoStart } else { $true }
  Register-MantelTask $atStartup
  Set-Firewall (Get-MantelPort)
  Start-ScheduledTask -TaskName $TaskName
  return
}

if ($SetPort -gt 0) {
  if ($SetPort -lt 1024 -or $SetPort -gt 65535) { throw 'Pick a port between 1024 and 65535.' }
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  Stop-Mantel
  Set-Content -Path $PortFile -Value $SetPort -Encoding ASCII
  Set-Firewall $SetPort
  Start-ScheduledTask -TaskName $TaskName
  return
}

if ($AutoStart) {
  Register-MantelTask ($AutoStart -eq 'on')
  return
}

if ($Stop) { Stop-Mantel; return }
if ($Start) { Start-ScheduledTask -TaskName $TaskName; return }
