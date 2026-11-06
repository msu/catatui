# catai installer for Windows (internal test build). Run it in PowerShell:
#
#   irm https://catatui.cs.montana.edu/catai/install.ps1 | iex
#
# To update catai, run the same command again. The installer closes catai and catatui first.
#
# The installer:
#   1. installs catatui with the catatui installer (Node.js, the catatui package, and git from dugite);
#   2. gets the catai app (the desktop folder of the repository) into ~\.catatui\app\catai;
#   3. installs its packages (Electron and Vite) and builds it on this computer;
#   4. adds "catai" to the Start menu.
# It does not need git, administrator rights, or an installed Node.js.
# To remove catai: delete ~\.catatui\app\catai and the Start menu item "catai".

& {
  $ErrorActionPreference = "Stop"
  $ProgressPreference = "SilentlyContinue" # The progress bar makes downloads very slow in Windows PowerShell 5.1.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $Site = if ($env:CATATUI_SITE) { $env:CATATUI_SITE } else { "https://catatui.cs.montana.edu" }
  # The commit to install. catatui and catai come from the same commit. To release a new version, change it.
  $Commit = "6a6d61d532ef21e518c9ac793c2935effe3c441c"
  $Repo = "https://codeload.github.com/msu/catatui/tar.gz/$Commit"
  $App = if ($env:CATATUI_APP) { $env:CATATUI_APP } else { Join-Path $HOME ".catatui\app" }
  $Catai = Join-Path $App "catai"

  function Fail($message) {
    Write-Host "Install failed: $message" -ForegroundColor Red
    throw "Install failed"
  }

  # 0. Stop catai and other programs from the catatui folder (catatui, its git). Windows does not let the
  # install replace files that a program uses. If npm cannot replace them, the catatui package is incomplete.
  $running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($App, [StringComparison]::OrdinalIgnoreCase) })
  if ($running.Count -gt 0) {
    Write-Host "Closing catai and catatui..."
    foreach ($p in $running) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
  }

  # 1. catatui. catai starts catatui for each project, and uses its files (root.json below).
  Write-Host "Installing catatui (catai uses it)..."
  try { $content = (Invoke-WebRequest "$Site/install.ps1" -UseBasicParsing).Content }
  catch { Fail "cannot get the catatui installer from $Site. Check your network connection." }
  # GitHub Pages sends .ps1 files as application/octet-stream, so PowerShell gives bytes, not text.
  $script = if ($content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($content) } else { $content }
  # The catatui installer reads CATATUI_PACKAGE. Remove it after, because it stays in this PowerShell window.
  $env:CATATUI_PACKAGE = $Repo
  try { Invoke-Expression $script } finally { Remove-Item Env:CATATUI_PACKAGE -ErrorAction SilentlyContinue }
  $node = Join-Path $App "node"
  $npm = Join-Path $node "npm.cmd"
  $pkg = Join-Path $App "npm\node_modules\catatui"
  if (-not (Test-Path (Join-Path $pkg "bin\catatui.js"))) { Fail "catatui is not in $pkg after the install." }
  if (-not (Test-Path (Join-Path $pkg "node_modules\dugite\git\cmd\git.exe"))) { Fail "the git download of catatui (dugite) failed. Check that this computer can download from github.com, then run this script again." }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("catai-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $oldPath = $env:Path
  try {
    # 2. The app files: the desktop folder of the repository.
    Write-Host ""
    Write-Host "Downloading catai..."
    $tgz = Join-Path $tmp "catatui.tgz"
    try { Invoke-WebRequest $Repo -OutFile $tgz -UseBasicParsing }
    catch { Fail "cannot download catai from GitHub. Check your network connection." }
    # The tar.exe of Windows (bsdtar), not a GNU tar from another program on the PATH.
    & (Join-Path $env:SystemRoot "System32\tar.exe") -xzf $tgz -C $tmp
    if ($LASTEXITCODE -ne 0) { Fail "cannot unpack the catai download." }
    $src = Get-ChildItem $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName "desktop\main.js") } | Select-Object -First 1
    if (-not $src) { Fail "the catai download has no desktop folder." }

    # Antivirus or Explorer can hold a file for some seconds, so try 5 times.
    for ($i = 1; (Test-Path $Catai) -and $i -le 5; $i++) {
      try { Remove-Item -Recurse -Force $Catai }
      catch {
        if ($i -eq 5) { Fail "cannot replace the old catai files ($($_.Exception.Message)). Close catai and all File Explorer windows in $Catai, then run this script again." }
        Start-Sleep -Seconds 2
      }
    }
    New-Item -ItemType Directory -Force -Path $App | Out-Null
    Move-Item (Join-Path $src.FullName "desktop") $Catai

    # 3. The packages and the build. npm and Vite need node on the PATH. Use npm.cmd, because the
    # default execution policy blocks npm.ps1. Electron (about 100 MB) comes from GitHub.
    $env:Path = "$node;$env:Path"
    Push-Location $Catai
    try {
      Write-Host "Installing the catai packages (Electron). This can take some minutes..."
      & $npm install --no-fund --no-audit --loglevel=error
      if ($LASTEXITCODE -ne 0) { Fail "npm cannot install the catai packages. Read the npm error above, then run this script again." }
      # Electron 44 has no postinstall script: it downloads its program on first use, and it unzips with a native
      # module that Windows can refuse to load. So download and unpack Electron here, with the checksum from the
      # Electron package. This makes the same files as the Electron install.js: dist\ and path.txt.
      $epkg = Join-Path $Catai "node_modules\electron"
      $ever = (Get-Content (Join-Path $epkg "package.json") -Raw | ConvertFrom-Json).version
      $earch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
      $ename = "electron-v$ever-win32-$earch.zip"
      $esum = (Get-Content (Join-Path $epkg "checksums.json") -Raw | ConvertFrom-Json).$ename
      if (-not $esum) { Fail "the Electron package has no checksum for $ename." }
      Write-Host "Downloading Electron $ever ($earch)..."
      $ezip = Join-Path $tmp $ename
      try { Invoke-WebRequest "https://github.com/electron/electron/releases/download/v$ever/$ename" -OutFile $ezip -UseBasicParsing }
      catch { Fail "cannot download Electron. Check that this computer can download from github.com, then run this script again." }
      if ((Get-FileHash $ezip -Algorithm SHA256).Hash.ToLower() -ne $esum) { Fail "the Electron download is damaged. Run this script again." }
      $edist = Join-Path $epkg "dist"
      if (Test-Path $edist) { Remove-Item -Recurse -Force $edist }
      Expand-Archive $ezip -DestinationPath $edist
      # No line end: the Electron package reads path.txt as it is.
      [IO.File]::WriteAllText((Join-Path $epkg "path.txt"), "electron.exe")
      Write-Host "Building catai..."
      & $npm run build --silent
      if ($LASTEXITCODE -ne 0) { Fail "the catai build failed. Read the error above." }
    } finally {
      Pop-Location
    }

    # root.json: catai uses the installed catatui package (bin, src, node_modules), so both have the same version.
    Set-Content -Path (Join-Path $Catai "root.json") -Encoding ASCII -Value ('{ "root": ' + (ConvertTo-Json $pkg) + ' }')

    # 4. The Start menu item. It starts Electron with the catai folder.
    $electron = Join-Path $Catai "node_modules\electron\dist\electron.exe"
    if (-not (Test-Path $electron)) { Fail "Electron is not in $electron. Run this script again." }
    $lnk = Join-Path ([Environment]::GetFolderPath("Programs")) "catai.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $item = $shell.CreateShortcut($lnk)
    $item.TargetPath = $electron
    $item.Arguments = '"' + $Catai + '"'
    $item.WorkingDirectory = $Catai
    $item.IconLocation = (Join-Path $Catai "build\icon.ico")
    $item.Description = "catai: your AI agent at Montana State University"
    $item.Save()

    Write-Host ""
    Write-Host "catai is installed. Open it from the Start menu: catai."
  } finally {
    $env:Path = $oldPath
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}
