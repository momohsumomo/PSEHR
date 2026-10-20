param(
  [string]$Source = "",
  [string]$Destination = "",
  [switch]$Yes
)

$ErrorActionPreference = "Continue"
$root = Split-Path $PSScriptRoot -Parent
$defaultSrc = "E:\SC\IMG"
$suggestDst = Join-Path $root "data\look"

function Normalize-PathText([string]$PathText) {
  $full = [IO.Path]::GetFullPath($PathText)
  return $full.TrimEnd("\").ToLowerInvariant()
}

Write-Host ""
Write-Host "複製整棵圖檔。來源留在原地，也不會刪目的地多出來的檔。"
Write-Host "檔很多時可以關掉這個視窗，下次再執行會從還沒過去的檔繼續。"
Write-Host "時間與大小都相同的檔會跳過。"
Write-Host ""

if (-not $Source) {
  Write-Host "來源預設：$defaultSrc"
  $typed = Read-Host "來源（直接 Enter 用預設）"
  if ($typed.Trim()) { $Source = $typed.Trim() } else { $Source = $defaultSrc }
}
if (-not $Destination) {
  Write-Host ""
  Write-Host "目的地要直接裝兩碼資料夾（例如 10、31、70），不要再多包一層 IMG。"
  Write-Host "建議：$suggestDst"
  Write-Host "這台如果還在看診，不要拷進上面這個 data/look。第一個檔進去之後，系統就改讀那裡，沒拷完會少圖。"
  Write-Host "要搬去下一台主機，請填那台的 data/look，或先填外接碟。"
  $typed = Read-Host "目的地（直接 Enter 用建議）"
  if ($typed.Trim()) { $Destination = $typed.Trim() } else { $Destination = $suggestDst }
}

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
  Write-Host "找不到來源資料夾：$Source"
  exit 1
}

$srcFull = Normalize-PathText $Source
$dstFull = Normalize-PathText $Destination
if ($srcFull -eq $dstFull -or $dstFull.StartsWith($srcFull + "\") -or $srcFull.StartsWith($dstFull + "\")) {
  Write-Host "來源和目的地不能是同一個，也不能一個包在另一個裡面。"
  exit 1
}

$live = Normalize-PathText $suggestDst
if ($dstFull -eq $live -and -not $Yes) {
  Write-Host ""
  Write-Host "目的地是這台正在用的 data/look。拷到一半，看診就會改看這份還沒完的圖。"
  $answer = Read-Host "確定要拷進這台的 data/look 請輸入 YES"
  if ($answer -ne "YES") {
    Write-Host "已取消。"
    exit 0
  }
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$logDir = Join-Path $root "data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "copy-look.log"

Write-Host ""
Write-Host "開始。來源 $Source"
Write-Host "目的 $Destination"
Write-Host "記錄 $log"
Write-Host ""

& robocopy $Source $Destination /E /COPY:DAT /DCOPY:DAT /MT:8 /R:2 /W:2 /XJ /FFT /ETA /NFL /NDL /BYTES "/LOG:$log" /TEE
$code = $LASTEXITCODE
Write-Host ""
if ($code -ge 8) {
  Write-Host "有檔沒過去（結束碼 $code）。再執行一次就會補還沒過去的檔。記錄在 $log"
  exit $code
}
Write-Host "這次結束碼 $code。0 到 7 都算成功。再執行一次只會補新檔或沒過去的檔。"
exit 0
