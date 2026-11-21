param(
    [switch]$UseInstalled,
    [string]$GitHubCli = 'gh'
)
$ErrorActionPreference = 'Stop'
$project = (Get-Item -LiteralPath $PSScriptRoot).Parent.Parent.FullName
$gameDirectory = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) '아라도숙녀들'
$game = Join-Path $gameDirectory '아라도 숙녀들.exe'
if ($GitHubCli -eq 'gh' -and !(Get-Command gh -ErrorAction SilentlyContinue)) {
    $GitHubCli = Join-Path $env:LOCALAPPDATA 'AradoPublisher/bin/gh.exe'
}

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "실패: $Program $($Arguments[0])" }
}

Push-Location -LiteralPath $project
$stage = Join-Path ([IO.Path]::GetTempPath()) ('AradoPublish-' + [guid]::NewGuid().ToString('N'))
$asset = Join-Path $stage 'AradoLadies.exe'
$notes = Join-Path $stage 'notes.txt'
try {
    $branch = Invoke-Checked git @('branch','--show-current')
    if ($branch -ne 'main') { throw '배포할 main 브랜치에서 실행하세요.' }
    $repo = Invoke-Checked $GitHubCli @('repo','view','--json','nameWithOwner','--jq','.nameWithOwner')
    $lockPath = Invoke-Checked git @('rev-parse','--git-path','arado-publish.lock')
    $lock = [IO.File]::Open($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($lockPath), 'OpenOrCreate', 'ReadWrite', 'None')
    if (!$UseInstalled) { & (Join-Path $PSScriptRoot 'build.ps1') | Out-Null }
    [void][IO.Directory]::CreateDirectory($stage)
    [IO.File]::Copy($game, $asset)
    $digest = (Get-FileHash -LiteralPath $asset).Hash.ToLowerInvariant()

    $paths = @('star-atelier/index.html','star-atelier/game.css','star-atelier/game.js','star-atelier/models.js',
        'star-atelier/silhouettes.js','star-atelier/art','star-atelier/desktop/Launcher.cs','star-atelier/desktop/star.ico',
        'star-atelier/desktop/build.ps1','star-atelier/desktop/install-game.ps1','star-atelier/desktop/publish.ps1')
    Invoke-Checked git (@('add','-A','--') + $paths)
    & git diff --cached --quiet -- @paths
    if ($LASTEXITCODE -eq 1) {
        Invoke-Checked git (@('-c','user.name=Arado Ladies','-c','user.email=release@arado-ladies.invalid',
            'commit','--only','-m','Update game source','--') + $paths)
    } elseif ($LASTEXITCODE -ne 0) { throw '소스 변경 내역을 확인할 수 없습니다.' }
    Invoke-Checked git @('push','origin','HEAD:refs/heads/main')
    $commit = Invoke-Checked git @('rev-parse','HEAD')
    $tag = 'game-' + $commit.Substring(0,12) + '-' + $digest.Substring(0,12)
    $previous = @(Invoke-Checked $GitHubCli @('release','list','--repo',$repo,'--limit','1000','--json','tagName,isDraft') |
        Out-String | ConvertFrom-Json | ForEach-Object { $_ })
    $existing = $previous | Where-Object tagName -eq $tag
    if (!$existing) {
        [IO.File]::WriteAllText($notes,'Windows에서 AradoLadies.exe를 다운로드해 실행하세요.',[Text.UTF8Encoding]::new($false))
        Invoke-Checked $GitHubCli @('release','create',$tag,'--repo',$repo,'--target',$commit,'--draft','--title','아라도 숙녀들','--notes-file',$notes)
    }
    if (!$existing -or $existing.isDraft) {
        Invoke-Checked $GitHubCli @('release','upload',$tag,$asset,'--repo',$repo,'--clobber')
    }
    $releaseId = Invoke-Checked $GitHubCli @('release','view',$tag,'--repo',$repo,'--json','databaseId','--jq','.databaseId')
    $uploaded = @(Invoke-Checked $GitHubCli @('api',"repos/$repo/releases/$releaseId/assets") |
        Out-String | ConvertFrom-Json | ForEach-Object { $_ })
    if ($uploaded.Count -ne 1 -or $uploaded[0].name -ne 'AradoLadies.exe' -or $uploaded[0].digest -ne "sha256:$digest") {
        throw '공개할 실행 파일이 로컬 빌드와 일치하지 않습니다.'
    }
    if (!$existing -or $existing.isDraft) {
        Invoke-Checked $GitHubCli @('release','edit',$tag,'--repo',$repo,'--draft=false','--latest')
    }
    $latest = Invoke-Checked $GitHubCli @('api',"repos/$repo/releases/latest",'--jq','.tag_name')
    if ($latest -ne $tag) { throw '최신 배포가 변경되어 이전 릴리스를 유지했습니다.' }
    foreach ($release in $previous) {
        if ($release.tagName -ne $tag -and !$release.isDraft -and $release.tagName -match '^game-([a-f0-9]{16}|[a-f0-9]{12}-[a-f0-9]{12})$') {
            Invoke-Checked $GitHubCli @('release','delete',$release.tagName,'--repo',$repo,'--cleanup-tag','--yes')
        }
    }
    Write-Output "https://github.com/$repo/releases/latest/download/AradoLadies.exe"
} finally {
    if ($lock) { $lock.Dispose() }
    foreach ($file in @($asset,$notes)) { if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) } }
    if ([IO.Directory]::Exists($stage)) { [IO.Directory]::Delete($stage) }
    Pop-Location
}
