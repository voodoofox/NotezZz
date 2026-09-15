# Builds the NotezZz web bundle and deploys the WHOLE thing to
# https://flatvoxel.com/NotezZz/ via explicit-FTPS (control-channel TLS).
#
# Always uploads every file so hashed chunks never go out of sync with
# index.html (a partial upload = white screen). Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File .\deploy-web.ps1
#
# NOTE: uses Git's curl, NOT the Windows System32 curl - the System32 build
# fails to connect to this FTPS server (exit 7). Git for Windows is required.
# FTP credentials come from deploy.env (gitignored; see README, 'Deploy').
# This file must stay pure ASCII (PowerShell 5.1 parses BOM-less files as ANSI).

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'deploy-lib.ps1')

$Curl = 'C:\Program Files\Git\mingw64\bin\curl.exe'
if (-not (Test-Path $Curl)) { throw "Git curl not found at $Curl (install Git for Windows)" }

# Fail fast on a missing deploy.env, before the slow build.
$cfg = Read-DeployEnv (Join-Path $PSScriptRoot 'deploy.env')

Write-Host "Building web bundle (base=/NotezZz)..." -ForegroundColor Cyan
$env:BASE_PATH = '/NotezZz'
# Through cmd with stderr merged: PowerShell 5.1 turns any native stderr line
# (a Vite warning) into a terminating error under Stop, and aborted a deploy.
cmd /c "npm run build 2>&1"
if ($LASTEXITCODE -ne 0) { throw "web build failed (exit $LASTEXITCODE)" }
Remove-Item Env:\BASE_PATH
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

$FtpHost = $cfg.FTP_HOST
$Remote  = 'domains/flatvoxel.com/htdocs/www/NotezZz'

Write-Host "Uploading build\ -> $Remote ..." -ForegroundColor Cyan
$root = (Resolve-Path build).Path
$files = Get-ChildItem -Recurse -File build -Force

# Upload order matters. index.html references hashed chunks under _app/; if the
# new index lands before its chunks exist, every visitor during the (multi-
# minute) upload gets a white screen. So: all assets first, then the entry
# files, with index.html before version.json - installed PWAs poll version.json
# and reload when the stamp changes, and that reload must find the new index.
$entryOrder = @('.htaccess', 'manifest.webmanifest', 'index.html', 'version.json')
$assets = @()
$entries = @{}
foreach ($f in $files) {
  $rel = $f.FullName.Substring($root.Length + 1) -replace '\\', '/'
  $item = @{ Path = $f.FullName; Rel = $rel }
  if ($entryOrder -contains $rel) { $entries[$rel] = $item } else { $assets += $item }
}
$ordered = @($assets) + @($entryOrder | Where-Object { $entries.ContainsKey($_) } | ForEach-Object { $entries[$_] })

$fail = 0
$netrc = New-CurlNetrc $cfg
try {
  foreach ($item in $ordered) {
    $ok = Send-FtpFile -Curl $Curl -Netrc $netrc -FtpHost $FtpHost `
      -LocalPath $item.Path -RemotePath "$Remote/$($item.Rel)" -ConnectTimeout 25
    if (-not $ok) { $fail++ }
  }
} finally {
  Remove-Item $netrc -Force -ErrorAction SilentlyContinue
}

if ($fail -gt 0) { throw "$fail file(s) failed to upload" }

# Smoke-check: every JS/CSS the live index references must return 200.
$idx = & $Curl -s "https://flatvoxel.com/NotezZz/"
$bad = 0
[regex]::Matches($idx, '/NotezZz/[^"'']+\.(js|css)') | ForEach-Object { $_.Value } | Sort-Object -Unique | ForEach-Object {
  $code = & $Curl -s -o NUL -w "%{http_code}" "https://flatvoxel.com$_"
  if ($code -ne '200') { Write-Host "BAD $code $_" -ForegroundColor Red; $bad++ }
}
if ($bad -gt 0) { throw "$bad live asset(s) not resolving" }
Write-Host "Done -> https://flatvoxel.com/NotezZz/ (all assets verified)" -ForegroundColor Green
