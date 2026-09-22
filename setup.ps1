$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
uv venv --python 3.11 .venv
if ($LASTEXITCODE -ne 0) { throw 'Python setup failed' }
uv pip install --python .venv/Scripts/python.exe -r requirements-desktop.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies failed' }
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Electron dependencies failed' }
Write-Host 'Setup complete. Start LM Studio server, then run npm start.'
