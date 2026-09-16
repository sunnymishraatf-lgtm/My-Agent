$ErrorActionPreference = "Stop"

$Package = if ($env:SUNNY_PACKAGE) { $env:SUNNY_PACKAGE } else { "sunny-agent" }
$MinNode = 20

function Fail([string]$Message) {
  Write-Error $Message
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js $MinNode+ is required (https://nodejs.org)"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "npm is required (it ships with Node.js)"
}

$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt $MinNode) {
  Fail "Node.js $MinNode+ required (found $(node -v))"
}

$installed = $false
try {
  npm install -g $Package
  if ($LASTEXITCODE -eq 0) { $installed = $true }
} catch {
  $installed = $false
}

if (-not $installed -and (Test-Path "package.json") -and (Test-Path "src")) {
  Write-Host "Global install failed; building from the current source tree instead..."
  npm install
  npm run build
  npm link
  $installed = $true
}

if (-not $installed) {
  Fail "Could not install $Package from npm. If it is not published yet, clone the repo and run this script from its root."
}

Write-Host ""
Write-Host "Installed. Try:"
Write-Host "  sunny --version"
Write-Host "  sunny config"
Write-Host "  sunny chat"
