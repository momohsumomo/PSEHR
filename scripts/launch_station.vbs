Option Explicit
Dim sh, fso, root, ps
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
ps = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\scripts\host_service.ps1"" -Action print"
sh.Run ps, 0, True
