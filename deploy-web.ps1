# Builds the NotezZz web bundle and deploys the WHOLE thing to
# https://flatvoxel.com/NotezZz/ via explicit-FTPS (control-channel TLS).
#
# Always uploads every file so hashed chunks never go out of sync with
# index.html (a partial upload = white screen). Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File .\deploy-web.ps1
#
# NOTE: uses Git's curl, NOT the Windows System32 curl — the System32 build
# fails to connect to this FTPS server (exit 7). Git for Windows is required.
# FTP credentials are the scoped sub-user from cred.txt (upload-only).

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$Curl = 'C:\Program Files\Git\mingw64\bin\curl.exe'
if (-not (Test-Path $Curl)) { throw "Git curl not found at $Curl (install Git for Windows)" }

Write-Host "Building web bundle (base=/NotezZz)..." -ForegroundColor Cyan
$env:BASE_PATH = '/NotezZz'
npm run build
Remove-Item Env:\BASE_PATH
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

$FtpUser = '***REMOVED***'
$FtpPass = '***REMOVED***'
$FtpHost = 'divine-butterfly.flatvoxelcom.webinf.buildingtogether.io'
$Remote  = 'domains/flatvoxel.com/htdocs/www/NotezZz'

Write-Host "Uploading build\ -> $Remote ..." -ForegroundColor Cyan
$root = (Resolve-Path build).Path
$files = Get-ChildItem -Recurse -File build
$fail = 0
foreach ($f in $files) {
  $rel = $f.FullName.Substring($root.Length + 1) -replace '\\', '/'
  $ok = $false
  for ($a = 0; $a -lt 3; $a++) {
    & $Curl -s --ftp-ssl-control -k --connect-timeout 25 --ftp-create-dirs `
      -T $f.FullName "ftp://${FtpUser}:${FtpPass}@${FtpHost}/${Remote}/${rel}" | Out-Null
    # exit 56 = TLS teardown quirk AFTER the file landed = success
    if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 56) { $ok = $true; break }
  }
  if (-not $ok) { Write-Host "FAIL($LASTEXITCODE) $rel" -ForegroundColor Red; $fail++ }
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
