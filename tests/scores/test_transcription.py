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


def midi_notes(path):
    from music21 import midi
    data = midi.MidiFile()
    data.open(path); data.read(); data.close()
    found, tempos = [], []
    for track in data.tracks:
        tick = 0
        for event in track.events:
            if isinstance(event, midi.DeltaTime):
                tick += event.time
            elif event.type == midi.ChannelVoiceMessages.NOTE_ON and event.velocity:
                found.append((tick, event.pitch))
            elif event.type == midi.MetaEvents.SET_TEMPO:
                tempos.append(tick)
    return data.ticksPerQuarterNote, found, tempos


@pytest.mark.parametrize('bpm', [60,180])
def test_midi_offset_keeps_tempo_at_zero(tmp_path, bpm):
    write_score([{'start':2., 'end':2.5, 'pitch':45, 'velocity':85}], tmp_path,
                stem='bass', bpm=bpm, beats=4, offset=2, duration=4)
    ppq, notes, tempos = midi_notes(tmp_path/'score.mid')
    assert min(tempos) == 0
    assert notes[0][0] / ppq * 60/bpm == pytest.approx(2, abs=.001)


def test_drum_mapping_survives_offset_and_musicxml(tmp_path):
    write_score([{'start':1.,'end':1.1,'pitch':36,'velocity':85},
                 {'start':1.,'end':1.1,'pitch':42,'velocity':85}], tmp_path,
                stem='drums', bpm=120, beats=4, offset=1, duration=3)
    _, notes, _ = midi_notes(tmp_path/'score.mid')
    assert {n[1] for n in notes} == {36,42}
    root = ET.parse(tmp_path/'score.musicxml').getroot()
    assert {int(n.text)-1 for n in root.findall('.//midi-unpitched')} == {36,38,42}
    assert len(root.findall('.//note/instrument')) == 2


def test_pdf_render_has_print_resolution(tmp_path):
    import io
    from PIL import Image
    from app.pipeline.sheet_music import render_score_png
    write_score([{'start':0.,'end':1.,'pitch':45,'velocity':85}], tmp_path,
                stem='bass', bpm=120, beats=4, offset=0, duration=4)
    image = Image.open(io.BytesIO(render_score_png((tmp_path/'page-1.svg').read_text())))
    assert image.width == 2520
    assert image.height > 200
    assert image.convert('L').getextrema()[0] < 50


def test_bass_tab_contains_string_fret_and_four_lines(tmp_path):
    result = write_score([{'start':0.,'end':.5,'pitch':28,'velocity':85},
                          {'start':.5,'end':1.,'pitch':45,'velocity':85}], tmp_path,
                         stem='bass', bpm=120, beats=4, offset=0, duration=2, notation='tab')
    root = ET.parse(tmp_path/'score.musicxml').getroot()
    assert root.find('.//clef/sign').text == 'TAB'
    assert root.find('.//staff-lines').text == '4'
    assert [(n.findtext('string'), n.findtext('fret')) for n in root.findall('.//technical')] == [('4','0'), ('1','2')]
    svg = ET.parse(tmp_path/'page-1.svg').getroot()
    assert 'Tablatura' in ''.join(svg.itertext())
    assert result['notation'] == 'tab'
    assert result['measures'][0]['id'] == 'tab-m1'


def test_tab_reports_out_of_range_pitch(tmp_path):
    with pytest.raises(ValueError, match='alcance'):
        write_score([{'start':0.,'end':1.,'pitch':20,'velocity':85}], tmp_path,
                    stem='bass', bpm=120, beats=4, offset=0, duration=2, notation='tab')


def test_tab_quantized_collision_matches_musicxml(tmp_path):
    write_score([{'start':.01,'end':.08,'pitch':28,'velocity':85},
                 {'start':.08,'end':.15,'pitch':33,'velocity':85}], tmp_path,
                stem='bass', bpm=60, beats=4, offset=0, duration=2, notation='tab')
    root=ET.parse(tmp_path/'score.musicxml').getroot()
    assert root.find('.//pitch/step').text == 'E'
    svg=ET.parse(tmp_path/'page-1.svg').getroot()
    ns={'s':'http://www.w3.org/2000/svg'}
    notes=svg.findall('.//s:text[@class="note"]',ns)
    assert len(notes)==1
    # Fourth-string E is drawn 48px below the top G string (y140).
    assert notes[0].get('y') == '193'


def test_five_string_low_b_tablature(tmp_path):
    result=write_score([{'start':0.,'end':1.,'pitch':23,'velocity':85}],tmp_path,
                       stem='bass',bpm=120,beats=4,offset=0,duration=2,notation='tab',strings=5)
    root=ET.parse(tmp_path/'score.musicxml').getroot()
    assert root.findtext('.//staff-lines')=='5'
    assert root.findtext('.//technical/string')=='5'
    assert root.findtext('.//technical/fret')=='0'
    assert root.findtext('.//staff-tuning[@line="1"]/tuning-step')=='B'
    assert result['strings']==5
    assert result['timeline'][0]['pitch']==23
    assert result['timeline'][0]['string']==5
    assert result['timeline'][0]['start']==0
