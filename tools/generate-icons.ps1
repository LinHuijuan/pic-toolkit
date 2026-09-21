# Generate PWA icons (512 / 192) for Option-C brand logo (negative-space toolbox)
# Usage: powershell -File tools/generate-icons.ps1
Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath($rect, $radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($radius -le 0) { $path.AddRectangle($rect); return $path }
    $d = 2 * $radius
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

# Star glyph: pre-converted cubic beziers (from 4 quadratic segments, 512-space)
function New-StarPath($s) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    function F($v) { [float]($v * $s) }
    $path.StartFigure()
    # A: (352,258) -> (418,324)
    $path.AddBezier((F 352), (F 258), (F 359.333), (F 294.667), (F 381.333), (F 316.667), (F 418), (F 324)) | Out-Null
    # B: (418,324) -> (352,390)
    $path.AddBezier((F 418), (F 324), (F 381.333), (F 331.333), (F 359.333), (F 353.333), (F 352), (F 390)) | Out-Null
    # C: (352,390) -> (286,324)
    $path.AddBezier((F 352), (F 390), (F 344.667), (F 353.333), (F 322.667), (F 331.333), (F 286), (F 324)) | Out-Null
    # D: (286,324) -> (352,258)
    $path.AddBezier((F 286), (F 324), (F 322.667), (F 316.667), (F 344.667), (F 294.667), (F 352), (F 258)) | Out-Null
    $path.CloseFigure()
    return $path
}

function New-Icon($size, $outPath) {
    $s = $size / 512
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $full = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $radius = $size * 0.2265
    $bgPath = New-RoundedRectPath $full ([int]$radius)

    # Brand gradient: #5B21B6 -> #4338CA (55%) -> #0E7490, along (40,480)->(472,32) of 512 space (≈ -46 deg)
    $c1 = [System.Drawing.Color]::FromArgb(91, 33, 182)
    $c2 = [System.Drawing.Color]::FromArgb(67, 56, 202)
    $c3 = [System.Drawing.Color]::FromArgb(14, 116, 144)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($full, $c1, $c3, -46.0)
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend(3)
    $blend.Colors = @($c1, $c2, $c3)
    $blend.Positions = @(0.0, 0.55, 1.0)
    $bgBrush.InterpolationColors = $blend
    $g.FillPath($bgBrush, $bgPath)

    # Latch bar (512-space rect 244,272,24,28 r8) – drawn first, then covered by band if needed
    $latchRect = New-Object System.Drawing.RectangleF((244 * $s), (272 * $s), (24 * $s), (28 * $s))
    $latchPath = New-RoundedRectPath $latchRect ([int](8 * $s))

    # Tilted lid + handle (rotate -8deg around 256,210)
    $state = $g.Save()
    $g.TranslateTransform(256 * $s, 210 * $s)
    $g.RotateTransform(-8)
    $g.TranslateTransform(-256 * $s, -210 * $s)
    $handlePen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, (16 * $s))
    $handlePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $handlePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $handle = New-Object System.Drawing.Drawing2D.GraphicsPath
    $handle.AddBezier((212 * $s), (186 * $s), (212 * $s), (146 * $s), (300 * $s), (146 * $s), (300 * $s), (186 * $s))
    $g.DrawPath($handlePen, $handle)
    $lidRect = New-Object System.Drawing.RectangleF((112 * $s), (186 * $s), (288 * $s), (40 * $s))
    $lidPath = New-RoundedRectPath $lidRect ([int](20 * $s))
    $g.FillPath([System.Drawing.Brushes]::White, $lidPath)
    $g.Restore($state)

    # White box body
    $bodyRect = New-Object System.Drawing.RectangleF((112 * $s), (250 * $s), (288 * $s), (150 * $s))
    $bodyPath = New-RoundedRectPath $bodyRect ([int](30 * $s))
    $g.FillPath([System.Drawing.Brushes]::White, $bodyPath)

    # Body details (all bg-gradient knockouts): band + latch + star + dot
    $bandRect = New-Object System.Drawing.RectangleF((112 * $s), (286 * $s), (288 * $s), (16 * $s))
    $bandPath = New-RoundedRectPath $bandRect 0
    $starPath = New-StarPath $s
    $dotRect = New-Object System.Drawing.RectangleF(((166 - 10) * $s), ((356 - 10) * $s), (20 * $s), (20 * $s))
    $dotPath = New-RoundedRectPath $dotRect ([int](10 * $s))

    $stateBody = $g.Save()
    $g.SetClip($bodyPath, [System.Drawing.Drawing2D.CombineMode]::Replace)
    $g.FillPath($bgBrush, $bandPath)
    $g.FillPath($bgBrush, $starPath)
    $g.FillPath($bgBrush, $dotPath)
    $g.FillPath($bgBrush, $latchPath)
    $g.Restore($stateBody)

    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Generated: $outPath"
}

$dir = Join-Path $PSScriptRoot "..\public\icons"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
New-Icon 512 (Join-Path $dir "icon-512.png")
New-Icon 192 (Join-Path $dir "icon-192.png")
