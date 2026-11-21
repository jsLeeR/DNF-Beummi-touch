param(
    [Parameter(Mandatory=$true)][string]$SourceExe,
    [string]$GameDirectory = (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) '아라도숙녀들')
)
$ErrorActionPreference = 'Stop'
$source = Get-Item -LiteralPath $SourceExe
$game = Join-Path $GameDirectory '아라도 숙녀들.exe'
$history = Join-Path $GameDirectory '버전관리'
[void][IO.Directory]::CreateDirectory($history)
$id = [guid]::NewGuid().ToString('N')
$pending = Join-Path $GameDirectory ('.' + $id + '.tmp')
try {
    [IO.File]::Copy($source.FullName, $pending, $false)
    if ([IO.File]::Exists($game)) {
        if ((Get-FileHash -LiteralPath $game).Hash -eq (Get-FileHash -LiteralPath $pending).Hash) {
            Get-Item -LiteralPath $game
            return
        }
        $stamp = (Get-Date).ToString('yyyy-MM-dd_HHmmss')
        $backup = Join-Path $history ("아라도 숙녀들_{0}_{1}.exe" -f $stamp,$id.Substring(0,8))
        [IO.File]::Replace($pending, $game, $backup)
    } else {
        [IO.File]::Move($pending, $game)
    }
    Get-Item -LiteralPath $game
} finally {
    if ([IO.File]::Exists($pending)) { [IO.File]::Delete($pending) }
}
