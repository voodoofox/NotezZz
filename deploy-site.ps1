# The site is published twice: GitHub Pages (pages.yml, automatic) and
# https://flatvoxel.com/notezzz/ (this script). Keep both in step with:
#
#   powershell -ExecutionPolicy Bypass -File .\deploy-site.ps1 -SiteOnly
#
# which uploads just the pages (no installer, no latest.json). Without
# -SiteOnly it also refreshes the installer and latest.json on flatvoxel,
# which only installs older than 0.18.12 still read (newer ones update from
# GitHub Releases).
#
# Uses Git's curl - the Windows System32 build can't reach this FTPS host.
# FTP credentials come from deploy.env (gitignored; see README, 'Deploy').
param([switch]$SiteOnly)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'deploy-lib.ps1')

$Curl = 'C:\Program Files\Git\mingw64\bin\curl.exe'
if (-not (Test-Path $Curl)) { throw "Git curl not found at $Curl" }

# Fail fast on a missing deploy.env, before touching any files.
$cfg = Read-DeployEnv (Join-Path $PSScriptRoot 'deploy.env')

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version

if ($SiteOnly) {
  # Stage a copy: the repo's site/index.html keeps its placeholder stamp
  # (pages.yml stamps its own copy), and the old installer, its signature and
  # latest.json on the host stay exactly as they are.
  # Paths are taken relative to the repo's site folder. (A folder under
  # $env:TEMP came back in 8.3 form, ADMINI~1, while the files listed in it
  # came back long, so the relative paths were garbage and landed in a stray
  # remote folder.) Only index.html is rewritten, into a temp file.
  $skip = @('NotezZz-Setup.exe', 'NotezZz-Setup.exe.sig', 'latest.json', '.htaccess')
  $siteRoot = (Get-Item site).FullName
  $stamp = "v$version $([char]0x00B7) $(Get-Date -Format 'd MMM yyyy')"
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $stamped = [System.IO.Path]::GetTempFileName()
  $html = [System.IO.File]::ReadAllText((Join-Path $siteRoot 'index.html'), $utf8)
  $html = [regex]::Replace($html, '(<span data-version>)[^<]*(</span>)', "`${1}$stamp`${2}")
  [System.IO.File]::WriteAllText($stamped, $html, $utf8)

  $Remote = 'domains/flatvoxel.com/htdocs/www/notezzz'
  # Pages last, so a visitor mid-upload never gets a page whose images are missing.
  $files = Get-ChildItem -Recurse -File $siteRoot -Force |
    Where-Object { $skip -notcontains $_.Name } |
    Sort-Object { $_.Extension -eq '.html' }
  $fail = 0
  $netrc = New-CurlNetrc $cfg
  try {
    foreach ($f in $files) {
      if (-not $f.FullName.StartsWith($siteRoot)) { throw "Unexpected path $($f.FullName)" }
      $rel = $f.FullName.Substring($siteRoot.Length + 1) -replace '\\', '/'
      $local = if ($rel -eq 'index.html') { $stamped } else { $f.FullName }
      $ok = Send-FtpFile -Curl $Curl -Netrc $netrc -FtpHost $cfg.FTP_HOST `
        -LocalPath $local -RemotePath "$Remote/$rel" -ConnectTimeout 60
      if (-not $ok) { $fail++ }
    }
  } finally {
    Remove-Item $netrc -Force -ErrorAction SilentlyContinue
    Remove-Item $stamped -Force -ErrorAction SilentlyContinue
  }
  if ($fail -gt 0) { throw "$fail file(s) failed to upload" }
  # The host's front cache can take a few seconds to let the new page through.
  $shown = $false
  for ($i = 0; $i -lt 8 -and -not $shown; $i++) {
    $live = & $Curl -s "https://flatvoxel.com/notezzz/index.html?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
    $shown = $live -match [regex]::Escape("v$version")
    if (-not $shown) { Start-Sleep -Seconds 4 }
  }
  if (-not $shown) { throw "Live page doesn't show v$version after 30s" }
  Write-Host "Done -> https://flatvoxel.com/notezzz/  (pages only, $stamp)" -ForegroundColor Green
  return
}

$exe = "src-tauri\target\release\bundle\nsis\NotezZz_${version}_x64-setup.exe"
if (-not (Test-Path $exe)) { throw "No installer for $version - run npm run tauri build" }

# Stamp the version everywhere the page mentions it.
# Middle dot built from its code point: this file must stay pure ASCII, or
# PowerShell 5.1 reads it as ANSI and the script fails to parse.
$stamp = "v$version $([char]0x00B7) $(Get-Date -Format 'd MMM yyyy')"
# Read and write UTF-8 explicitly, without a BOM. PowerShell 5.1 otherwise
# reads the file as ANSI and writes it back double-encoded, turning every
# em dash in the page into mojibake.
$utf8 = New-Object System.Text.UTF8Encoding($false)
$path = (Resolve-Path site\index.html).Path
$html = [System.IO.File]::ReadAllText($path, $utf8)
$html = [regex]::Replace($html, '(<span data-version>)[^<]*(</span>)', "`${1}$stamp`${2}")
[System.IO.File]::WriteAllText($path, $html, $utf8)

Copy-Item $exe site\NotezZz-Setup.exe -Force

# Updater manifest. The desktop app polls latest.json (tauri-plugin-updater),
# checks the version, downloads the installer and verifies its minisign
# signature against the public key in tauri.conf.json. The .sig is produced
# at build time only when updater.env is loaded into the environment.
$sig = "$exe.sig"
if (-not (Test-Path $sig)) { throw "No signature next to $exe - build with updater.env loaded (see README, 'Deploy')" }
Copy-Item $sig site\NotezZz-Setup.exe.sig -Force
$manifest = [ordered]@{
  version  = $version
  pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  notes    = "NotezZz $version"
  platforms = @{
    'windows-x86_64' = [ordered]@{
      signature = [System.IO.File]::ReadAllText($sig, $utf8).Trim()
      url       = 'https://flatvoxel.com/notezzz/NotezZz-Setup.exe'
    }
  }
}
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'site\latest.json'), ($manifest | ConvertTo-Json -Depth 5), $utf8)
Write-Host "Publishing $stamp" -ForegroundColor Cyan

$FtpHost = $cfg.FTP_HOST
$Remote  = 'domains/flatvoxel.com/htdocs/www/notezzz'

$root = (Resolve-Path site).Path
$fail = 0
$netrc = New-CurlNetrc $cfg
try {
  foreach ($f in Get-ChildItem -Recurse -File site -Force) {
    $rel = $f.FullName.Substring($root.Length + 1) -replace '\\', '/'
    $ok = Send-FtpFile -Curl $Curl -Netrc $netrc -FtpHost $FtpHost `
      -LocalPath $f.FullName -RemotePath "$Remote/$rel" -ConnectTimeout 60
    if (-not $ok) { $fail++ }
  }
} finally {
  Remove-Item $netrc -Force -ErrorAction SilentlyContinue
}
if ($fail -gt 0) { throw "$fail file(s) failed to upload" }

# The download must actually be the build we just stamped.
$size = (& $Curl -sI "https://flatvoxel.com/notezzz/NotezZz-Setup.exe" |
         Select-String -Pattern 'content-length:\s*(\d+)').Matches.Groups[1].Value
if ([int]$size -ne (Get-Item $exe).Length) { throw "Published installer size doesn't match $exe" }
Write-Host "Done -> https://flatvoxel.com/notezzz/  ($stamp, installer verified)" -ForegroundColor Green
