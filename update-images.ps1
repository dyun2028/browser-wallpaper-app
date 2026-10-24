# Rebuilds img/images.js from the pictures in the img folder.
$dir = Join-Path $PSScriptRoot 'img'
if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$names = @(Get-ChildItem -LiteralPath $dir -File |
  Where-Object { $_.Extension -match '^\.(jpe?g|png|gif|webp|avif|bmp|svg)$' } |
  Sort-Object Name |
  ForEach-Object { '  ' + (ConvertTo-Json $_.Name) })
$js = "// Made by update-images.bat. Run it again after adding or removing pictures.`r`n" +
      "window.WALLPAPERS = [`r`n" + ($names -join ",`r`n") + "`r`n];`r`n"
[IO.File]::WriteAllText((Join-Path $dir 'images.js'), $js)
Write-Host "Found $($names.Count) picture(s) in img. Refresh the app page to see them."
