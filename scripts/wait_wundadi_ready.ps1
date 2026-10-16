# Wait until API :5000 and UI :3010 respond
$ErrorActionPreference = "SilentlyContinue"
1..60 | ForEach-Object {
  $a = $false
  $u = $false
  try {
    if ((Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/health -TimeoutSec 1).StatusCode -eq 200) {
      $a = $true
    }
  } catch {}
  try {
    if ((Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3010 -TimeoutSec 1).StatusCode -eq 200) {
      $u = $true
    }
  } catch {}
  if ($a -and $u) {
    Write-Output "READY"
    exit 0
  }
  Start-Sleep -Seconds 1
}
Write-Output "WAIT"
exit 1
