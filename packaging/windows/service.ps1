<#
.SYNOPSIS
  Installs, stops or removes the "Mantel server" background task. Run by the installer.
.DESCRIPTION
  A scheduled task running as SYSTEM at startup keeps the server up without anyone signed in,
  restarts it if it stops, and needs no extra service software.
    service.ps1 -Install    register the task, open the firewall for the local network, start it
    service.ps1 -Stop       stop the task and the server (before an upgrade or uninstall)
    service.ps1 -Remove     stop and unregister it, close the firewall rule
#>
param(
  [switch] $Install,
  [switch] $Stop,
  [switch] $Remove,
  [int] $Port = 8787
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Mantel server'
$Rule = 'Mantel server'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Stop-Mantel {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq (Join-Path $Here 'node.exe') } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

if ($Stop) { Stop-Mantel; return }

if ($Remove) {
  Stop-Mantel
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -DisplayName $Rule -ErrorAction SilentlyContinue
  return
}

if ($Install) {
  Stop-Mantel
  $run = Join-Path $Here 'run-server.cmd'
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$run`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null

  # Tablets and phones on the home network reach the server through this rule (private networks only).
  Remove-NetFirewallRule -DisplayName $Rule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $Rule -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort $Port -Profile Private | Out-Null

  Start-ScheduledTask -TaskName $TaskName
}
