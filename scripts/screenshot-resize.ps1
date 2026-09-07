# Converts store screenshots to the Chrome Web Store's required 1280x800.
# Preserves aspect ratio (no stretching), centers the capture on the
# FreshContext surface color (#0A0A0B), and never crops — the context badge
# lives in the bottom-right corner and must survive the conversion.
param(
  [int]$TargetW = 1280,
  [int]$TargetH = 800
)

Add-Type -AssemblyName System.Drawing

$promoDir = Join-Path $PSScriptRoot '..\promo'
$files = Get-ChildItem $promoDir -Filter 'Screenshot*.png' | Sort-Object Name
if ($files.Count -eq 0) { Write-Host 'No Screenshot*.png files found in promo/'; exit }

$index = 0
foreach ($file in $files) {
  $index++
  $src = [System.Drawing.Image]::FromFile($file.FullName)

  # Scale to fit inside the target, preserving aspect ratio.
  $scale = [Math]::Min($TargetW / $src.Width, $TargetH / $src.Height)
  $newW = [int][Math]::Round($src.Width * $scale)
  $newH = [int][Math]::Round($src.Height * $scale)

  $bmp = New-Object System.Drawing.Bitmap($TargetW, $TargetH)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(255, 10, 10, 11))

  $x = [int](($TargetW - $newW) / 2)
  $y = [int](($TargetH - $newH) / 2)
  $g.DrawImage($src, $x, $y, $newW, $newH)

  $outPath = Join-Path $promoDir ("screenshot-" + $index + ".png")
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

  Write-Host ($file.Name + ' (' + $src.Width + 'x' + $src.Height + ') -> ' + (Split-Path $outPath -Leaf) + ' (' + $TargetW + 'x' + $TargetH + ')')

  $g.Dispose(); $bmp.Dispose(); $src.Dispose()
}
