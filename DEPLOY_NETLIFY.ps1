Set-StrictMode -Version Latest
$ErrorActionPreference="Stop"

cd $PSScriptRoot

git checkout main
git pull origin main

npm ci
npm run build

netlify link --id e35b36f5-9bd8-446a-ad1d-48f11aa14f0f
$sha = (git rev-parse --short HEAD)
netlify deploy --prod --dir=dist --message "deploy $sha main"
