Option Explicit
Dim sh, fso, hostFile, ip, stream
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
hostFile = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\PSEHR\host.txt"
ip = ""
If fso.FileExists(hostFile) Then
  Set stream = fso.OpenTextFile(hostFile, 1)
  ip = Trim(stream.ReadAll())
  stream.Close
End If
If ip = "" Then
  ip = InputBox("Host IP", "PSEHR")
  If ip = "" Then WScript.Quit 1
  If Not fso.FolderExists(sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\PSEHR") Then
    fso.CreateFolder sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\PSEHR"
  End If
  Set stream = fso.CreateTextFile(hostFile, True)
  stream.Write ip
  stream.Close
End If
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)) & "\scripts\host_service.ps1"" -Action print", 0, False
sh.Run "http://" & ip & ":3010", 1, False
