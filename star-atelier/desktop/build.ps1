param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
$projectDir = (Get-Item -LiteralPath $PSScriptRoot).Parent.FullName
if ($OutputPath) {
    $target = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
    if (Test-Path -LiteralPath $target) { throw "Output already exists: $target" }
}
$stageDir = Join-Path ([IO.Path]::GetTempPath()) ('StarAtelierBuild-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($stageDir) | Out-Null
$archive = Join-Path $stageDir 'game.zip'
$exe = Join-Path $stageDir 'StarAtelier.exe'
try {
    Add-Type -AssemblyName System.Drawing
    $masks = [ordered]@{}
    foreach ($modelDir in (Get-ChildItem -Directory -LiteralPath (Join-Path $projectDir 'art'))) {
        $poses = [ordered]@{}
        $bodies = Get-ChildItem -LiteralPath $modelDir.FullName -File -Filter '*.png' |
            Where-Object { $_.BaseName -notlike 'face-*' }
        foreach ($body in $bodies) {
            $poseName = $body.BaseName
            $image = [Drawing.Bitmap]::FromFile($body.FullName)
            try {
                $pixels = $image.Width * $image.Height
                $bits = [byte[]]::new([int][Math]::Ceiling($pixels / 8.0))
                for ($y=0; $y -lt $image.Height; $y++) {
                    for ($x=0; $x -lt $image.Width; $x++) {
                        if ($image.GetPixel($x,$y).A -lt 96) { continue }
                        $index = $y * $image.Width + $x
                        $byte = $index -shr 3
                        $bits[$byte] = $bits[$byte] -bor (1 -shl ($index -band 7))
                    }
                }
                $poses[$poseName] = [Convert]::ToBase64String($bits)
            } finally { $image.Dispose() }
        }
        $masks[$modelDir.Name]=$poses
    }
    $maskScript='const SILHOUETTES = ' + (ConvertTo-Json $masks -Depth 4 -Compress) + ';'
    [IO.File]::WriteAllText((Join-Path $projectDir 'silhouettes.js'),$maskScript,[Text.UTF8Encoding]::new($false))
    $inputs = @('index.html','game.css','models.js','silhouettes.js','game.js','art') |
        ForEach-Object { Join-Path $projectDir $_ }
    Compress-Archive -LiteralPath $inputs -DestinationPath $archive -CompressionLevel Optimal
    $compiler = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'
    if (!(Test-Path -LiteralPath $compiler)) {
        $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    }
    & $compiler /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 `
        /reference:System.Windows.Forms.dll /reference:System.IO.Compression.dll `
        "/resource:$archive,StarAtelier.Game" "/win32icon:$PSScriptRoot/star.ico" "/out:$exe" `
        (Join-Path $PSScriptRoot 'Launcher.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Windows compilation failed.' }
    if ($OutputPath) {
        [IO.File]::Copy($exe, $target, $false)
        Get-Item -LiteralPath $target | Select-Object FullName,Length
    } else {
        & (Join-Path $PSScriptRoot 'install-game.ps1') -SourceExe $exe
    }
} finally {
    foreach ($file in @($archive,$exe)) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
    }
    Remove-Item -LiteralPath $stageDir
}
