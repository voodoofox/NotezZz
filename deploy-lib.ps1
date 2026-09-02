# Shared helpers for deploy-web.ps1 and deploy-site.ps1. Dot-source it:
#   . (Join-Path $PSScriptRoot 'deploy-lib.ps1')
#
# This file must stay pure ASCII: PowerShell 5.1 reads a BOM-less script as
# ANSI, so one non-ASCII character breaks parsing. Files are read and written
# through System.IO with an explicit BOM-less UTF-8 encoding for the same
# reason (Get-Content / Set-Content mangle UTF-8 under 5.1).

$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# Reads deploy.env (gitignored, next to the scripts) into a hashtable.
# Format: KEY=VALUE per line; blank lines and lines starting with # ignored.
# Required keys: FTP_USER, FTP_PASS, FTP_HOST.
function Read-DeployEnv {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path $Path)) {
    throw ("Missing $Path - create it with FTP_USER=, FTP_PASS= and FTP_HOST= lines " +
           "(see README, 'Deploy'). It is gitignored; never commit it.")
  }
  $cfg = @{}
  $text = [System.IO.File]::ReadAllText($Path, $script:Utf8NoBom)
  foreach ($line in ($text -split "`r?`n")) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { throw "deploy.env: cannot parse line '$t' (expected KEY=VALUE)" }
    $cfg[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
  }
  foreach ($k in 'FTP_USER', 'FTP_PASS', 'FTP_HOST') {
    if (-not $cfg[$k]) { throw "deploy.env: $k is missing or empty" }
  }
  return $cfg
}

# Writes the FTP credentials to a private temp netrc file so they never appear
# on curl's command line (ftp://user:pass@host in a URL is readable by every
# process on the machine via the process list). The caller MUST delete the
# returned path in a finally block.
function New-CurlNetrc {
  param([Parameter(Mandatory = $true)][hashtable]$Cfg)
  $name = 'notezzz-netrc-' + [System.IO.Path]::GetRandomFileName()
  $path = Join-Path ([System.IO.Path]::GetTempPath()) $name
  # curl (>= 7.84) accepts double-quoted netrc values with backslash escapes,
  # so a password containing spaces or quotes still round-trips.
  $u = $Cfg.FTP_USER -replace '(["\\])', '\$1'
  $p = $Cfg.FTP_PASS -replace '(["\\])', '\$1'
  $content = "machine $($Cfg.FTP_HOST) login `"$u`" password `"$p`"`n"
  [System.IO.File]::WriteAllText($path, $content, $script:Utf8NoBom)
  return $path
}

# Uploads one file over explicit FTPS (control-channel TLS), up to 3 attempts.
# Returns $true on success. curl exit 56 is a TLS-teardown quirk that fires
# AFTER the file has already landed, so it counts as success.
function Send-FtpFile {
  param(
    [Parameter(Mandatory = $true)][string]$Curl,
    [Parameter(Mandatory = $true)][string]$Netrc,
    [Parameter(Mandatory = $true)][string]$FtpHost,
    [Parameter(Mandatory = $true)][string]$LocalPath,
    [Parameter(Mandatory = $true)][string]$RemotePath,
    [int]$ConnectTimeout = 25
  )
  for ($a = 0; $a -lt 3; $a++) {
    # -k (skip certificate verification) is still required. Checked on
    # 2026-09-02 with Git for Windows curl 8.7.1 (Schannel), anonymous and
    # WITHOUT -k, the host reports:
    #   curl: (60) schannel: SEC_E_UNTRUSTED_ROOT (0x80090325) - The certificate
    #   chain was issued by an authority that is not trusted.
    # The proper fix is to export the host's CA chain to a PEM file and pass
    # --cacert <pem> (pinning) instead of -k.
    & $Curl -s --ftp-ssl-control -k --connect-timeout $ConnectTimeout --ftp-create-dirs `
      --netrc-file $Netrc -T $LocalPath "ftp://${FtpHost}/${RemotePath}" | Out-Null
    if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 56) { return $true }
  }
  Write-Host "FAIL($LASTEXITCODE) $RemotePath" -ForegroundColor Red
  return $false
}
