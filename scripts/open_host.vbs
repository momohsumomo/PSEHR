Option Explicit
Dim sh, fso, root, hostFile, ip, stream, code, folder
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
hostFile = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\PSEHR\host.txt"
code = sh.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\scripts\host_service.ps1"" -Action discover", 0, True)
ip = ""
If fso.FileExists(hostFile) Then
  Set stream = fso.OpenTextFile(hostFile, 1)
  ip = stream.ReadAll()
  stream.Close
End If
ip = CleanIp(ip)
If code <> 0 Or ip = "" Then
  ip = CleanIp(InputBox("Host IP", "PSEHR", ip))
  If ip = "" Then WScript.Quit 1
  folder = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\PSEHR"
  If Not fso.FolderExists(folder) Then fso.CreateFolder folder
  Set stream = fso.CreateTextFile(hostFile, True)
  stream.Write ip
  stream.Close
End If
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\scripts\host_service.ps1"" -Action print", 0, False
sh.Run "explorer.exe ""http://" & ip & ":3010""", 1, False

Function CleanIp(raw)
  Dim s
  s = raw & ""
  s = Replace(s, vbCr, "")
  s = Replace(s, vbLf, "")
  s = Replace(s, vbTab, "")
  CleanIp = Trim(s)
End Function
