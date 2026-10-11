$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Pinned llama.cpp build (CUDA 13.x includes Blackwell kernels). Update tag and hashes together.
$LlamaTag = 'b11557'
$LlamaAssets = @(
  @{ Name = "llama-$LlamaTag-bin-win-cuda-13.4-x64.zip"; Sha256 = '9a0d41f868d34b1c39a9dc4f0b2250d1ef32fb2aed978c54f4380b06a21b8d9f' },
  @{ Name = 'cudart-llama-bin-win-cuda-13.4-x64.zip'; Sha256 = '738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668' }
)

function Install-Llama {
  $target = Join-Path $PSScriptRoot 'bin\llama'
  $marker = Join-Path $target 'VERSION'
  if ((Test-Path $marker) -and (Get-Content $marker -Raw).Trim() -eq $LlamaTag) {
    Write-Host "llama.cpp $LlamaTag already installed."
    return
  }
  $staging = Join-Path ([IO.Path]::GetTempPath()) "local-rag-llama-$LlamaTag"
  if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
  New-Item -ItemType Directory -Force $staging | Out-Null
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  New-Item -ItemType Directory -Force $target | Out-Null
  foreach ($asset in $LlamaAssets) {
    $zip = Join-Path $staging $asset.Name
    Write-Host "Downloading $($asset.Name)..."
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaTag/$($asset.Name)" -OutFile $zip
    $hash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
    if ($hash -ne $asset.Sha256) { throw "SHA256 mismatch for $($asset.Name)" }
    Expand-Archive -Path $zip -DestinationPath $target -Force
  }
  # Some archives nest files in a folder; flatten so llama-server.exe sits in bin/llama.
  if (-not (Test-Path (Join-Path $target 'llama-server.exe'))) {
    $server = Get-ChildItem -Recurse -Filter 'llama-server.exe' $target | Select-Object -First 1
    if (-not $server) { throw 'llama-server.exe not found in the downloaded archives' }
    Get-ChildItem $server.Directory | Move-Item -Destination $target -Force
  }
  Set-Content -Encoding ascii $marker $LlamaTag
  Remove-Item -Recurse -Force $staging
}

uv venv --python 3.11 .venv
if ($LASTEXITCODE -ne 0) { throw 'Python setup failed' }
uv pip install --python .venv/Scripts/python.exe -r requirements-desktop.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies failed' }
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Electron dependencies failed' }
Install-Llama
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'models') | Out-Null
Write-Host 'Setup complete. Put GGUF models in models\<name>\ (see README), then run npm start.'
