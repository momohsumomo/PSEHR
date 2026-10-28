# Once a day after 07:10, ask the host for the referral list job and run it here.
$ErrorActionPreference = "Stop"
$markDir = Join-Path $env:LOCALAPPDATA "PSEHR"
New-Item -ItemType Directory -Force -Path $markDir | Out-Null
$mark = Join-Path $markDir "ref-daily.txt"
$lock = Join-Path $markDir "ref-daily.lock"
$today = Get-Date -Format "yyyy-MM-dd"
if ((Get-Date).TimeOfDay -lt [TimeSpan]::Parse("07:10:00")) { exit 0 }
if (Test-Path -LiteralPath $mark) {
  $state = [IO.File]::ReadAllText($mark).Trim()
  if ($state -eq ($today + " done")) { exit 0 }
}
if (Test-Path -LiteralPath $lock) {
  $age = (Get-Date) - (Get-Item -LiteralPath $lock).LastWriteTime
  if ($age.TotalMinutes -lt 20) { exit 0 }
}
[IO.File]::WriteAllText($lock, $today)
try {
  $hostUrl = "http://OPD:5000"
  $plan = Invoke-RestMethod -Uri ($hostUrl + "/nhi/v1/referral/pull") -Method POST -TimeoutSec 30
  if (-not $plan.ok) { exit 0 }
  $desk = "http://127.0.0.1:5310/tools/referral-io"
  if ("$($plan.step)" -eq "send") {
    foreach ($file in @($plan.files)) {
      $body = @{ op = "send"; name = "$($file.name)"; type = "$($file.type)"; b64 = "$($file.b64)" } | ConvertTo-Json -Compress
      $sent = Invoke-RestMethod -Uri $desk -Method POST -Body $body -ContentType "application/json" -TimeoutSec 90
      if ($sent.ok) {
        $done = @{ kind = "$($file.kind)"; name = "$($file.name)"; localId = "$($sent.localId)"; nhiId = "$($sent.nhiId)" } | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri ($hostUrl + "/nhi/v1/referral/pull-sent") -Method POST -Body $done -ContentType "application/json" -TimeoutSec 30 | Out-Null
      }
    }
    [IO.File]::WriteAllText($mark, ($today + " sent"))
  } elseif ("$($plan.step)" -eq "fetch") {
    foreach ($job in @($plan.jobs)) {
      $body = @{ op = "fetch"; localId = "$($job.localId)"; nhiId = "$($job.nhiId)" } | ConvertTo-Json -Compress
      $got = Invoke-RestMethod -Uri $desk -Method POST -Body $body -ContentType "application/json" -TimeoutSec 90
      $rows = @()
      if ($got.rows) { $rows = @($got.rows) }
      $apply = @{ localId = "$($job.localId)"; kind = "$($job.kind)"; rows = $rows } | ConvertTo-Json -Compress -Depth 6
      Invoke-RestMethod -Uri ($hostUrl + "/nhi/v1/referral/pull-apply") -Method POST -Body $apply -ContentType "application/json" -TimeoutSec 30 | Out-Null
    }
    [IO.File]::WriteAllText($mark, ($today + " done"))
  } elseif ("$($plan.step)" -eq "wait") {
    [IO.File]::WriteAllText($mark, ($today + " sent"))
  }
} catch {
} finally {
  Remove-Item -LiteralPath $lock -ErrorAction SilentlyContinue
}
