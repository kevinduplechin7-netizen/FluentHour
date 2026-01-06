Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (Test-Path -LiteralPath "package-lock.json") {
  npm ci
} else {
  npm install
}

npm run dev
