#!/usr/bin/env python3
"""Install this extension into an existing StemDeck v0.20.0 macOS runtime."""
import argparse
import datetime
import json
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--neural', action='store_true', help='Install optional Basic Pitch and ADTOF models (ADTOF: non-commercial research use)')
parser.add_argument('--skip-deps', action='store_true', help='Dependencies already installed')
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
workspace = Path.home()/'Library/Application Support/StemDeck'
backend = workspace/'runtime/backend'
python = workspace/'runtime/python/bin/python'
if not (backend/'app/api/router.py').is_file() or not python.is_file():
    raise SystemExit('Open official StemDeck once and complete setup before installing this extension.')
files = ['app/api/router.py', 'app/api/scores.py', 'app/pipeline/sheet_music.py', 'app/pipeline/sheet_music_render.py', 'app/pipeline/neural_notes.py',
         'static/js/mixer.js', 'static/js/scores.js', 'static/js/scoreTimeline.js', 'static/js/notationSpacing.js', 'static/js/transport.js', 'static/css/scores.css']
backup = workspace/'extension-backups'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
backup.mkdir(parents=True)
manifest = []
for name in files:
    target = backend/name
    exists = target.exists()
    if exists:
        saved = backup/name
        saved.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, saved)
    manifest.append({'path': name, 'existed': exists})
(backup/'manifest.json').write_text(json.dumps(manifest, indent=2))
if not args.skip_deps:
    subprocess.run([str(python), '-m', 'pip', 'install', 'music21>=9,<10', 'verovio>=5,<6',
                    'reportlab>=4,<5', 'resvg-py>=0.2,<1'], check=True)
if args.neural:
    # The ONNX path uses the app's existing numpy/librosa/onnxruntime. Installing
    # optional model packages without their training-framework dependencies
    # avoids replacing the working Torch/MPS stack or pulling TensorFlow.
    subprocess.run([str(python),'-m','pip','install','pretty_midi>=0.2.10,<0.3','mir_eval>=0.8,<0.9'],check=True)
    subprocess.run([str(python),'-m','pip','install','--no-deps','basic-pitch==0.4.0',
                    'git+https://github.com/xavriley/ADTOF-pytorch.git@85c192e78f716ea0b111cc8a5ee4a8f6a3a4f8a9'],check=True)
    print('Optional models installed. ADTOF original material: CC BY-NC-SA 4.0. See docs/notation-models.md.')
for name in files:
    target = backend/name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(repo/name, target)
print('Installed. Quit and reopen StemDeck.')
print(f'Backup: {backup}')
