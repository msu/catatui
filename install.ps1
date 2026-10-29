# CataTUI installer for Windows. Run it in PowerShell:
#
#   irm https://raw.githubusercontent.com/msu/catatui/master/install.ps1 | iex
#
# To update CataTUI, run the same command again.
#
# The installer puts all files in ~\.catatui\app:
#   node\  a private copy of Node.js. CataTUI does not use or change the Node.js on your PATH.
#   npm\   the catatui package
#   bin\   the catatui command (catatui.cmd)
# It adds ~\.catatui\app\bin to your user PATH.
# It does not need git, administrator rights, or an installed Node.js.

# "iex" runs the script in the student's PowerShell session. The script block keeps the variables
# and settings local. The script uses "throw" and not "exit", because "exit" closes the window.
& {
  $ErrorActionPreference = "Stop"
  $ProgressPreference = "SilentlyContinue" # The progress bar makes downloads very slow in Windows PowerShell 5.1.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $NodeLine = "latest-v24.x" # Node.js LTS line
  $Package = "https://codeload.github.com/msu/catatui/tar.gz/refs/heads/master"
  $App = if ($env:CATATUI_APP) { $env:CATATUI_APP } else { Join-Path $HOME ".catatui\app" }

  function Fail($message) {
    Write-Host "Install failed: $message" -ForegroundColor Red
    throw "Install failed"
  }

  $arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" { "x64" }
    "ARM64" { "arm64" }
    default { Fail "CataTUI does not support the CPU type $env:PROCESSOR_ARCHITECTURE." }
  }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("catatui-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    # 1. Node.js. Download it only if the version changed.
    Write-Host "Looking for the newest Node.js ($NodeLine)..."
    $dist = "https://nodejs.org/dist/$NodeLine"
    try { $sums = (Invoke-WebRequest "$dist/SHASUMS256.txt" -UseBasicParsing).Content }
    catch { Fail "cannot get the Node.js file list. Check your network connection." }
    $entry = $sums -split "`n" | Where-Object { $_ -match " (node-(v[\d.]+)-win-$arch\.zip)$" } | Select-Object -First 1
    if (-not $entry) { Fail "no Node.js download for win-$arch." }
    $null = $entry -match "^(\w+)\s+(node-(v[\d.]+)-win-$arch)\.zip$"
    $want = $Matches[1]
    $folder = $Matches[2]
    $version = $Matches[3]

    $node = Join-Path $App "node\node.exe"
    if ((Test-Path $node) -and ((& $node --version) -eq $version)) {
      Write-Host "Node.js $version is already installed."
    } else {
      Write-Host "Downloading Node.js $version..."
      $zip = Join-Path $tmp "node.zip"
      try { Invoke-WebRequest "$dist/$folder.zip" -OutFile $zip -UseBasicParsing }
      catch { Fail "cannot download Node.js. Check your network connection." }
      if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $want) { Fail "the Node.js download is damaged. Run this script again." }
      Expand-Archive $zip -DestinationPath $tmp
      New-Item -ItemType Directory -Force -Path $App | Out-Null
      if (Test-Path (Join-Path $App "node")) { Remove-Item -Recurse -Force (Join-Path $App "node") }
      Move-Item (Join-Path $tmp $folder) (Join-Path $App "node")
    }

    # 2. The catatui package. npm needs node on the PATH. Use npm.cmd, because the
    # default execution policy blocks npm.ps1.
    Write-Host "Installing CataTUI..."
    $oldPath = $env:Path
    $env:Path = (Join-Path $App "node") + ";" + $env:Path
    & (Join-Path $App "node\npm.cmd") install --global --prefix (Join-Path $App "npm") --no-fund --no-audit --loglevel=error $Package
    $env:Path = $oldPath
    if ($LASTEXITCODE -ne 0) { Fail "npm cannot install CataTUI. Read the npm error above, then run this script again." }

    # 3. The catatui command. It always uses the private Node.js.
    $bin = Join-Path $App "bin"
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    $script = Join-Path $App "npm\node_modules\catatui\bin\catatui.js"
    Set-Content -Path (Join-Path $bin "catatui.cmd") -Encoding ASCII -Value "@echo off`r`n`"$node`" `"$script`" %*"

    # 4. The PATH. Add the bin folder to the user PATH one time only, and to this window.
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $userPath) { $userPath = "" }
    if (($userPath -split ";") -notcontains $bin) {
      [Environment]::SetEnvironmentVariable("Path", (($userPath.TrimEnd(";") + ";" + $bin).TrimStart(";")), "User")
      Write-Host "Added CataTUI to your user PATH."
    }
    if (($env:Path -split ";") -notcontains $bin) { $env:Path = "$bin;$env:Path" }

    $installed = (& (Join-Path $bin "catatui.cmd") --version) -split " " | Select-Object -Index 1
    Write-Host ""
    Write-Host "CataTUI $installed is installed."
    Write-Host "To start, go to your project folder and type: catatui"
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}
