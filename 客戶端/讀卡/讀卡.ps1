param([switch]$SelfTest)

$ErrorActionPreference = "Stop"
Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class LocalhostTrust : ICertificatePolicy {
  public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::CertificatePolicy = New-Object LocalhostTrust

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = (Get-Location).Path }
$ConfigPath = Join-Path $Root "讀卡機.json"

$Codes = @{
  1000 = "控制軟體還沒初始化"
  1002 = "找不到安全模組"
  1100 = "沒有發現讀卡機"
  1101 = "還沒指定讀卡機槽"
  1102 = "這個槽沒有插卡"
  1103 = "卡片應用程式切換失敗"
  1199 = "讀卡機發生其它錯誤"
  1302 = "醫事機構已超過合約期間"
  1303 = "醫事機構已停權"
  1304 = "SAM 已註銷"
  1400 = "醫事人員卡進入模式一失敗"
  1401 = "醫事人員卡進入模式二失敗"
  1402 = "醫事人員卡還沒驗過 PIN"
  1410 = "醫事人員卡 PIN 不對"
  1422 = "醫事人員憑證不在有效期，或醫師卡已過期"
  1500 = "健保卡進入模式一失敗，這個槽沒讀到健保卡"
  1501 = "健保卡進入模式二失敗，請確認 SAM 已驗證"
  1502 = "健保卡進入模式三失敗"
  1516 = "請先把醫事人員卡拔掉，再讀健保卡"
  1600 = "這個讀卡機名稱已經不在"
  1610 = "SAM 檔格式不對"
  1611 = "找不到這個雲端安全模組"
  1700 = "連不到健保署，請先確認醫療網"
  1703 = "跟健保署的連線逾期，請再按一次驗證 SAM"
}

function Get-CodeText([int]$Code) {
  if ($Codes.ContainsKey($Code)) { return "$($Codes[$Code])（$Code）" }
  return "讀卡軟體回報錯誤 $Code"
}

function Invoke-Api {
  param(
    [ValidateSet("GET", "POST")][string]$Method,
    [string]$Path,
    $Body
  )
  $params = @{
    Uri        = "https://127.0.0.1:5066$Path"
    Method     = $Method
    TimeoutSec = 45
  }
  if ($PSBoundParameters.ContainsKey("Body")) {
    $json = "{}"
    if ($null -ne $Body) { $json = $Body | ConvertTo-Json -Compress -Depth 6 }
    $params.Body = [Text.Encoding]::UTF8.GetBytes($json)
    $params.ContentType = "application/json; charset=utf-8"
  }
  try {
    $resp = Invoke-RestMethod @params
  } catch {
    $detail = $_.Exception.Message
    if ($_.Exception.Response) {
      try {
        $reader = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
        $text = $reader.ReadToEnd()
        if ($text) { $detail = $text }
      } catch {}
    }
    if ($detail -match "拒絕|無法連接|actively refused|timed out|無法連線") {
      throw "讀卡控制軟體沒有在跑。請先打開讀卡機控制軟體 6.0。"
    }
    throw $detail
  }
  if ($resp.PSObject.Properties.Name -contains "statusCode" -and [int]$resp.statusCode -ne 0) {
    throw (Get-CodeText ([int]$resp.statusCode))
  }
  return $resp
}

function Get-CloudSamId {
  $list = Invoke-Api -Method GET -Path "/api/settings/v1/CloudSam"
  $items = @($list.sams)
  if ($items.Count -eq 0 -or -not $items[0].samId) {
    throw "這台還沒匯入 SAM。按「匯入 SAM」。"
  }
  return [string]$items[0].samId
}

function Ensure-Ready([string]$Reader) {
  $samId = Get-CloudSamId
  if ($Reader) {
    Invoke-Api -Method POST -Path "/api/settings/v1/PcscReader/Default" -Body @{ readerName = $Reader } | Out-Null
  }
  $status = Invoke-Api -Method GET -Path "/api/common/v1/Status"
  $restart = -not [bool]$status.status.initialized
  if ([string]$status.status.name -ne $samId) { $restart = $true }
  if ($Reader -and [string]$status.status.readerName -ne $Reader) { $restart = $true }
  if ($restart -and [bool]$status.status.initialized) {
    Invoke-Api -Method POST -Path "/api/common/v1/Finalize" -Body @{} | Out-Null
  }
  if ($restart) {
    Invoke-Api -Method POST -Path "/api/common/v1/Initial" -Body @{ name = $samId } | Out-Null
  }
  $status = Invoke-Api -Method GET -Path "/api/common/v1/Status"
  if ([int]$status.status.sam.status -ne 2) {
    Invoke-Api -Method POST -Path "/api/sam/v1/Verification" -Body @{} | Out-Null
    $status = Invoke-Api -Method GET -Path "/api/common/v1/Status"
  }
  return $status
}

function Get-Readers {
  $list = Invoke-Api -Method GET -Path "/api/settings/v1/PcscReader/Readers"
  return @($list.readers | Where-Object { $_ })
}

function Read-Config {
  if (-not (Test-Path -LiteralPath $ConfigPath)) { return $null }
  return Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Save-Config([string]$Hpc, [string]$Hc) {
  $json = @{ hpcReader = $Hpc; hcReader = $Hc } | ConvertTo-Json
  $utf8 = New-Object System.Text.UTF8Encoding $true
  [IO.File]::WriteAllText($ConfigPath, $json, $utf8)
}

if ($SelfTest) {
  $status = Invoke-Api -Method GET -Path "/api/common/v1/Status"
  $readers = Get-Readers
  $default = Invoke-Api -Method GET -Path "/api/settings/v1/PcscReader/Default"
  Write-Output ("sam=" + $status.status.sam.status + " reader=" + $status.status.readerName)
  Write-Output ("readers=" + ($readers -join " | "))
  Write-Output ("default=" + $default.readerName)
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$font = New-Object System.Drawing.Font("Microsoft JhengHei UI", 12)
$fontBold = New-Object System.Drawing.Font("Microsoft JhengHei UI", 12, [System.Drawing.FontStyle]::Bold)
$form = New-Object System.Windows.Forms.Form
$form.Text = "讀卡"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(760, 700)
$form.Font = $font
$form.MinimumSize = New-Object System.Drawing.Size(760, 640)

function New-Label([string]$Text, [int]$X, [int]$Y, [int]$W, [int]$H) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.Location = New-Object System.Drawing.Point($X, $Y)
  $label.Size = New-Object System.Drawing.Size($W, $H)
  return $label
}

function New-Button([string]$Text, [int]$X, [int]$Y, [int]$W) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Location = New-Object System.Drawing.Point($X, $Y)
  $button.Size = New-Object System.Drawing.Size($W, 42)
  return $button
}

$intro = New-Label "PCSC 就是這台健保讀卡機，不是另一種機器。Windows 把它分成兩個槽：結尾 0 通常插健保卡，結尾 1 通常插醫事人員卡。1101 代表還沒指定要用哪一槽。" 16 12 728 68
$lblSam = New-Label "SAM：尚未讀取" 16 88 728 28
$lblHpcState = New-Label "醫事人員卡：尚未讀取" 16 118 728 28
$lblHcState = New-Label "健保卡：尚未讀取" 16 148 728 28
$lblSam.Font = $fontBold
$lblHpcState.Font = $fontBold
$lblHcState.Font = $fontBold

$lblHpcSlot = New-Label "醫事人員卡插在" 16 190 150 28
$cboHpc = New-Object System.Windows.Forms.ComboBox
$cboHpc.DropDownStyle = "DropDownList"
$cboHpc.Location = New-Object System.Drawing.Point(170, 186)
$cboHpc.Size = New-Object System.Drawing.Size(560, 32)
$lblHcSlot = New-Label "健保卡插在" 16 230 150 28
$cboHc = New-Object System.Windows.Forms.ComboBox
$cboHc.DropDownStyle = "DropDownList"
$cboHc.Location = New-Object System.Drawing.Point(170, 226)
$cboHc.Size = New-Object System.Drawing.Size(560, 32)

$btnSave = New-Button "記住這兩個槽" 16 268 180
$btnRefresh = New-Button "重新整理" 206 268 140
$btnImport = New-Button "匯入 SAM" 356 268 140
$btnSam = New-Button "驗證 SAM" 506 268 220

$lblPin = New-Label "醫事人員卡 PIN" 16 326 150 28
$txtPin = New-Object System.Windows.Forms.TextBox
$txtPin.UseSystemPasswordChar = $true
$txtPin.Location = New-Object System.Drawing.Point(170, 322)
$txtPin.Size = New-Object System.Drawing.Size(180, 32)
$btnHpc = New-Button "驗證醫事人員卡" 364 316 180
$btnHc = New-Button "讀健保卡" 554 316 176

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = "Vertical"
$log.Location = New-Object System.Drawing.Point(16, 372)
$log.Size = New-Object System.Drawing.Size(728, 308)
$log.Font = New-Object System.Drawing.Font("Microsoft JhengHei UI", 11)
$log.Anchor = "Top,Bottom,Left,Right"

$form.Controls.AddRange(@($intro, $lblSam, $lblHpcState, $lblHcState, $lblHpcSlot, $cboHpc, $lblHcSlot, $cboHc, $btnSave, $btnRefresh, $btnImport, $btnSam, $lblPin, $txtPin, $btnHpc, $btnHc, $log))

function Add-Log([string]$Line) {
  $stamp = Get-Date -Format "HH:mm:ss"
  $log.AppendText("$stamp  $Line`r`n")
}

function Set-StateLabel($Label, [string]$Text, [string]$Kind) {
  $Label.Text = $Text
  if ($Kind -eq "ok") { $Label.ForeColor = [System.Drawing.Color]::DarkGreen }
  elseif ($Kind -eq "wait") { $Label.ForeColor = [System.Drawing.Color]::DarkGoldenrod }
  elseif ($Kind -eq "bad") { $Label.ForeColor = [System.Drawing.Color]::Firebrick }
  else { $Label.ForeColor = [System.Drawing.Color]::Black }
}

function Show-Status($Status) {
  $sam = [int]$Status.status.sam.status
  $samType = [int]$Status.status.sam.type
  $typeName = switch ($samType) { 1 { "雲端" } 2 { "實體" } default { "" } }
  $until = ""
  if ($Status.status.sam.expireTime) {
    try { $until = "，有效到 " + ([datetime]$Status.status.sam.expireTime).ToString("MM/dd HH:mm") } catch {}
  }
  if ($sam -eq 2) { Set-StateLabel $lblSam "SAM：已驗證 $typeName$until" "ok" }
  elseif ($sam -eq 1) { Set-StateLabel $lblSam "SAM：已載入，還沒向健保署驗證" "wait" }
  else { Set-StateLabel $lblSam "SAM：還沒連接" "bad" }

  $hpc = [int]$Status.status.hpc.status
  $hpcType = switch ([int]$Status.status.hpc.type) { 1 { "醫師卡" } 2 { "醫事人員卡" } 3 { "行動憑證" } default { "" } }
  if ($hpc -eq 3) { Set-StateLabel $lblHpcState "醫事人員卡：PIN 已驗證 $hpcType" "ok" }
  elseif ($hpc -ge 1) { Set-StateLabel $lblHpcState "醫事人員卡：卡片在，還沒驗完 PIN $hpcType" "wait" }
  else { Set-StateLabel $lblHpcState "醫事人員卡：這個槽目前沒看到卡" "bad" }

  $hc = [int]$Status.status.hc.status
  if ($hc -ge 2) { Set-StateLabel $lblHcState "健保卡：已驗證" "ok" }
  elseif ($hc -eq 1) { Set-StateLabel $lblHcState "健保卡：卡片在，還沒完成驗證" "wait" }
  else { Set-StateLabel $lblHcState "健保卡：這個槽目前沒看到卡" "bad" }
}

function Fill-Readers {
  $names = @(Get-Readers)
  $config = Read-Config
  $hpcPrefer = @()
  $hcPrefer = @()
  if ($config -and $config.hpcReader) { $hpcPrefer += [string]$config.hpcReader }
  if ($config -and $config.hcReader) { $hcPrefer += [string]$config.hcReader }
  $hpcPrefer += "Generic Smart Card Reader Interface 1"
  $hcPrefer += "Generic Smart Card Reader Interface 0"
  $cboHpc.Items.Clear()
  $cboHc.Items.Clear()
  foreach ($name in $names) {
    [void]$cboHpc.Items.Add($name)
    [void]$cboHc.Items.Add($name)
  }
  foreach ($name in $hpcPrefer) { if ($cboHpc.Items.Contains($name)) { $cboHpc.SelectedItem = $name; break } }
  foreach ($name in $hcPrefer) { if ($cboHc.Items.Contains($name)) { $cboHc.SelectedItem = $name; break } }
  if (-not $cboHpc.SelectedItem -and $cboHpc.Items.Count -gt 0) { $cboHpc.SelectedIndex = 0 }
  if (-not $cboHc.SelectedItem -and $cboHc.Items.Count -gt 0) { $cboHc.SelectedIndex = 0 }
}

function Run-Action([scriptblock]$Action) {
  $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  foreach ($button in @($btnSave, $btnRefresh, $btnImport, $btnSam, $btnHpc, $btnHc)) { $button.Enabled = $false }
  try { & $Action }
  catch { Add-Log $_.Exception.Message }
  finally {
    foreach ($button in @($btnSave, $btnRefresh, $btnImport, $btnSam, $btnHpc, $btnHc)) { $button.Enabled = $true }
    $form.Cursor = [System.Windows.Forms.Cursors]::Default
  }
}

$btnRefresh.Add_Click({
  Run-Action {
    Fill-Readers
    $status = Invoke-Api -Method GET -Path "/api/common/v1/Status"
    Show-Status $status
    Add-Log "已重新整理。"
  }
})

$btnSave.Add_Click({
  Run-Action {
    if (-not $cboHpc.SelectedItem -or -not $cboHc.SelectedItem) { throw "還沒看到讀卡機。請確認讀卡機有插上，再按重新整理。" }
    Save-Config ([string]$cboHpc.SelectedItem) ([string]$cboHc.SelectedItem)
    Add-Log "已記住。醫事人員卡用「$($cboHpc.SelectedItem)」，健保卡用「$($cboHc.SelectedItem)」。"
  }
})

$btnImport.Add_Click({
  Run-Action {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = "SAM 檔 (*.SAM)|*.SAM"
    $dialog.InitialDirectory = [Environment]::GetFolderPath("Desktop")
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }
    $file = Get-Item -LiteralPath $dialog.FileName
    $stem = [IO.Path]::GetFileNameWithoutExtension($file.Name)
    if ($stem.Length -ne 22) { throw "檔名不能改。要是 10 碼機構代碼加 12 碼 SAM 代碼，再加 .SAM。" }
    $body = @{
      hospitalId       = $stem.Substring(0, 10)
      samId            = $stem.Substring(10, 12)
      cloudSamContext  = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))
    }
    $added = Invoke-Api -Method POST -Path "/api/settings/v1/CloudSam" -Body $body
    Add-Log ("已匯入 " + $added.sam.hospitalName + "，SAM " + $added.sam.samId)
    $status = Ensure-Ready ([string]$cboHpc.SelectedItem)
    Show-Status $status
  }
})

$btnSam.Add_Click({
  Run-Action {
    $status = Ensure-Ready ([string]$cboHpc.SelectedItem)
    $basic = Invoke-Api -Method GET -Path "/api/sam/v1/Basic"
    Show-Status $status
    Add-Log ("SAM 已驗證：" + $basic.hospitalName + "（" + $basic.hospitalId + "）")
  }
})

$btnHpc.Add_Click({
  Run-Action {
    $pin = $txtPin.Text.Trim()
    if (-not $pin) { throw "請先輸入醫事人員卡 PIN。" }
    if (-not $cboHpc.SelectedItem) { throw "請先選擇醫事人員卡的槽。" }
    $status = Ensure-Ready ([string]$cboHpc.SelectedItem)
    Invoke-Api -Method POST -Path "/api/hpc/v1/Verification/Hpc" -Body @{ pin = $pin } | Out-Null
    $basic = Invoke-Api -Method GET -Path "/api/hpc/v1/Basic"
    $status = Invoke-Api -Method GET -Path "/api/common/v1/Status"
    Show-Status $status
    $txtPin.Clear()
    Add-Log ("醫事人員卡已驗證：" + $basic.cName + "　" + $basic.idNo)
  }
})

$btnHc.Add_Click({
  Run-Action {
    if (-not $cboHc.SelectedItem) { throw "請先選擇健保卡的槽。" }
    $status = Ensure-Ready ([string]$cboHc.SelectedItem)
    $basic = Invoke-Api -Method GET -Path "/api/hc/v1/Basic"
    $status = Invoke-Api -Method GET -Path "/api/common/v1/Status"
    Show-Status $status
    $sex = switch ([string]$basic.sex) { "M" { "男" } "F" { "女" } default { [string]$basic.sex } }
    Add-Log ("健保卡：" + $basic.name + "　" + $basic.idNo + "　" + $basic.birthday + "　" + $sex)
  }
})

$form.Add_Shown({
  Run-Action {
    Fill-Readers
    $status = Invoke-Api -Method GET -Path "/api/common/v1/Status"
    Show-Status $status
    Add-Log "讀卡機已指定。若醫事人員卡驗證仍失敗，把上面兩個槽對調後再試一次。"
  }
})

[void]$form.ShowDialog()
