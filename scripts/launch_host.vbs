Option Explicit
Dim sh, fso, root, action, ps, arg
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
action = "start"
If WScript.Arguments.Count > 0 Then action = LCase(WScript.Arguments(0))
ps = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\scripts\host_service.ps1"" -Action " & action
sh.Run ps, 0, True
If action = "start" Or action = "restart" Then
  arg = """" & root & "\scripts\open_desktop_window.bat"""
  sh.Run arg, 0, False
End If
