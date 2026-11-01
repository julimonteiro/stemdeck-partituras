from types import SimpleNamespace
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from app.api import scores

@pytest.fixture
def client(monkeypatch, tmp_path):
    from app.api import stems
    monkeypatch.setattr(stems, 'JOBS_DIR', tmp_path)
    monkeypatch.setattr(stems, 'registry_get', lambda job: SimpleNamespace(status='done'))
    folder = tmp_path/'abc123def456'/'stems'
    folder.mkdir(parents=True)
    (folder/'bass.wav').write_bytes(b'RIFF')
    app = FastAPI()
    app.include_router(scores.router, prefix='/api')
    return TestClient(app)


def test_invalid_request_does_not_queue(client):
    assert client.post('/api/jobs/abc123def456/scores/guitar', json={}).status_code == 422
    for body in [{'engine':'unknown'}, {'bpm': 0}, {'bpm': 'nan'}, {'beats': 0}, {'offset': -1}]:
        assert client.post('/api/jobs/abc123def456/scores/bass', json=body).status_code == 422
    assert client.post('/api/jobs/abc123def456/scores/drums', json={'notation':'tab'}).status_code == 422
    assert client.post('/api/jobs/abc123def456/scores/bass', json={'notation':'arbitrary'}).status_code == 422
    assert client.post('/api/jobs/invalid/scores/bass', json={}).status_code == 404


def test_queue_deduplicates_and_returns_progress(client, monkeypatch):
    submitted = []
    monkeypatch.setattr(scores.executor, 'submit', lambda *args: submitted.append(args))
    scores.states.clear()
    r = client.post('/api/jobs/abc123def456/scores/bass', json={'bpm':120})
    assert r.status_code == 202
    token = r.json()['token']
    again = client.post('/api/jobs/abc123def456/scores/bass', json={'bpm':120})
    assert again.json()['token'] == token
    assert len(submitted) == 1
    status = client.get(f'/api/jobs/abc123def456/scores/bass/{token}')
    assert status.json()['status'] == 'queued'
    assert client.get(f'/api/jobs/abc123def456/scores/bass/{token}/file/request.json').status_code == 404
    assert client.get('/api/jobs/abc123def456/scores/bass/not-a-key').status_code == 404
