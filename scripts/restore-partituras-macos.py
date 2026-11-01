#!/usr/bin/env python3
"""Restore files saved by install-partituras-macos.py. Quit StemDeck first."""
import argparse
import json
from pathlib import Path
import shutil
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('backup', type=Path)
args = parser.parse_args()
backend = Path.home()/'Library/Application Support/StemDeck/runtime/backend'
for entry in json.loads((args.backup/'manifest.json').read_text()):
    relative = Path(entry['path'])
    if relative.is_absolute() or '..' in relative.parts:
        raise SystemExit('Invalid backup manifest')
    target = backend/relative
    if entry['existed']:
        shutil.copy2(args.backup/relative, target)
    else:
        target.unlink(missing_ok=True)
print('Restored. Reopen StemDeck. Audio library and dependencies were preserved.')
