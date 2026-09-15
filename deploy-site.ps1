# OPTIONAL since 0.18.12: the site lives on GitHub Pages (pages.yml) and
# installs look for updates on GitHub Releases (release.yml). Run this only
# to keep the flatvoxel.com copy in step for installs older than 0.18.12.
#
# Publishes the marketing site to https://flatvoxel.com/notezzz/ and refreshes
# the downloadable installer, stamping the current version into the page so the
# site can never advertise a build it isn't serving.
#
#   powershell -ExecutionPolicy Bypass -File .\deploy-site.ps1
#
# Uses Git's curl - the Windows System32 build can't reach this FTPS host.
# FTP credentials come from deploy.env (gitignored; see README, 'Deploy').

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'deploy-lib.ps1')

$Curl = 'C:\Program Files\Git\mingw64\bin\curl.exe'
if (-not (Test-Path $Curl)) { throw "Git curl not found at $Curl" }

# Fail fast on a missing deploy.env, before touching any files.
$cfg = Read-DeployEnv (Join-Path $PSScriptRoot 'deploy.env')

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
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
