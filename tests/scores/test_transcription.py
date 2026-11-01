import json
from pathlib import Path
import xml.etree.ElementTree as ET
import numpy as np
import pytest
import soundfile as sf
from app.pipeline.sheet_music import transcribe_bass, transcribe_drums, write_score, generate


def test_bass_detects_two_notes_and_silence():
    sr = 22050
    t = np.arange(sr) / sr
    y = np.concatenate([.5*np.sin(2*np.pi*110*t), np.zeros(sr//2), .5*np.sin(2*np.pi*146.832*t)])
    events = transcribe_bass(y, sr)
    assert any(e['pitch'] == 45 for e in events)
    assert any(e['pitch'] == 50 for e in events)
    assert not transcribe_bass(np.zeros(sr), sr)
    assert all(e['end'] > e['start'] >= 0 for e in events)


def test_drum_onsets_and_silence():
    sr = 22050
    y = np.zeros(sr*2)
    t = np.arange(2205)/sr
    for at in (.2, .7, 1.2):
        i = int(at*sr)
        y[i:i+len(t)] += np.sin(2*np.pi*65*t)*np.exp(-t*50)
    events = transcribe_drums(y, sr)
    assert len(events) >= 3
    assert any(e['pitch'] == 36 for e in events)
    assert not transcribe_drums(np.zeros(sr), sr)


def test_exports_have_rests_ties_and_valid_files(tmp_path):
    events = [{'start': .5, 'end': 3., 'pitch': 45, 'velocity': 90}]
    result = write_score(events, tmp_path, stem='bass', bpm=120, beats=4, offset=0, duration=4)
    root = ET.parse(tmp_path/'score.musicxml').getroot()
    assert root.findall('.//rest')
    assert root.findall('.//tie')
    assert root.find('.//clef/sign').text == 'F'
    assert (tmp_path/'score.mid').read_bytes().startswith(b'MThd')
    assert (tmp_path/'score.pdf').read_bytes().startswith(b'%PDF')
    assert result['pages'] >= 1
    assert '<svg' in (tmp_path/'page-1.svg').read_text()
    assert result['measures'][0]['start'] == 0


def test_drums_are_unpitched_in_xml(tmp_path):
    write_score([{'start': 0, 'end': .1, 'pitch': 36, 'velocity': 90},
                 {'start': 0, 'end': .1, 'pitch': 42, 'velocity': 80}],
                tmp_path, stem='drums', bpm=120, beats=4, offset=0, duration=2)
    root = ET.parse(tmp_path/'score.musicxml').getroot()
    assert len(root.findall('.//unpitched')) == 2
    assert root.find('.//clef/sign').text == 'percussion'


def test_silent_input_is_reported(tmp_path):
    source = tmp_path/'silent.wav'
    sf.write(source, np.zeros(22050), 22050)
    with pytest.raises(ValueError, match='notas|eventos'):
        generate(source, tmp_path/'out', stem='bass', bpm=120, beats=4, offset=0)
