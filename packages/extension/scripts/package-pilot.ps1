$ErrorActionPreference = "Stop"

$extensionRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $extensionRoot "package.json"
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$version = [string]$packageJson.version

if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "Invalid extension version: $version"
}

$distDirectory = Join-Path $extensionRoot "dist"
$vsixPath = Join-Path $distDirectory "vibin-guard.vsix"
$guidePath = Join-Path $extensionRoot "TESTING-GUIDE.md"
$archivePath = Join-Path $distDirectory "vibinguard-$version-pilot.zip"

foreach ($requiredPath in @($vsixPath, $guidePath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required pilot file was not found: $requiredPath"
  }
}

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open(
  $archivePath,
  [System.IO.Compression.ZipArchiveMode]::Create
)

try {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $archive,
    $vsixPath,
    "vibin-guard.vsix",
    [System.IO.Compression.CompressionLevel]::Optimal
  ) | Out-Null
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $archive,
    $guidePath,
    "TESTING-GUIDE.md",
    [System.IO.Compression.CompressionLevel]::Optimal
  ) | Out-Null

  $hash = (Get-FileHash -LiteralPath $vsixPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $checksumEntry = $archive.CreateEntry("SHA256.txt")
  $writer = [System.IO.StreamWriter]::new($checksumEntry.Open())
  try {
    $writer.WriteLine("$hash  vibin-guard.vsix")
  } finally {
    $writer.Dispose()
  }
} finally {
  $archive.Dispose()
}

Write-Host "Pilot bundle created: $archivePath"
