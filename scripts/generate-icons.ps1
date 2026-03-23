Add-Type -AssemblyName System.Drawing

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-RoundedRectPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Point([double]$x, [double]$y) {
  return [System.Drawing.PointF]::new([float]$x, [float]$y)
}

function Draw-FocusIcon([int]$size, [string]$path) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $canvas = [float]$size
    $outerPath = New-RoundedRectPath 0.5 0.5 ($canvas - 1) ($canvas - 1) ($canvas * 0.22)

    try {
      $bgRect = [System.Drawing.RectangleF]::new(0, 0, $canvas, $canvas)
      $bgBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $bgRect,
        [System.Drawing.Color]::FromArgb(255, 20, 26, 36),
        [System.Drawing.Color]::FromArgb(255, 36, 46, 63),
        55
      )

      try {
        $graphics.FillPath($bgBrush, $outerPath)
      } finally {
        $bgBrush.Dispose()
      }

      # Clip every inner layer to the rounded square so highlights never spill into sharp corners.
      $graphics.SetClip($outerPath)

      $cornerAccentPath = New-RoundedRectPath (-0.04 * $canvas) (-0.04 * $canvas) (0.66 * $canvas) (0.58 * $canvas) ($canvas * 0.22)
      try {
        $glowBrushA = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
          [System.Drawing.RectangleF]::new(0, 0, 0.64 * $canvas, 0.54 * $canvas),
          [System.Drawing.Color]::FromArgb(150, 255, 120, 112),
          [System.Drawing.Color]::FromArgb(70, 255, 92, 87),
          35
        )
        try {
          $graphics.FillPath($glowBrushA, $cornerAccentPath)
        } finally {
          $glowBrushA.Dispose()
        }
      } finally {
        $cornerAccentPath.Dispose()
      }

      $glowBrushB = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(70, 255, 209, 102))
      try {
        $graphics.FillEllipse($glowBrushB, 0.44 * $canvas, 0.50 * $canvas, 0.52 * $canvas, 0.52 * $canvas)
      } finally {
        $glowBrushB.Dispose()
      }

      $overlayBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $bgRect,
        [System.Drawing.Color]::FromArgb(28, 255, 255, 255),
        [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
        90
      )
      try {
        $graphics.FillPath($overlayBrush, $outerPath)
      } finally {
        $overlayBrush.Dispose()
      }

      $pageBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 248, 244, 236))
      $leftPage = [System.Drawing.PointF[]]@(
        (New-Point (0.24 * $canvas) (0.30 * $canvas)),
        (New-Point (0.46 * $canvas) (0.23 * $canvas)),
        (New-Point (0.46 * $canvas) (0.75 * $canvas)),
        (New-Point (0.24 * $canvas) (0.82 * $canvas))
      )
      $rightPage = [System.Drawing.PointF[]]@(
        (New-Point (0.54 * $canvas) (0.23 * $canvas)),
        (New-Point (0.76 * $canvas) (0.30 * $canvas)),
        (New-Point (0.76 * $canvas) (0.82 * $canvas)),
        (New-Point (0.54 * $canvas) (0.75 * $canvas))
      )

      try {
        $graphics.FillPolygon($pageBrush, $leftPage)
        $graphics.FillPolygon($pageBrush, $rightPage)
      } finally {
        $pageBrush.Dispose()
      }

      $pageEdgePen = [System.Drawing.Pen]::new(
        [System.Drawing.Color]::FromArgb(55, 15, 23, 34),
        [float][Math]::Max(1, $canvas * 0.018)
      )
      try {
        $graphics.DrawPolygon($pageEdgePen, $leftPage)
        $graphics.DrawPolygon($pageEdgePen, $rightPage)
      } finally {
        $pageEdgePen.Dispose()
      }

      $seamPen = [System.Drawing.Pen]::new(
        [System.Drawing.Color]::FromArgb(255, 255, 141, 112),
        [float][Math]::Max(1.2, $canvas * 0.032)
      )
      try {
        $seamPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $seamPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $graphics.DrawLine($seamPen, 0.50 * $canvas, 0.30 * $canvas, 0.50 * $canvas, 0.73 * $canvas)
      } finally {
        $seamPen.Dispose()
      }

      $bookmarkBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 92, 87))
      $bookmarkPoints = [System.Drawing.PointF[]]@(
        (New-Point (0.435 * $canvas) (0.10 * $canvas)),
        (New-Point (0.565 * $canvas) (0.10 * $canvas)),
        (New-Point (0.565 * $canvas) (0.30 * $canvas)),
        (New-Point (0.50 * $canvas) (0.245 * $canvas)),
        (New-Point (0.435 * $canvas) (0.30 * $canvas))
      )
      try {
        $graphics.FillPolygon($bookmarkBrush, $bookmarkPoints)
      } finally {
        $bookmarkBrush.Dispose()
      }

      if ($size -ge 32) {
        $badgeBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 209, 102))
        $badgePen = [System.Drawing.Pen]::new(
          [System.Drawing.Color]::FromArgb(130, 20, 26, 36),
          [float][Math]::Max(1, $canvas * 0.02)
        )
        $focusPen = [System.Drawing.Pen]::new(
          [System.Drawing.Color]::FromArgb(255, 20, 26, 36),
          [float][Math]::Max(1.1, $canvas * 0.03)
        )

        try {
          $graphics.FillEllipse($badgeBrush, 0.12 * $canvas, 0.65 * $canvas, 0.18 * $canvas, 0.18 * $canvas)
          $graphics.DrawEllipse($badgePen, 0.12 * $canvas, 0.65 * $canvas, 0.18 * $canvas, 0.18 * $canvas)
          $focusPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
          $focusPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
          $graphics.DrawLine($focusPen, 0.165 * $canvas, 0.74 * $canvas, 0.255 * $canvas, 0.74 * $canvas)
          $graphics.DrawLine($focusPen, 0.21 * $canvas, 0.695 * $canvas, 0.21 * $canvas, 0.785 * $canvas)
        } finally {
          $focusPen.Dispose()
          $badgePen.Dispose()
          $badgeBrush.Dispose()
        }
      }

      $graphics.ResetClip()

      $borderPen = [System.Drawing.Pen]::new(
        [System.Drawing.Color]::FromArgb(42, 255, 255, 255),
        [float][Math]::Max(1, $canvas * 0.014)
      )
      try {
        $graphics.DrawPath($borderPen, $outerPath)
      } finally {
        $borderPen.Dispose()
      }
    } finally {
      $outerPath.Dispose()
    }

    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Draw-Preview([string]$outputPath) {
  $width = 860
  $height = 360
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $bgBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      [System.Drawing.Rectangle]::new(0, 0, $width, $height),
      [System.Drawing.Color]::FromArgb(255, 247, 242, 235),
      [System.Drawing.Color]::FromArgb(255, 231, 235, 243),
      25
    )
    try {
      $graphics.FillRectangle($bgBrush, 0, 0, $width, $height)
    } finally {
      $bgBrush.Dispose()
    }

    $panelDark = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 32, 38, 49))
    $panelLight = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(245, 255, 255, 255))
    $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(28, 10, 18, 30))
    $textDark = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 33, 39, 48))
    $textLight = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 247, 248, 250))
    $textMuted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 101, 112, 128))
    $titleFont = [System.Drawing.Font]::new("Microsoft YaHei UI", 22, [System.Drawing.FontStyle]::Bold)
    $labelFont = [System.Drawing.Font]::new("Microsoft YaHei UI", 12, [System.Drawing.FontStyle]::Regular)
    $sizeFont = [System.Drawing.Font]::new("Consolas", 11, [System.Drawing.FontStyle]::Bold)

    try {
      foreach ($panel in @(
        @{ Brush = $shadowBrush; X = 46; Y = 74; Width = 328; Height = 224; Radius = 24 },
        @{ Brush = $panelDark; X = 40; Y = 68; Width = 328; Height = 224; Radius = 24 },
        @{ Brush = $shadowBrush; X = 486; Y = 74; Width = 328; Height = 224; Radius = 24 },
        @{ Brush = $panelLight; X = 480; Y = 68; Width = 328; Height = 224; Radius = 24 }
      )) {
        $panelPath = New-RoundedRectPath $panel.X $panel.Y $panel.Width $panel.Height $panel.Radius
        try {
          $graphics.FillPath($panel.Brush, $panelPath)
        } finally {
          $panelPath.Dispose()
        }
      }

      $graphics.DrawString("Study Focus Guard Icon Draft", $titleFont, $textDark, 40, 24)
      $graphics.DrawString("Rounded top-left corner applied to the icon layers.", $labelFont, $textMuted, 40, 330)
      $graphics.DrawString("Dark Surface", $labelFont, $textLight, 56, 84)
      $graphics.DrawString("Light Surface", $labelFont, $textDark, 496, 84)

      $specs = @(
        @{ Size = 128; X1 = 72; Y1 = 118; X2 = 512; Y2 = 118 },
        @{ Size = 48; X1 = 230; Y1 = 138; X2 = 670; Y2 = 138 },
        @{ Size = 32; X1 = 242; Y1 = 222; X2 = 682; Y2 = 222 },
        @{ Size = 16; X1 = 250; Y1 = 272; X2 = 690; Y2 = 272 }
      )

      foreach ($spec in $specs) {
        $img = [System.Drawing.Image]::FromFile((Join-Path (Get-Location) ("assets/icons/icon{0}.png" -f $spec.Size)))
        try {
          $graphics.DrawImage($img, [float]$spec.X1, [float]$spec.Y1, [float]$spec.Size, [float]$spec.Size)
          $graphics.DrawImage($img, [float]$spec.X2, [float]$spec.Y2, [float]$spec.Size, [float]$spec.Size)
        } finally {
          $img.Dispose()
        }

        $graphics.DrawString(("{0} px" -f $spec.Size), $sizeFont, $textLight, [float]($spec.X1 + $spec.Size + 18), [float]($spec.Y1 + ($spec.Size / 2) - 8))
        $graphics.DrawString(("{0} px" -f $spec.Size), $sizeFont, $textDark, [float]($spec.X2 + $spec.Size + 18), [float]($spec.Y2 + ($spec.Size / 2) - 8))
      }
    } finally {
      $sizeFont.Dispose()
      $labelFont.Dispose()
      $titleFont.Dispose()
      $textMuted.Dispose()
      $textLight.Dispose()
      $textDark.Dispose()
      $shadowBrush.Dispose()
      $panelLight.Dispose()
      $panelDark.Dispose()
    }

    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$iconDir = Join-Path (Get-Location) "assets/icons"
New-Item -ItemType Directory -Force $iconDir | Out-Null

foreach ($size in 16, 32, 48, 128) {
  Draw-FocusIcon -size $size -path (Join-Path $iconDir ("icon{0}.png" -f $size))
}

Draw-Preview -outputPath (Join-Path $iconDir "icon-preview.png")

