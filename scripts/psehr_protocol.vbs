Option Explicit
Dim sh, fso, root, url, ps
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
url = ""
If WScript.Arguments.Count > 0 Then url = WScript.Arguments(0)
ps = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\scripts\host_service.ps1"" -Action protocol -Url """ & url & """"
sh.Run ps, 0, False
