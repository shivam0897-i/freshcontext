# Generates Fresh Start icons (16/32/48/128 px) with Windows GDI+.
# Design: near-black rounded square, three ascending meter bars (white, white, green).
Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force -Path icons | Out-Null

foreach ($s in @(16, 32, 48, 128)) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 19, 19, 20))
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 242, 242, 243))
  $green = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 76, 175, 130))

  $pad = [int][Math]::Max(1, [Math]::Round($s * 0.05))
  $r = [int][Math]::Round($s * 0.24)
  $box = [int]($s - (2 * $pad))
  $rect = New-Object System.Drawing.Rectangle($pad, $pad, $box, $box)

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [int](2 * $r)
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc(($rect.Right - $d), $rect.Y, $d, $d, 270, 90)
  $path.AddArc(($rect.Right - $d), ($rect.Bottom - $d), $d, $d, 0, 90)
  $path.AddArc($rect.X, ($rect.Bottom - $d), $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath($bg, $path)

  $bw = [int][Math]::Round($box * 0.16)
  $gap = [int][Math]::Round(($box - (3 * $bw)) / 4)
  $h1 = [int][Math]::Round($box * 0.20)
  $h2 = [int][Math]::Round($box * 0.34)
  $h3 = [int][Math]::Round($box * 0.48)
  $heights = @($h1, $h2, $h3)
  $baseY = [int]($rect.Bottom - [Math]::Round($box * 0.18))
  $brushes = @($white, $white, $green)

  for ($i = 0; $i -lt 3; $i++) {
    $x = [int]($rect.X + $gap + ($i * ($bw + $gap)))
    $h = $heights[$i]
    $bar = New-Object System.Drawing.Rectangle($x, ($baseY - $h), $bw, $h)
    $g.FillRectangle($brushes[$i], $bar)
  }

  $g.Dispose()
  $bmp.Save("icons/icon$s.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "icons/icon$s.png"
}
