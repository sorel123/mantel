<#
.SYNOPSIS
  Follows Mantel's screen schedule with the Surface's real backlight.

.DESCRIPTION
  A browser cannot change screen brightness, so this small helper does it for the wall
  Surface. Every five minutes a scheduled task asks the Mantel server what the screen should
  be doing (GET /api/display/state) and sets the built-in panel's brightness to match:
  the level from the brightness steps during the day, and 0 while the schedule says the
  screen is off. Change the schedule on the settings page; nothing here needs editing.

  Run once from an elevated PowerShell ("Run as administrator") on the Surface:

    .\mantel-brightness.ps1 -Install -Server http://192.168.1.10:8787 -Code 123456

  The code is a pairing code: from the server log, or "Show a code" under Displays on the
  settings page. The helper appears there as its own display and can be revoked like one.

  .\mantel-brightness.ps1             applies the schedule once (what the task runs)
  .\mantel-brightness.ps1 -Uninstall  removes the task and the stored key
#>
[CmdletBinding(DefaultParameterSetName = 'Apply')]
param(
  [Parameter(ParameterSetName = 'Install', Mandatory = $true)]
  [switch] $Install,

  [Parameter(ParameterSetName = 'Install', Mandatory = $true)]
  [string] $Server,

  [Parameter(ParameterSetName = 'Install', Mandatory = $true)]
  [ValidatePattern('^\d{6}$')]
  [string] $Code,

  [Parameter(ParameterSetName = 'Uninstall', Mandatory = $true)]
  [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'
$Dir = Join-Path $env:ProgramData 'Mantel'
$ConfigFile = Join-Path $Dir 'brightness.json'
$ScriptCopy = Join-Path $Dir 'mantel-brightness.ps1'
$TaskName = 'Mantel brightness'
$KeyHeader = 'x-mantel-device-key'

function Assert-Admin {
  $id = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $id.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from PowerShell opened with "Run as administrator".'
  }
}

function Set-PanelBrightness([int] $Level) {
  $methods = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $methods) {
    Write-Warning 'This screen does not expose brightness control (external monitors usually do not).'
    return
  }
  $Level = [Math]::Max(0, [Math]::Min(100, $Level))
  Invoke-CimMethod -InputObject $methods -MethodName WmiSetBrightness `
    -Arguments @{ Timeout = [uint32] 1; Brightness = [byte] $Level } | Out-Null
}

if ($Install) {
  Assert-Admin
  $Server = $Server.TrimEnd('/')
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null

  $body = @{ code = $Code; name = "$env:COMPUTERNAME brightness" } | ConvertTo-Json
  $paired = Invoke-RestMethod -Method Post -Uri "$Server/api/pair" -ContentType 'application/json' -Body $body
  @{ server = $Server; deviceKey = $paired.deviceKey } | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8
  # Only administrators and SYSTEM may read the stored key.
  icacls $ConfigFile /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null
  Copy-Item -Path $PSCommandPath -Destination $ScriptCopy -Force

  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$ScriptCopy`""
  $every5 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $atBoot = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $every5, $atBoot `
    -Principal $principal -Settings $settings -Force | Out-Null

  Write-Host "Paired as device $($paired.deviceId). The '$TaskName' task now runs every 5 minutes."
  & $ScriptCopy
  return
}

if ($Uninstall) {
  Assert-Admin
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -Path $Dir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Removed. Revoke the brightness display on the Mantel settings page too.'
  return
}

# Apply once.
if (-not (Test-Path $ConfigFile)) { throw "Not installed: run with -Install first." }
$config = Get-Content -Path $ConfigFile -Raw | ConvertFrom-Json
$state = Invoke-RestMethod -Uri "$($config.server)/api/display/state" `
  -Headers @{ $KeyHeader = $config.deviceKey } -TimeoutSec 15
Set-PanelBrightness ([int] $state.brightness)
Write-Host "Screen $($state.screen), brightness $($state.brightness)."
