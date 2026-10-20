Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles() | Out-Null
$RepoZip = 'https://github.com/momohsumomo/PSEHR/archive/refs/heads/main.zip'
$CommitUrl = 'https://api.github.com/repos/momohsumomo/PSEHR/commits/main'
$form = New-Object System.Windows.Forms.Form
$form.Text = '北極星安裝'
$form.ClientSize = New-Object System.Drawing.Size(500, 300)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = New-Object System.Drawing.Font('Microsoft JhengHei', 10)
$title = New-Object System.Windows.Forms.Label
$title.AutoSize = $false
$title.Location = New-Object System.Drawing.Point(16, 12)
$title.Size = New-Object System.Drawing.Size(468, 28)
$title.Font = New-Object System.Drawing.Font('Microsoft JhengHei', 12, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($title)
$body = New-Object System.Windows.Forms.Label
$body.AutoSize = $false
$body.Location = New-Object System.Drawing.Point(16, 48)
$body.Size = New-Object System.Drawing.Size(468, 120)
$form.Controls.Add($body)
$server = New-Object System.Windows.Forms.RadioButton
$server.Text = '服務端（這台放病歷、開網站）'
$server.Location = New-Object System.Drawing.Point(16, 52)
$server.Size = New-Object System.Drawing.Size(460, 28)
$server.Checked = $true
$server.Visible = $false
$form.Controls.Add($server)
$client = New-Object System.Windows.Forms.RadioButton
$client.Text = '客戶端（這台只開看診、讀卡、列印）'
$client.Location = New-Object System.Drawing.Point(16, 88)
$client.Size = New-Object System.Drawing.Size(460, 28)
$client.Visible = $false
$form.Controls.Add($client)
$folder = New-Object System.Windows.Forms.TextBox
$folder.Location = New-Object System.Drawing.Point(16, 176)
$folder.Size = New-Object System.Drawing.Size(360, 24)
$folder.Visible = $false
$form.Controls.Add($folder)
$browse = New-Object System.Windows.Forms.Button
$browse.Text = '瀏覽'
$browse.Location = New-Object System.Drawing.Point(384, 174)
$browse.Size = New-Object System.Drawing.Size(80, 28)
$browse.Visible = $false
$form.Controls.Add($browse)
$back = New-Object System.Windows.Forms.Button
$back.Text = '上一步'
$back.Location = New-Object System.Drawing.Point(210, 252)
$back.Size = New-Object System.Drawing.Size(84, 30)
$form.Controls.Add($back)
$next = New-Object System.Windows.Forms.Button
$next.Text = '下一步'
$next.Location = New-Object System.Drawing.Point(302, 252)
$next.Size = New-Object System.Drawing.Size(84, 30)
$form.Controls.Add($next)
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = '取消'
$cancel.Location = New-Object System.Drawing.Point(394, 252)
$cancel.Size = New-Object System.Drawing.Size(84, 30)
$form.Controls.Add($cancel)
$script:step = 0
$script:done = ''
function Show-Step {
  $server.Visible = $false
  $client.Visible = $false
  $folder.Visible = $false
  $browse.Visible = $false
  $body.Visible = $true
  $back.Enabled = $script:step -gt 0 -and $script:step -lt 3
  $next.Enabled = $true
  $cancel.Enabled = $script:step -ne 3
  $next.Text = '下一步'
  if ($script:step -eq 0) {
    $title.Text = '安裝北極星'
    $body.Text = '下一步選服務端或客戶端，再選資料夾。程式從 GitHub 下載。病歷、讀卡安裝檔、PDF 不在下載裡。'
    $back.Enabled = $false
  } elseif ($script:step -eq 1) {
    $title.Text = '這台電腦是'
    $body.Visible = $false
    $server.Visible = $true
    $client.Visible = $true
  } elseif ($script:step -eq 2) {
    $title.Text = '放到哪個資料夾'
    $body.Text = '選一個空資料夾，或已經放過北極星的資料夾。已有的病歷會留下。'
    $folder.Visible = $true
    $browse.Visible = $true
  } elseif ($script:step -eq 3) {
    $title.Text = '下載中'
    $body.Text = '正從 GitHub 抓程式，請稍候。'
    $back.Enabled = $false
    $next.Enabled = $false
    $cancel.Enabled = $false
  } else {
    $title.Text = '完成'
    $body.Text = $script:done
    $back.Enabled = $false
    $next.Text = '完成'
  }
}
function Install-Role {
  $dest = $folder.Text.Trim()
  if (-not $dest) { throw '請選一個資料夾。' }
  if (Test-Path (Join-Path $dest '.git')) { throw '這個資料夾是開發用的，請另外選一個目錄。' }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $tmp = Join-Path $env:TEMP ('psehr-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    $headers = @{ 'User-Agent' = 'psehr-setup'; Accept = 'application/vnd.github+json' }
    $rels = @(Invoke-RestMethod -Headers $headers -Uri 'https://api.github.com/repos/momohsumomo/PSEHR/releases?per_page=30')
    $program = $rels | Where-Object { [string]$_.tag_name -like 'program-*' } | Select-Object -First 1
    $sha = ''
    $version = ''
    $zipUrl = $RepoZip
    if ($program) {
      $version = [string]$program.tag_name
      $sha = [string]$program.target_commitish
      if ($program.zipball_url) { $zipUrl = [string]$program.zipball_url }
    }
    if (-not $sha) {
      $meta = Invoke-RestMethod -Headers $headers -Uri $CommitUrl
      $sha = [string]$meta.sha
    }
    if (-not $sha) { throw 'GitHub 沒有回版號。' }
    $zip = Join-Path $tmp 'src.zip'
    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'psehr-setup' } -Uri $zipUrl -OutFile $zip
    $expanded = Join-Path $tmp 'src'
    Expand-Archive -Path $zip -DestinationPath $expanded -Force
    $top = Get-ChildItem $expanded -Directory | Select-Object -First 1
    if (-not $top) { throw '下載的檔案打不開。' }
    if ($server.Checked) {
      & robocopy $top.FullName $dest /E /XD data .venv .git node_modules /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { throw ('copy ' + $LASTEXITCODE) }
      $stamp = @{ commit = $sha; version = $version; installedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json
      Set-Content -Path (Join-Path $dest 'program.json') -Value $stamp -Encoding UTF8
      $script:done = '已放到這個資料夾。接著雙擊「安裝-主機必要工具」，裝好 Python 和 Node，再雙擊「啟動-Wundadi門診」。病歷長在 data，以後更新軟體不會蓋掉它。'
    } else {
      $clientDir = Join-Path $top.FullName '客戶端'
      if (-not (Test-Path $clientDir)) { throw '下載裡沒有客戶端資料夾。' }
      & robocopy $clientDir $dest /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { throw ('copy ' + $LASTEXITCODE) }
      $script:done = '已放到這個資料夾。雙擊「開啟門診」。讀卡安裝檔和 PDF 要另外放進來；這裡已經有的檔不會被刪掉。'
    }
  } finally {
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
  }
}
$browse.Add_Click({
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  if ($dlg.ShowDialog() -eq 'OK') { $folder.Text = $dlg.SelectedPath }
})
$cancel.Add_Click({ $form.Close() })
$back.Add_Click({ if ($script:step -gt 0 -and $script:step -lt 3) { $script:step--; Show-Step } })
$next.Add_Click({
  if ($script:step -lt 2) { $script:step++; Show-Step; return }
  if ($script:step -eq 2) {
    if (-not $folder.Text.Trim()) {
      [void][System.Windows.Forms.MessageBox]::Show('請選一個資料夾。')
      return
    }
    $script:step = 3
    Show-Step
    $form.Refresh()
    try {
      Install-Role
      $script:step = 4
      Show-Step
    } catch {
      $script:step = 2
      Show-Step
      [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message)
    }
    return
  }
  $form.Close()
})
Show-Step
[void]$form.ShowDialog()

