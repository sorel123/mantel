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
Name: "autostart"; Description: "Start the Mantel server when Windows starts (when Mantel runs on this computer; turn off to start it by hand from the tray icon)"
Name: "tray"; Description: "Show the Mantel status icon near the clock when I sign in"
Name: "autokiosk"; Description: "Open Mantel full screen when I sign in to Windows (for a wall display)"; Flags: unchecked
Name: "brightness"; Description: "Follow the screen schedule with this device's backlight (Surface and other tablets)"; Flags: unchecked

[InstallDelete]
; Earlier releases shipped a full node_modules (about 12,000 files). The server is one file now,
; so clear the old folder on upgrade rather than leave thousands of unused files behind.
Type: filesandordirs; Name: "{app}\app\node_modules"

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
Name: "{autoprograms}\Mantel (settings)"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\kiosk.ps1"" -Windowed -Path /settings"; Comment: "Open Mantel's settings"
Name: "{autoprograms}\Mantel (in a window)"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\kiosk.ps1"" -Windowed"
Name: "{commonstartup}\Mantel"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\kiosk.ps1"""; Tasks: autokiosk

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service.ps1"" -Install -AutoStart on"; Flags: runhidden waituntilterminated; Tasks: autostart; Check: IsLocalServer; StatusMsg: "Starting the Mantel server..."
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service.ps1"" -Install -AutoStart off"; Flags: runhidden waituntilterminated; Check: AutoStartOff; StatusMsg: "Starting the Mantel server..."
; Showing a Mantel from another computer: stop and remove a server an earlier install left here.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service.ps1"" -Remove"; Flags: runhidden waituntilterminated; Check: not IsLocalServer; StatusMsg: "Turning off the Mantel server on this computer..."
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File ""{app}\tray.ps1"""; Flags: nowait runasoriginaluser runhidden; Tasks: tray
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\mantel-brightness.ps1"" -Install -Local"; Flags: runhidden waituntilterminated; Tasks: brightness; Check: IsLocalServer; StatusMsg: "Setting up the brightness schedule..."
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\mantel-brightness.ps1"" -Install -Server ""{code:RemoteServer}"" -Code {code:PairCode}"; Flags: runhidden waituntilterminated; Tasks: brightness; Check: HasRemotePairCode; StatusMsg: "Setting up the brightness schedule..."
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\kiosk.ps1"" -Windowed"; Description: "Open Mantel and start setting it up"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service.ps1"" -Remove"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveService"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\mantel-brightness.ps1"" -Uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveBrightness"

[Code]
var
  ServerPage: TInputOptionWizardPage;
  AddressPage: TInputQueryWizardPage;

// Mantel can run here, or this computer can only show a Mantel that already runs elsewhere
// (Docker on a NAS, another PC). The second writes C:\ProgramData\Mantel\display.json, which
// kiosk.ps1 and tray.ps1 read, and installs no server.
procedure InitializeWizard;
begin
  ServerPage := CreateInputOptionPage(wpSelectDir,
    'Where Mantel runs',
    'Does this computer keep Mantel''s calendars and settings?',
    'Mantel is a small server plus a display. If you already run Mantel somewhere else, ' +
    'for example in Docker on a home server, this computer can just show that one.',
    True, False);
  ServerPage.Add('Run Mantel on this computer (it needs to stay on)');
  ServerPage.Add('Show a Mantel that already runs on another computer on my network');
  if GetPreviousData('ServerMode', 'local') = 'remote' then
    ServerPage.SelectedValueIndex := 1
  else
    ServerPage.SelectedValueIndex := 0;

  AddressPage := CreateInputQueryPage(ServerPage.ID,
    'Your Mantel server',
    'Where does your Mantel run?',
    'Type the address you open Mantel with, for example http://192.168.0.100:8787. ' +
    'The first time it opens, enter your admin PIN to add this screen.' + #13#10#13#10 +
    'For the brightness schedule, also type a pairing code (Settings, Displays, Show a code). ' +
    'Leave it empty to skip.');
  AddressPage.Add('Address:', False);
  AddressPage.Add('Pairing code for the brightness schedule (optional):', False);
  AddressPage.Values[0] := GetPreviousData('ServerAddress', 'http://');
end;

function IsLocalServer: Boolean;
begin
  Result := ServerPage.SelectedValueIndex = 0;
end;

function AutoStartOff: Boolean;
begin
  Result := IsLocalServer and not WizardIsTaskSelected('autostart');
end;

function NormalizedAddress: String;
begin
  Result := Trim(AddressPage.Values[0]);
  if (Pos('http://', Lowercase(Result)) <> 1) and (Pos('https://', Lowercase(Result)) <> 1) then
    Result := 'http://' + Result;
  while (Length(Result) > 0) and (Result[Length(Result)] = '/') do
    Result := Copy(Result, 1, Length(Result) - 1);
end;

function RemoteServer(Param: String): String;
begin
  Result := NormalizedAddress;
end;

function PairCode(Param: String): String;
begin
  Result := Trim(AddressPage.Values[1]);
end;

function HasRemotePairCode: Boolean;
begin
  Result := (not IsLocalServer) and (Length(Trim(AddressPage.Values[1])) = 6);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = AddressPage.ID) and IsLocalServer;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Code: String;
begin
  Result := True;
  if CurPageID = AddressPage.ID then
  begin
    if (Length(NormalizedAddress) <= Length('http://')) or (Pos(' ', NormalizedAddress) > 0) then
    begin
      MsgBox('Type the address you open Mantel with, like http://192.168.0.100:8787.', mbError, MB_OK);
      Result := False;
      exit;
    end;
    Code := Trim(AddressPage.Values[1]);
    if (Code <> '') and ((Length(Code) <> 6) or (StrToIntDef(Code, -1) < 0)) then
    begin
      MsgBox('The pairing code is 6 digits. Leave it empty to skip the brightness schedule for now.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  if IsLocalServer then
    SetPreviousData(PreviousDataKey, 'ServerMode', 'local')
  else
  begin
    SetPreviousData(PreviousDataKey, 'ServerMode', 'remote');
    SetPreviousData(PreviousDataKey, 'ServerAddress', NormalizedAddress);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Dir: String;
begin
  if CurStep = ssInstall then
  begin
    Dir := ExpandConstant('{commonappdata}\Mantel');
    ForceDirectories(Dir);
    if IsLocalServer then
      DeleteFile(Dir + '\display.json')
    else
      SaveStringToFile(Dir + '\display.json', '{"server":"' + NormalizedAddress + '"}', False);
  end;
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
