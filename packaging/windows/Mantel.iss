; Inno Setup script for the Mantel Windows installer.
; Build: ISCC.exe /DMyVersion=0.2.0 /DBundleDir=<bundle folder> /DOutDir=<dir> packaging\windows\Mantel.iss
#ifndef MyVersion
  #define MyVersion "0.0.0"
#endif
#ifndef BundleDir
  #define BundleDir "..\..\dist\bundle"
#endif
#ifndef OutDir
  #define OutDir "..\..\dist"
#endif

[Setup]
AppId={{6F0B4B0E-4D0B-4B6A-9C54-2D7A0E5C3A11}
AppName=Mantel
AppVersion={#MyVersion}
AppPublisher=Mantel
AppPublisherURL=https://github.com/sorel123/mantel
DefaultDirName={autopf}\Mantel
DefaultGroupName=Mantel
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutDir}
OutputBaseFilename=Mantel-{#MyVersion}-windows-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
UninstallDisplayName=Mantel
CloseApplications=no

[Tasks]
Name: "autostart"; Description: "Start the Mantel server when Windows starts (turn off to start it by hand from the tray icon)"
Name: "tray"; Description: "Show the Mantel status icon near the clock when I sign in"
Name: "autokiosk"; Description: "Open Mantel full screen when I sign in to Windows (for a wall display)"; Flags: unchecked
Name: "brightness"; Description: "Follow the screen schedule with this device's backlight (Surface and other tablets)"; Flags: unchecked

[Files]
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#SourcePath}run-server.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}service.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}kiosk.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}tray.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\..\deploy\kiosk\surface\mantel-brightness.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Mantel (full screen)"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\kiosk.ps1"""; Comment: "Open the Mantel wall display full screen"
Name: "{autoprograms}\Mantel (status icon)"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File ""{app}\tray.ps1"""; Comment: "Show Mantel's status, address and port near the clock"
Name: "{commonstartup}\Mantel status icon"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File ""{app}\tray.ps1"""; Tasks: tray
Name: "{autoprograms}\Mantel (settings)"; Filename: "http://localhost:8787/settings"
Name: "{autoprograms}\Mantel (in a window)"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\kiosk.ps1"" -Windowed"
Name: "{commonstartup}\Mantel"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\kiosk.ps1"""; Tasks: autokiosk

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service.ps1"" -Install -AutoStart on"; Flags: runhidden waituntilterminated; Tasks: autostart; StatusMsg: "Starting the Mantel server..."
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service.ps1"" -Install -AutoStart off"; Flags: runhidden waituntilterminated; Check: AutoStartOff; StatusMsg: "Starting the Mantel server..."
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File ""{app}\tray.ps1"""; Flags: nowait runasoriginaluser runhidden; Tasks: tray
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\mantel-brightness.ps1"" -Install -Local"; Flags: runhidden waituntilterminated; Tasks: brightness; StatusMsg: "Setting up the brightness schedule..."
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\kiosk.ps1"" -Windowed"; Description: "Open Mantel and start setting it up"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service.ps1"" -Remove"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveService"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\mantel-brightness.ps1"" -Uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveBrightness"

[Code]
function AutoStartOff: Boolean;
begin
  Result := not WizardIsTaskSelected('autostart');
end;

// Your settings, calendars and photos live in C:\ProgramData\Mantel and are left alone by
// upgrades and uninstalls. The running server is stopped first so its files can be replaced.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\service.ps1')) then
    Exec('powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\service.ps1') + '" -Stop',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
