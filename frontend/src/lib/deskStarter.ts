import helper from "@/assets/desk_helper.ps1?raw";

const NOTE =
  "\u6ac3\u6aaf\u96fb\u8166\u53ea\u8981\u9019\u4e00\u500b\u6a94\u3002\u8acb\u5728\u6ac3\u6aaf\u96fb\u8166\u96d9\u64ca\u525b\u4e0b\u8f09\u7684\u300c\u9023\u5230\u4e3b\u6a5f.bat\u300d\u3002\u5b83\u6703\u6253\u958b\u9019\u53f0\u7684\u770b\u8a3a\u756b\u9762\uff0c\u4e26\u8b93\u9019\u53f0\u4f7f\u7528\u63d2\u5728\u9019\u53f0\u4e0a\u7684\u8b80\u5361\u6a5f\u3002\u639b\u865f\u8cc7\u6599\u5b58\u56de\u4e3b\u6a5f\u3002";

export function downloadDeskStarter(): string {
  const body = helper.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  const bat = [
    "@echo off",
    "mkdir \"%LOCALAPPDATA%\\PSEHR\" 2>nul",
    "\"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\" -NoProfile -ExecutionPolicy Bypass -Command \"& { $t=[IO.File]::ReadAllText('%~f0'); $i=$t.LastIndexOf('###PS1###'); $out=Join-Path $env:LOCALAPPDATA 'PSEHR\\desk_helper.ps1'; [IO.File]::WriteAllText($out, $t.Substring($i+9).Trim()); Start-Process '%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$out }\"",
    "exit /b",
    "###PS1###",
    body.trim(),
    "",
  ].join("\r\n");
  const blob = new Blob([bat], { type: "application/octet-stream" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "\u9023\u5230\u4e3b\u6a5f.bat";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  return NOTE;
}
