# Install dsh-usage-dashboard into the DeepSeek Harness (DSH) web profile.
# Idempotent: safe to re-run after a DSH upgrade. Migrates away from the
# legacy "@local/usage-dashboard" package name if it is still installed.
# Self-healing: strips stray bare `[]` flow markers from cordis.patch.yml
# (fresh-profile template, or a broken file left by older installers).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/install.ps1
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path $PSScriptRoot -Parent
$pkg = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$pkgName = $pkg.name
if ([string]::IsNullOrWhiteSpace($pkgName)) { throw 'package.json is missing a "name" field' }

$home = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$profileRoot = Join-Path $home 'profiles'
$target = Join-Path $profileRoot ("node_modules\{0}" -f $pkgName)

Write-Host "DSH home     : $home"
Write-Host "Package      : $pkgName"
Write-Host "Install to   : $target"

# 1) copy the package (package.json + lib/) into the profile node_modules
New-Item -ItemType Directory -Force -Path (Join-Path $target 'lib') | Out-Null
Copy-Item -Force (Join-Path $repoRoot 'package.json') $target
Copy-Item -Force (Join-Path $repoRoot 'lib\index.js') (Join-Path $target 'lib\index.js')
Copy-Item -Force (Join-Path $repoRoot 'lib\client.js') (Join-Path $target 'lib\client.js')

# 2) patch the profile composition (web profile cordis.patch.yml)
$patchPath = Join-Path $profileRoot 'web\cordis.patch.yml'
if (-not (Test-Path (Split-Path $patchPath -Parent))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $patchPath -Parent) | Out-Null
}
$block = @"

# dsh-usage-dashboard (installed via scripts/install.ps1)
- insert:
    - id: usage-dashboard
      name: '$pkgName'
"@
$patchText = if (Test-Path $patchPath) { [System.IO.File]::ReadAllText($patchPath) } else { '' }

# A bare `[]` flow list cannot coexist with real rows in one YAML document
# ("end of the stream or a document separator is expected"). Fresh profiles
# ship `[]`; older installers may have left it behind. Strip those lines.
$lines = @($patchText -split "`r?`n" | Where-Object { $_.Trim() -ne '[]' })
$cleanText = (($lines -join "`n")).Trim()
$utf8 = New-Object System.Text.UTF8Encoding($false)

if ($cleanText -match [regex]::Escape($pkgName)) {
  # Already installed; if stripping `[]` changed the file, persist the cleanup.
  if ($cleanText -ne $patchText.Trim()) {
    [System.IO.File]::WriteAllText($patchPath, $cleanText + "`n", $utf8)
    Write-Host "Patch        : repaired (stripped stray []) at $patchPath"
  } else {
    Write-Host "Patch        : already contains '$pkgName' (no change)"
  }
} elseif ([string]::IsNullOrWhiteSpace($cleanText)) {
  [System.IO.File]::WriteAllText($patchPath, $block.TrimStart() + "`n", $utf8)
  Write-Host "Patch        : wrote composition row to $patchPath"
} else {
  [System.IO.File]::WriteAllText($patchPath, $cleanText + "`n" + $block.TrimStart() + "`n", $utf8)
  Write-Host "Patch        : appended composition row to $patchPath"
}

# 3) migrate away from the legacy "@local/usage-dashboard" name if present
$legacyDir = Join-Path $profileRoot 'node_modules\@local\usage-dashboard'
$legacyName = '@local/usage-dashboard'
if (Test-Path $legacyDir) {
  Remove-Item -Recurse -Force $legacyDir
  Write-Host "Legacy       : removed old install $legacyDir"
}
$patchText = if (Test-Path $patchPath) { [System.IO.File]::ReadAllText($patchPath) } else { '' }
if ($patchText -match [regex]::Escape($legacyName)) {
  $legacyBlock = [regex]::Match($patchText, "(?ms)# Persistent usage dashboard[^\r\n]*\r?\n- insert:\r?\n    - id: usage-dashboard\r?\n      name: '@local/usage-dashboard'\r?\n")
  if ($legacyBlock.Success) {
    $next = $patchText.Remove($legacyBlock.Index, $legacyBlock.Length).Trim()
    if ([string]::IsNullOrWhiteSpace($next)) { $next = '[]' }
    [System.IO.File]::WriteAllText($patchPath, $next + "`n", $utf8)
    Write-Host "Legacy       : removed legacy composition row"
  }
}

Write-Host ""
Write-Host "Installed. Restart DSH to load the plugin (e.g. npx @deepseek-ai/dsh web)."
Write-Host "After the restart, use the sidebar 'Usage' button to open the dashboard."
