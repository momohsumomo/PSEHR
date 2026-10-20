using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net.Sockets;
using System.Text;
using System.Windows.Forms;

static class Program {
  [STAThread]
  static int Main(string[] args) {
    bool report = false;
    foreach (string arg in args) {
      if (string.Equals(arg, "/report", StringComparison.OrdinalIgnoreCase)) report = true;
    }
    string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    List<CheckRow> rows = EnvCheck.Collect(dir);
    if (report) {
      string path = Path.Combine(Path.GetTempPath(), "psehr-env-check.txt");
      List<string> lines = new List<string>();
      foreach (CheckRow row in rows) lines.Add((row.Ok ? "OK" : "NO") + "\t" + row.Name + "\t" + row.Detail);
      File.WriteAllLines(path, lines.ToArray(), new UTF8Encoding(false));
      Console.WriteLine(path);
      return 0;
    }
    try { EnvCheck.PlaceShortcut(dir); } catch { }
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new CheckForm(dir, rows));
    return 0;
  }
}

sealed class CheckRow {
  public string Name;
  public bool Ok;
  public string Detail;
}

static class EnvCheck {
  public static List<CheckRow> Collect(string dir) {
    List<CheckRow> rows = new List<CheckRow>();
    rows.Add(EdgeRow());
    rows.Add(SumatraRow(dir));
    rows.Add(DotNetRow("Microsoft.NETCore.App", ".NET 6", "dotnet-runtime-6-win-x86.exe"));
    rows.Add(DotNetRow("Microsoft.AspNetCore.App", "ASP.NET Core 6", "aspnetcore-runtime-6-win-x86.exe"));
    rows.Add(CardRow());
    rows.Add(CardListenRow());
    rows.Add(PrinterRow());
    rows.Add(VpnRow());
    rows.Add(HostRow());
    return rows;
  }

  public static bool NeedsCardInstall(List<CheckRow> rows) {
    foreach (CheckRow row in rows) {
      if (!row.Ok && (row.Name == ".NET 6" || row.Name == "ASP.NET Core 6" || row.Name == "\u8b80\u5361 6.0")) return true;
    }
    return false;
  }

  public static void PlaceShortcut(string dir) {
    string exe = Path.Combine(dir, "\u74b0\u5883\u6aa2\u67e5.exe");
    if (!File.Exists(exe)) exe = Process.GetCurrentProcess().MainModule.FileName;
    Type shellType = Type.GetTypeFromProgID("WScript.Shell");
    object shell = Activator.CreateInstance(shellType);
    string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
    object link = shell.GetType().InvokeMember(
      "CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell,
      new object[] { Path.Combine(desktop, "\u74b0\u5883\u6aa2\u67e5.lnk") });
    Type t = link.GetType();
    t.InvokeMember("TargetPath", System.Reflection.BindingFlags.SetProperty, null, link, new object[] { exe });
    t.InvokeMember("WorkingDirectory", System.Reflection.BindingFlags.SetProperty, null, link, new object[] { dir });
    t.InvokeMember("Description", System.Reflection.BindingFlags.SetProperty, null, link, new object[] { "PSEHR" });
    t.InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod, null, link, null);
  }

  static CheckRow EdgeRow() {
    string[] paths = new string[] {
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft\\Edge\\Application\\msedge.exe"),
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft\\Edge\\Application\\msedge.exe")
    };
    foreach (string path in paths) {
      if (File.Exists(path)) return Row("Edge", true, "\u9019\u53f0\u6709 Microsoft Edge");
    }
    return Row("Edge", false, "\u9019\u53f0\u6c92\u6709 Microsoft Edge\uff0c\u7d44\u4e0d\u51fa\u5217\u5370\u6a94");
  }

  static CheckRow SumatraRow(string dir) {
    string bundled = Path.Combine(dir, "SumatraPDF.exe");
    if (File.Exists(bundled)) return Row("PDF", true, "\u514d\u5b89\u88dd\u7684 SumatraPDF.exe \u5728\u9019\u500b\u8cc7\u6599\u593e\u88e1");
    return Row("PDF", false, "\u8cc7\u6599\u593e\u88e1\u6c92\u6709 SumatraPDF.exe\u3002\u628a\u514d\u5b89\u88dd\u7248\u653e\u56de\u300c\u958b\u555f\u9580\u8a3a\u300d\u65c1\u908a");
  }

  static CheckRow DotNetRow(string fx, string label, string installer) {
    string root = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
      "dotnet", "shared", fx);
    if (Directory.Exists(root)) {
      foreach (string dir in Directory.GetDirectories(root)) {
        string name = Path.GetFileName(dir);
        if (name.StartsWith("6.")) return Row(label, true, "32 \u4f4d\u5143 " + name);
      }
    }
    return Row(label, false, "\u6c92\u6709 32 \u4f4d\u5143 6.0\u3002\u8cc7\u6599\u593e\u88e1\u7684\u5b89\u88dd\u6a94\u662f " + installer);
  }

  static CheckRow CardRow() {
    string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
    if (string.IsNullOrEmpty(pf86)) pf86 = "C:\\Program Files (x86)";
    string exe = Path.Combine(pf86, "NHI\\cshis6\\ciet6001s01.exe");
    if (File.Exists(exe)) return Row("\u8b80\u5361 6.0", true, "\u5df2\u7d93\u88dd\u5728\u9019\u53f0");
    bool legacy = Directory.Exists("C:\\NHI")
      || Directory.Exists(Path.Combine(pf86, "NHI\\cshis"))
      || Directory.Exists(Path.Combine(pf86, "NHI\\CsHis"));
    if (legacy) return Row("\u8b80\u5361 6.0", false, "\u9019\u53f0\u53ea\u6709 5.XX\uff0c\u6c92\u6709 6.0");
    return Row("\u8b80\u5361 6.0", false, "\u9019\u53f0\u6c92\u6709\u8b80\u5361\u8edf\u9ad4 6.0\u3002\u53ef\u4ee5\u7528\u8cc7\u6599\u593e\u88e1\u7684\u5b89\u88dd\u6a94");
  }

  static CheckRow CardListenRow() {
    if (Tcp("127.0.0.1", 5066, 400)) return Row("\u8b80\u5361\u670d\u52d9", true, "\u9019\u53f0\u7684 6.0 \u6709\u5728\u807d");
    return Row("\u8b80\u5361\u670d\u52d9", false, "6.0 \u6c92\u6709\u5728\u807d\u3002\u88dd\u597d\u4e4b\u5f8c\u8981\u958b\u4e00\u6b21\u4e3b\u63a7\u53f0");
  }

  static CheckRow PrinterRow() {
    List<string> online = new List<string>();
    try {
      ManagementObjectSearcher searcher = new ManagementObjectSearcher(
        "SELECT Name, WorkOffline, PrinterStatus, PortName FROM Win32_Printer");
      foreach (ManagementObject item in searcher.Get()) {
        string name = Convert.ToString(item["Name"]) ?? "";
        name = name.Trim();
        if (name.Length == 0 || !IsDevice(name, Convert.ToString(item["PortName"]))) continue;
        bool offline = false;
        try { offline = Convert.ToBoolean(item["WorkOffline"]); } catch { }
        int status = 0;
        try { status = Convert.ToInt32(item["PrinterStatus"]); } catch { }
        if (!offline && status != 7) online.Add(name);
      }
    } catch {
      return Row("\u5370\u8868\u6a5f", false, "\u9019\u53f0\u8b80\u4e0d\u5230\u5370\u8868\u6a5f\u6e05\u55ae");
    }
    if (online.Count == 0) return Row("\u5370\u8868\u6a5f", false, "\u6c92\u6709\u7dda\u4e0a\u7684\u5370\u8868\u6a5f");
    string shown = string.Join("\u3001", online.GetRange(0, Math.Min(3, online.Count)).ToArray());
    return Row("\u5370\u8868\u6a5f", true, "\u7dda\u4e0a\uff1a" + shown);
  }

  static bool IsDevice(string name, string port) {
    string folded = name.ToLowerInvariant();
    if (folded.Contains("pdf") || folded.Contains("xps") || folded.Contains("onenote") || folded.Contains("fax")) return false;
    string upper = (port ?? "").ToUpperInvariant();
    if (upper.StartsWith("PORTPROMPT") || upper.StartsWith("NUL") || upper.StartsWith("FILE") || upper.StartsWith("SHRFAX")) return false;
    return true;
  }

  static CheckRow VpnRow() {
    if (Tcp("medvpndc.nhi.gov.tw", 443, 1500)) return Row("\u5065\u4fdd VPN", true, "\u9019\u53f0\u9023\u5f97\u5230\u5065\u4fdd VPN");
    return Row("\u5065\u4fdd VPN", false, "\u9019\u53f0\u9023\u4e0d\u5230\u3002\u8981\u81ea\u5df1\u767b\u5165\uff0c\u5de5\u5177\u4e0d\u6703\u4ee3\u767b");
  }

  static CheckRow HostRow() {
    string file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PSEHR", "host.txt");
    string ip = "";
    try { if (File.Exists(file)) ip = File.ReadAllText(file).Trim(); } catch { }
    if (ip.Length > 0 && Tcp(ip, 3010, 500)) return Row("\u8a3a\u6240\u4e3b\u6a5f", true, ip + " \u7684\u9580\u8a3a\u756b\u9762\u6709\u5728");
    return Row("\u8a3a\u6240\u4e3b\u6a5f", false, "\u9084\u6c92\u627e\u5230\u958b\u8457\u7684\u4e3b\u6a5f\u3002\u5148\u958b\u4e00\u6b21\u300c\u958b\u555f\u9580\u8a3a\u300d");
  }

  static bool Tcp(string host, int port, int ms) {
    TcpClient client = new TcpClient();
    try {
      IAsyncResult ar = client.BeginConnect(host, port, null, null);
      bool ok = ar.AsyncWaitHandle.WaitOne(ms, false) && client.Connected;
      return ok;
    } catch {
      return false;
    } finally {
      try { client.Close(); } catch { }
    }
  }

  static CheckRow Row(string name, bool ok, string detail) {
    CheckRow row = new CheckRow();
    row.Name = name;
    row.Ok = ok;
    row.Detail = detail;
    return row;
  }
}

sealed class CheckForm : Form {
  readonly string _dir;
  readonly ListView _list;
  readonly Button _install;
  List<CheckRow> _rows;

  public CheckForm(string dir, List<CheckRow> rows) {
    _dir = dir;
    _rows = rows;
    Text = "\u74b0\u5883\u6aa2\u67e5";
    StartPosition = FormStartPosition.CenterScreen;
    ClientSize = new Size(640, 420);
    Font = new Font("Microsoft JhengHei", 10f);
    _list = new ListView();
    _list.View = View.Details;
    _list.FullRowSelect = true;
    _list.HeaderStyle = ColumnHeaderStyle.Nonclickable;
    _list.Dock = DockStyle.Fill;
    _list.Columns.Add("\u9805\u76ee", 130);
    _list.Columns.Add("\u7d50\u679c", 70);
    _list.Columns.Add("\u8aaa\u660e", 400);
    Controls.Add(_list);
    Panel bar = new Panel();
    bar.Dock = DockStyle.Bottom;
    bar.Height = 48;
    _install = new Button();
    _install.Text = "\u5b89\u88dd\u7f3a\u5c11\u7684\u8b80\u5361\u74b0\u5883";
    _install.Width = 180;
    _install.Height = 30;
    _install.Left = 12;
    _install.Top = 8;
    _install.Click += OnInstall;
    Button again = new Button();
    again.Text = "\u518d\u67e5\u4e00\u6b21";
    again.Width = 100;
    again.Height = 30;
    again.Left = 204;
    again.Top = 8;
    again.Click += delegate { Reload(); };
    Button close = new Button();
    close.Text = "\u95dc\u9589";
    close.Width = 80;
    close.Height = 30;
    close.Left = 316;
    close.Top = 8;
    close.Click += delegate { Close(); };
    bar.Controls.Add(_install);
    bar.Controls.Add(again);
    bar.Controls.Add(close);
    Controls.Add(bar);
    Fill();
  }

  void Reload() {
    _rows = EnvCheck.Collect(_dir);
    Fill();
  }

  void Fill() {
    _list.BeginUpdate();
    _list.Items.Clear();
    foreach (CheckRow row in _rows) {
      ListViewItem item = new ListViewItem(row.Name);
      item.SubItems.Add(row.Ok ? "\u901a\u904e" : "\u7f3a");
      item.SubItems.Add(row.Detail);
      item.ForeColor = row.Ok ? Color.FromArgb(20, 110, 40) : Color.FromArgb(170, 30, 30);
      _list.Items.Add(item);
    }
    _list.EndUpdate();
    _install.Enabled = EnvCheck.NeedsCardInstall(_rows);
  }

  void OnInstall(object sender, EventArgs e) {
    string bat = Path.Combine(_dir, "\u8b80\u53616.0", "\u5b89\u88dd\u8b80\u5361.bat");
    if (!File.Exists(bat)) {
      MessageBox.Show("\u8cc7\u6599\u593e\u88e1\u6c92\u6709\u8b80\u5361\u5b89\u88dd\u6a94\u3002", Text);
      return;
    }
    ProcessStartInfo info = new ProcessStartInfo();
    info.FileName = bat;
    info.WorkingDirectory = Path.GetDirectoryName(bat);
    info.UseShellExecute = true;
    Process.Start(info);
  }
}
