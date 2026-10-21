# Stop listeners on :5000 / :3010 and related Wundadi processes
$ErrorActionPreference = "SilentlyContinue"
$ports = @(5000, 3010)
foreach ($p in $ports) {
  $conns = @()
  try { $conns = @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) } catch { $conns = @() }
  foreach ($conn in $conns) {
    $procId = $conn.OwningProcess
    if ($procId -and $procId -ne 0) {
      Write-Host "  kill PID $procId port $p"
      Stop-Process -Id $procId -Force
    }
  }
}
Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -match 'uvicorn src\.api\.main:app' -or
      $_.CommandLine -match 'vite.*3010' -or
      $_.CommandLine -match 'npm run dev'
    )
  } |
  ForEach-Object {
    Write-Host "  kill $($_.ProcessId) $($_.Name)"
    Stop-Process -Id $_.ProcessId -Force
  }
Start-Sleep -Seconds 1
Write-Host "  done"
