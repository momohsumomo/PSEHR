using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

static class Program {
  static int Main(string[] args) {
    bool agent = false;
    foreach (string arg in args) {
      if (string.Equals(arg, "/agent", StringComparison.OrdinalIgnoreCase)) agent = true;
    }
    string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    string exe = Process.GetCurrentProcess().MainModule.FileName;
    string ps1 = Path.Combine(dir, "desk_agent.ps1");
    string powershell = Path.Combine(
      Environment.SystemDirectory, "WindowsPowerShell\\v1.0\\powershell.exe");
    try { PlaceShortcuts(exe, dir); } catch { }
    if (!File.Exists(ps1) || !File.Exists(powershell)) return 1;
    string scriptArgs = agent
      ? "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + ps1 + "\""
      : "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + ps1 + "\" -Open";
    ProcessStartInfo info = new ProcessStartInfo();
    info.FileName = powershell;
    info.Arguments = scriptArgs;
    info.WorkingDirectory = dir;
    info.UseShellExecute = false;
    info.CreateNoWindow = true;
    Process.Start(info);
    return 0;
  }

  static void PlaceShortcuts(string exe, string dir) {
    Type shellType = Type.GetTypeFromProgID("WScript.Shell");
    object shell = Activator.CreateInstance(shellType);
    string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
    string startup = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
    Make(shell, Path.Combine(desktop, "\u958b\u555f\u9580\u8a3a.lnk"), exe, "", dir, 1);
    string check = Path.Combine(dir, "\u74b0\u5883\u6aa2\u67e5.exe");
    if (File.Exists(check)) Make(shell, Path.Combine(desktop, "\u74b0\u5883\u6aa2\u67e5.lnk"), check, "", dir, 1);
    Make(shell, Path.Combine(startup, "PSEHR-desk.lnk"), exe, "/agent", dir, 7);
  }

  static void Make(object shell, string path, string target, string arguments, string work, int style) {
    object link = shell.GetType().InvokeMember(
      "CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path });
    Type t = link.GetType();
    t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { target });
    t.InvokeMember("Arguments", BindingFlags.SetProperty, null, link, new object[] { arguments });
    t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { work });
    t.InvokeMember("WindowStyle", BindingFlags.SetProperty, null, link, new object[] { style });
    t.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "PSEHR" });
    t.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
  }
}
