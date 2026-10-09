$ErrorActionPreference = 'Stop'
$revisionRepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../../..'))
Push-Location -LiteralPath $revisionRepoRoot
try {
  $revisionBaseline = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'git rev-parse failed' }
  $revisionProductPaths = @('src','tests','runtime','scripts','examples','package.json','package-lock.json','.gitignore','README.md')
  $revisionTracked = @(git diff --name-only HEAD -- @revisionProductPaths)
  if ($LASTEXITCODE -ne 0) { throw 'git diff failed' }
  $revisionUntracked = @(git ls-files --others --exclude-standard -- @revisionProductPaths)
  if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed' }
  if ($revisionBaseline -ne '4fe090c0e2acfe2b137854db7a55de86afcc9036' -or $revisionTracked.Count -or $revisionUntracked.Count) {
    throw 'Planning-only verifier: baseline changed; preserve old evidence.'
  }
  $revisionCodeCheck = [ordered]@{
    kind = 'planning-revision-code-scope-check'
    checkedAt = [DateTime]::UtcNow.ToString('o')
    sourceBaseline = $revisionBaseline
    paths = $revisionProductPaths
    trackedProductChanges = $revisionTracked
    untrackedProductChanges = $revisionUntracked
    note = 'Read-only Git check in PowerShell; Node child-process Git spawning returned EPERM in this environment.'
  }
  $revisionCodeCheck | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'revision-code-check.json') -Encoding utf8
  node (Join-Path $PSScriptRoot 'verify-revision.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Document verification failed; see revision-document-links.json' }
}
finally {
  Pop-Location
}
