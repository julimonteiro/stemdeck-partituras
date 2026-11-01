"""Bounded, cached, subprocess-isolated local score generation."""
from __future__ import annotations
import hashlib
import json
import logging
import re
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from app.api.stems import _validate_stem_path

router = APIRouter(tags=['scores'])
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='sheet-music')
lock = threading.Lock()
states: dict[str, dict] = {}
log = logging.getLogger('stemdeck.scores')
VERSION = 4

class Options(BaseModel):
    notation: Literal["standard", "tab"] = "standard"
    bpm: float = Field(default=120, ge=30, le=300, allow_inf_nan=False)
    beats: int = Field(default=4, ge=1, le=12)
    offset: float = Field(default=0, ge=0, le=60, allow_inf_nan=False)


def location(job_id, stem, token):
    source = _validate_stem_path(job_id, stem)
    if not re.fullmatch(r'[a-f0-9]{20}', token):
        raise HTTPException(404, 'Partitura não encontrada.')
    directory = source.parent.parent/'scores'/stem/token
    if not directory.resolve().is_relative_to(source.parent.parent.resolve()):
        raise HTTPException(404, 'Partitura não encontrada.')
    return source, directory


def state_for(key, directory):
    with lock:
        current = states.get(key)
        if current:
            return dict(current)
    try:
        result = json.loads((directory/'result.json').read_text())
        return dict(status='done', progress=100, message='Partitura pronta.', result=result)
    except (OSError, ValueError):
        raise HTTPException(404, 'Partitura não encontrada; gere novamente.') from None


def work(key, source, directory, stem, options):
    def update(**values):
        with lock:
            states[key].update(values)
    update(status='running', progress=5, message='Preparando transcrição…')
    try:
        directory.mkdir(parents=True, exist_ok=True)
        request = dict(source=str(source), directory=str(directory), stem=stem, **options)
        (directory/'request.json').write_text(json.dumps(request))
        # A subprocess keeps ML and notation imports out of the audio-serving process.
        with (directory/'worker.log').open('w') as errors:
            process = subprocess.Popen([sys.executable, '-m', 'app.pipeline.sheet_music',
                                        str(directory/'request.json')],
                                       stdout=subprocess.PIPE, stderr=errors, text=True)
            deadline = threading.Timer(900, process.kill)
            deadline.daemon = True
            deadline.start()
            result = None
            error = None
            try:
                for line in process.stdout:
                    try:
                        value = json.loads(line)
                    except ValueError:
                        continue
                    if 'progress' in value:
                        update(progress=value['progress'], message=value['message'])
                    if 'result' in value:
                        result = value['result']
                    if 'error' in value:
                        error = value['error']
                code = process.wait()
            finally:
                deadline.cancel()
                if process.poll() is None:
                    process.kill()
                    process.wait()
        if code != 0 or result is None:
            raise RuntimeError(error or 'A transcrição falhou ou excedeu 15 minutos. Tente novamente.')
        update(status='done', progress=100, message='Partitura pronta — revise a transcrição.', result=result)
    except Exception as exc:
        log.exception('score generation failed')
        update(status='error', message=str(exc), progress=0)


@router.post('/jobs/{job_id}/scores/{stem}')
def create(job_id: str, stem: Literal['bass', 'drums'], options: Options):
    if stem == "drums" and options.notation == "tab":
        raise HTTPException(422, "Tablatura disponível apenas para baixo.")
    source = _validate_stem_path(job_id, stem)
    signature = [VERSION, stem, source.stat().st_size, source.stat().st_mtime_ns, options.model_dump()]
    token = hashlib.sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()[:20]
    _, directory = location(job_id, stem, token)
    key = f'{job_id}:{stem}:{token}'
    if (directory/'result.json').is_file():
        state = state_for(key, directory)
        return dict(token=token, **state)
    with lock:
        if key not in states or states[key]['status'] == 'error':
            pending = sum(s['status'] in ('queued', 'running') for s in states.values())
            if pending >= 4:
                raise HTTPException(429, 'Há quatro partituras na fila. Aguarde uma terminar.')
            # Keep transient state bounded; completed results remain on disk.
            if len(states) >= 100:
                for old in list(states):
                    if states[old]['status'] not in ('queued', 'running'):
                        del states[old]
            states[key] = dict(status='queued', progress=0, message='Na fila para transcrição…')
            executor.submit(work, key, source, directory, stem, options.model_dump())
        state = dict(states[key])
    return JSONResponse(dict(token=token, **state), status_code=202)


@router.get('/jobs/{job_id}/scores/{stem}/{token}')
def status(job_id: str, stem: Literal['bass', 'drums'], token: str):
    _, directory = location(job_id, stem, token)
    return state_for(f'{job_id}:{stem}:{token}', directory)


@router.get('/jobs/{job_id}/scores/{stem}/{token}/file/{filename}')
def download(job_id: str, stem: Literal['bass', 'drums'], token: str, filename: str):
    _, directory = location(job_id, stem, token)
    allowed = filename in ('score.musicxml', 'score.mid', 'score.pdf') or re.fullmatch(r'page-[1-9][0-9]{0,3}\.svg', filename)
    if not allowed or not (directory/'result.json').is_file() or not (directory/filename).is_file():
        raise HTTPException(404, 'Arquivo não encontrado.')
    if filename.endswith('.svg'):
        return FileResponse(directory/filename, media_type='image/svg+xml',
                            headers={'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:"})
    types = {'score.musicxml': 'application/vnd.recordare.musicxml+xml',
             'score.mid': 'audio/midi', 'score.pdf': 'application/pdf'}
    return FileResponse(directory/filename, media_type=types[filename], filename=f'{stem}-{filename}')
