# Generate PWA icons (512 / 192) with System.Drawing
# Usage: powershell -File tools/generate-icons.ps1
Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath($rect, $radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $radius
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-Icon($size, $outPath) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $full = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $radius = [int]($size * 0.18)
    $bgPath = New-RoundedRectPath $full $radius
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $full,
        [System.Drawing.Color]::FromArgb(91, 124, 250),
        [System.Drawing.Color]::FromArgb(61, 90, 241),
        45.0
    )
    $g.FillPath($bgBrush, $bgPath)

    # white photo frame
    $imgW = $size * 0.625
    $imgH = $imgW * 0.9
    $imgX = ($size - $imgW) / 2
    $imgY = $size * 0.22
    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(243, 255, 255, 255))
    $g.FillRectangle($whiteBrush, $imgX, $imgY, $imgW, $imgH)

    # mountain shape inside frame
    $mountainBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 91, 124, 250))
    $m1 = New-Object System.Drawing.PointF(($imgX + $imgW * 0.08), ($imgY + $imgH * 0.88))
    $m2 = New-Object System.Drawing.PointF(($imgX + $imgW * 0.38), ($imgY + $imgH * 0.40))
    $m3 = New-Object System.Drawing.PointF(($imgX + $imgW * 0.60), ($imgY + $imgH * 0.70))
    $m4 = New-Object System.Drawing.PointF(($imgX + $imgW * 0.85), ($imgY + $imgH * 0.88))
    $pts = [System.Drawing.PointF[]]@($m1, $m2, $m3, $m4)
    $g.FillPolygon($mountainBrush, $pts)

    # sun circle
    $sunBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(160, 61, 90, 241))
    $sunR = $size * 0.06
    $g.FillEllipse($sunBrush, ($imgX + $imgW * 0.62 - $sunR), ($imgY + $imgH * 0.18 - $sunR), 2 * $sunR, 2 * $sunR)

    # grid lines (slice hint)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(190, 61, 90, 241), ($size * 0.022))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($pen, $imgX, ($imgY + $imgH / 2), ($imgX + $imgW), ($imgY + $imgH / 2))
    $g.DrawLine($pen, ($imgX + $imgW / 2), $imgY, ($imgX + $imgW / 2), ($imgY + $imgH))

    # scissors (two circles + two blades)
    $scPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, ($size * 0.032))
    $scPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $scPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $scX = $imgX + $imgW * 0.62
    $scY = $imgY - $size * 0.09
    $scR = $size * 0.045
    $g.DrawEllipse($scPen, ($scX - $scR), ($scY - $scR), 2 * $scR, 2 * $scR)
    $g.DrawEllipse($scPen, ($scX - $scR), ($scY + 2.2 * $scR), 2 * $scR, 2 * $scR)
    $g.DrawLine($scPen, ($scX + 0.4 * $scR), ($scY - 0.4 * $scR), ($scX + 2.6 * $scR), ($scY + 4.6 * $scR))
    $g.DrawLine($scPen, ($scX + 0.4 * $scR), ($scY + 2.6 * $scR), ($scX + 2.6 * $scR), ($scY - 1.4 * $scR))

    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Generated: $outPath"
}

$dir = Join-Path $PSScriptRoot "..\public\icons"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
New-Icon 512 (Join-Path $dir "icon-512.png")
New-Icon 192 (Join-Path $dir "icon-192.png")
