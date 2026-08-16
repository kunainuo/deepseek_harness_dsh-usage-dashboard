# Uninstall dsh-usage-dashboard from the DeepSeek Harness (DSH) web profile.
# Removes the package directory and the composition row from cordis.patch.yml,
# including the legacy "@local/usage-dashboard" row if present.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path $PSScriptRoot -Parent
$pkg = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$pkgName = $pkg.name
if ([string]::IsNullOrWhiteSpace($pkgName)) { throw 'package.json is missing a "name" field' }

$home = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$profileRoot = Join-Path $home 'profiles'

# 1) remove the package directory
$target = Join-Path $profileRoot ("node_modules\{0}" -f $pkgName)
if (Test-Path $target) {
  Remove-Item -Recurse -Force $target
  Write-Host "Removed      : $target"
} else {
  Write-Host "Removed      : (not present) $target"
}

# 2) remove the composition rows (current name + legacy name)
$patchPath = Join-Path $profileRoot 'web\cordis.patch.yml'
if (Test-Path $patchPath) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $patchText = [System.IO.File]::ReadAllText($patchPath)
  foreach ($name in @($pkgName, '@local/usage-dashboard')) {
    $pattern = "(?ms)# [^\r\n]*\r?\n- insert:\r?\n    - id: usage-dashboard\r?\n      name: '" + [regex]::Escape($name) + "'\r?\n"
    $m = [regex]::Match($patchText, $pattern)
    if ($m.Success) {
      $patchText = $patchText.Remove($m.Index, $m.Length)
      Write-Host "Removed row  : $name"
    }
  }
  $patchText = $patchText.Trim()
  if ([string]::IsNullOrWhiteSpace($patchText)) { $patchText = '[]' }
  [System.IO.File]::WriteAllText($patchPath, $patchText + "`n", $utf8)
  Write-Host "Patch        : $patchPath updated"
}

Write-Host ""
Write-Host "Uninstalled. Restart DSH to drop the plugin from the running composition."
