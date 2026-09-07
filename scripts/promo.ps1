# Generates Chrome Web Store promo tiles in the FreshContext design language:
# 440x280 (small tile) and 1400x560 (marquee). Dark instrument surfaces,
# ascending meter bars, tracked mono wordmark.
#
# GDI+ gotcha handled here: MeasureString pads every string, so tracked text
# must be measured with StringFormat.GenericTypographic or the wordmark
# centering drifts left by ~60px.
Add-Type -AssemblyName System.Drawing

$Typographic = [System.Drawing.StringFormat]::GenericTypographic

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(255, 10, 10, 11))
  return ,@($bmp, $g)
}

function Measure-TrackedText($g, [string]$text, $font, [float]$tracking) {
  $total = [float]0
  foreach ($ch in $text.ToCharArray()) {
    $size = $g.MeasureString([string]$ch, $font, [System.Drawing.PointF]::Empty, $Typographic)
    $total += $size.Width + $tracking
  }
  return $total - $tracking
}

function Draw-TrackedText($g, [string]$text, [float]$x, [float]$y, $font, $brush, [float]$tracking) {
  $pen = [float]$x
  foreach ($ch in $text.ToCharArray()) {
    $g.DrawString([string]$ch, $font, $brush, $pen, $y, $Typographic)
    $size = $g.MeasureString([string]$ch, $font, [System.Drawing.PointF]::Empty, $Typographic)
    $pen += $size.Width + $tracking
  }
}

function Draw-MeterBars($g, [float]$cx, [float]$baseline, [float]$barW, [float]$gap, [float[]]$heights) {
  $colors = @(
    [System.Drawing.Color]::FromArgb(255, 242, 242, 243),
    [System.Drawing.Color]::FromArgb(255, 242, 242, 243),
    [System.Drawing.Color]::FromArgb(255, 76, 175, 130)
  )
  $totalW = (3 * $barW) + (2 * $gap)
  $x = $cx - ($totalW / 2)
  for ($i = 0; $i -lt 3; $i++) {
    $brush = New-Object System.Drawing.SolidBrush($colors[$i])
    $g.FillRectangle($brush, $x + ($i * ($barW + $gap)), $baseline - $heights[$i], $barW, $heights[$i])
    $brush.Dispose()
  }
}

function New-Tile([int]$w, [int]$h, [string]$outPath) {
  $pair = New-Canvas $w $h
  $bmp = $pair[0]; $g = $pair[1]
  $scale = $h / 280.0

  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 242, 242, 243))
  $muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 160, 160, 168))
  $border = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 38, 38, 42), 1)
  $g.DrawRectangle($border, [float]0.5, [float]0.5, $w - 1, $h - 1)

  $wordFont = New-Object System.Drawing.Font('Consolas', [float](26 * $scale), [System.Drawing.FontStyle]::Bold)
  $tagFont = New-Object System.Drawing.Font('Segoe UI', [float](11.5 * $scale), [System.Drawing.FontStyle]::Regular)
  $word = 'FRESHCONTEXT'
  $tagline = 'Your AI chat context, carried anywhere.'
  $tracking = [float](6 * $scale)

  # Block height from real font metrics so the stack centers exactly.
  $barsH = 34 * $scale
  $gap1 = 16 * $scale
  $wordH = $wordFont.Height
  $gap2 = 8 * $scale
  $tagH = $tagFont.Height
  $blockH = $barsH + $gap1 + $wordH + $gap2 + $tagH
  $topY = ($h - $blockH) / 2

  Draw-MeterBars $g ($w / 2) ($topY + $barsH) (10 * $scale) (8 * $scale) @((12 * $scale), (22 * $scale), (34 * $scale))

  $wordW = Measure-TrackedText $g $word $wordFont $tracking
  [void](Draw-TrackedText $g $word (($w - $wordW) / 2) ($topY + $barsH + $gap1) $wordFont $white $tracking)

  $tagSize = $g.MeasureString($tagline, $tagFont, [System.Drawing.PointF]::Empty, $Typographic)
  $g.DrawString($tagline, $tagFont, $muted, (($w - $tagSize.Width) / 2), ($topY + $barsH + $gap1 + $wordH + $gap2))

  $g.Dispose()
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host $outPath
}

New-Item -ItemType Directory -Force -Path promo | Out-Null
New-Tile 440 280 "promo/promo-440x280.png"
New-Tile 1400 560 "promo/promo-1400x560.png"
