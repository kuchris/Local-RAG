"""Bundle the current standalone CPython plus production dependencies for Windows."""
import json
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
destination = root / 'runtime'
source = Path(sys.base_prefix).resolve()
if not (source / 'python.exe').exists() or not (source / 'Lib').exists():
    raise SystemExit('Run with the Windows .venv Python created by setup.ps1.')
if destination.resolve().parent != root:
    raise SystemExit('Runtime destination is outside the workspace.')
shutil.copytree(source, destination, dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('__pycache__', 'site-packages', 'test', 'tests'))
python = destination / 'python.exe'
prefix = subprocess.check_output([str(python), '-I', '-c', 'import sys; print(sys.prefix)'], text=True).strip()
if Path(prefix).resolve() != destination.resolve():
    raise SystemExit('Copied Python did not resolve to the bundled runtime.')
(destination / 'Lib' / 'EXTERNALLY-MANAGED').unlink(missing_ok=True)
subprocess.run(['uv', 'pip', 'install', '--python', str(python), '--system', '-r', str(root / 'requirements-desktop.txt')], check=True)
subprocess.run([str(python), '-I', '-c', 'import fastapi, uvicorn, pypdf, numpy, httpx, defusedxml; print("Bundled runtime OK")'], check=True)
(destination / 'bundle-info.json').write_text(json.dumps({'python': sys.version, 'requirements': 'requirements-desktop.txt'}, indent=2))
