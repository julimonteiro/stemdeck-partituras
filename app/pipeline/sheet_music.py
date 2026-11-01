"""Local draft notation. Bass is monophonic; drum classes are spectral estimates."""
from __future__ import annotations

import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

from app.pipeline.sheet_music_render import render_score_png, add_tablature_to_xml, tab_pages, quantize_events, timeline_events


def transcribe_bass(y, sr):
    import librosa
    import numpy as np
    if not len(y) or np.max(np.abs(y)) < 1e-5:
        return []
    hop = 256
    # Process bounded chunks so long recordings do not allocate a huge pYIN lattice.
    events = []
    for base in range(0, len(y), sr * 20):
        chunk = y[base:base + sr * 20]
        if len(chunk) < 2048 or np.max(np.abs(chunk)) < 1e-5:
            continue
        f0, voiced, probability = librosa.pyin(
            chunk, sr=sr, fmin=30, fmax=600, frame_length=2048,
            hop_length=hop, fill_na=np.nan,
        )
        rms = librosa.feature.rms(y=chunk, frame_length=2048, hop_length=hop)[0]
        floor = max(float(np.max(rms)) * .06, 1e-5)
        pitches = np.full(len(f0), -1, dtype=int)
        valid = voiced & np.isfinite(f0) & (probability > .08) & (rms[:len(f0)] > floor)
        pitches[valid] = np.rint(librosa.hz_to_midi(f0[valid])).astype(int)
        # Preserve repeated notes by splitting at detected attacks as well as pitch changes.
        attacks = set(librosa.onset.onset_detect(y=chunk, sr=sr, hop_length=hop).tolist())
        start = 0
        for i in range(1, len(pitches) + 1):
            if i < len(pitches) and pitches[i] == pitches[start] and i not in attacks:
                continue
            a, b = base / sr + start * hop / sr, min((base + len(chunk)) / sr, base / sr + i * hop / sr)
            if pitches[start] >= 0 and b - a >= .07:
                events.append(dict(start=round(a, 4), end=round(b, 4), pitch=int(pitches[start]), velocity=85))
            start = i
    return events


def transcribe_drums(y, sr):
    import librosa
    import numpy as np
    if not len(y) or np.max(np.abs(y)) < 1e-5:
        return []
    hop = 128
    magnitude = np.abs(librosa.stft(y, n_fft=1024, hop_length=hop))
    frequencies = librosa.fft_frequencies(sr=sr, n_fft=1024)
    events = []
    # Independent bands allow simultaneous kick/snare/cymbal estimates.
    for low, high, pitch in [(35, 180, 36), (180, 2500, 38), (4500, sr/2, 42)]:
        band = magnitude[(frequencies >= low) & (frequencies < high)]
        env = np.maximum(0, np.diff(band, axis=1, prepend=band[:, :1])).mean(axis=0)
        if not len(env) or float(env.max()) < 1e-5:
            continue
        frames = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=hop,
                                            backtrack=False, delta=.15, wait=5)
        for frame in frames:
            if env[frame] < env.max() * .10:
                continue
            start = float(frame * hop / sr)
            events.append(dict(start=round(start, 4), end=round(start + .06, 4), pitch=pitch, velocity=85))
    return sorted(events, key=lambda e: (e['start'], e['pitch']))


def write_score(events, directory: Path, *, stem: str, bpm: float, beats: int,
                offset: float, duration: float, notation: str = "standard", strings: int = 4):
    from music21 import stream, note, meter, clef, tempo, instrument, percussion, metadata
    import verovio
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader
    import io
    from reportlab.lib.pagesizes import A4

    directory.mkdir(parents=True, exist_ok=True)
    score = stream.Score()
    score.metadata = metadata.Metadata()
    score.metadata.title = 'Baixo — rascunho' if stem == 'bass' else 'Bateria — estimativa experimental'
    score.metadata.composer = 'StemDeck · transcrição automática, revisar antes de usar'
    part = stream.Part()
    part.insert(0, instrument.ElectricBass() if stem == 'bass' else instrument.Percussion())
    part.insert(0, clef.BassClef() if stem == 'bass' else clef.PercussionClef())
    part.insert(0, meter.TimeSignature(f'{beats}/4'))
    part.insert(0, tempo.MetronomeMark(text=f'{bpm:g} BPM', number=bpm))
    quantized = quantize_events(events, bpm=bpm, offset=offset)
    cursor = 0
    for tick in sorted(quantized):
        if tick < cursor:
            continue
        if tick > cursor:
            part.insert(cursor / 4, note.Rest(quarterLength=(tick - cursor) / 4))
        group = quantized[tick]
        if stem == 'bass':
            event, end = max(group, key=lambda v: v[1])
            following = next((t for t in sorted(quantized) if t > tick), end)
            length = max(1, min(end, following) - tick)
            item = note.Note(event['pitch'], quarterLength=length / 4)
        else:
            kit = {36: instrument.BassDrum, 38: instrument.SnareDrum, 42: instrument.HiHatCymbal}
            positions = {36: ('F', 4), 38: ('C', 5), 42: ('G', 5)}
            notes = []
            for pitch in sorted({event['pitch'] for event, _ in group}):
                unpitched = note.Unpitched()
                unpitched.storedInstrument = kit[pitch]()
                unpitched.storedInstrument.percMapPitch = pitch
                unpitched.displayStep, unpitched.displayOctave = positions[pitch]
                if pitch == 42:
                    unpitched.notehead = 'x'
                notes.append(unpitched)
            item = percussion.PercussionChord(notes) if len(notes) > 1 else notes[0]
            length = 1
            item.quarterLength = .25
        part.insert(tick / 4, item)
        cursor = tick + length
    final_tick = max(cursor, math.ceil(max(0, duration-offset) * bpm/60*4))
    if final_tick > cursor:
        part.insert(cursor / 4, note.Rest(quarterLength=(final_tick-cursor)/4))
    score.insert(0, part)
    score = score.makeNotation(inPlace=False)
    score.write('musicxml', fp=directory/'score.musicxml')
    score.write('midi', fp=directory/'score.mid')
    if stem == 'drums':
        # Music21's generic percussion part omits the per-note kit mapping in XML.
        tree = ET.parse(directory/'score.musicxml')
        root = tree.getroot()
        score_part = root.find('./part-list/score-part')
        for old in list(score_part):
            if old.tag in ('score-instrument', 'midi-instrument'):
                score_part.remove(old)
        for pitch, label in [(36, 'Bumbo'), (38, 'Caixa'), (42, 'Chimbal')]:
            ident = f'kit-{pitch}'
            inst = ET.SubElement(score_part, 'score-instrument', id=ident)
            ET.SubElement(inst, 'instrument-name').text = label
            inst = ET.SubElement(score_part, 'midi-instrument', id=ident)
            ET.SubElement(inst, 'midi-channel').text = '10'
            ET.SubElement(inst, 'midi-unpitched').text = str(pitch + 1)
        mapping = {('F', '4'): 36, ('C', '5'): 38, ('G', '5'): 42}
        for n in root.findall('.//note'):
            u = n.find('unpitched')
            if u is not None:
                pitch = mapping[(u.findtext('display-step'), u.findtext('display-octave'))]
                inst = ET.Element('instrument', id=f'kit-{pitch}')
                duration_node = n.find('duration')
                n.insert(list(n).index(duration_node) + 1, inst)
        tree.write(directory/'score.musicxml', encoding='utf-8', xml_declaration=True)
    # Delay note events directly: a MusicXML roundtrip discards drum assignments,
    # and shifting measures shifts the tempo mark away from tick zero.
    if offset:
        from music21 import midi
        data = midi.MidiFile()
        data.open(directory/'score.mid'); data.read(); data.close()
        delay = round(offset * bpm / 60 * data.ticksPerQuarterNote)
        for track in data.tracks:
            for index, event in enumerate(track.events):
                if event.type == midi.ChannelVoiceMessages.NOTE_ON and event.velocity:
                    track.events[index - 1].time += delay
                    break
        data.open(directory/'score.mid', 'wb'); data.write(); data.close()
    if notation == 'tab':
        if stem != 'bass':
            raise ValueError('Tablatura disponível apenas para baixo.')
        add_tablature_to_xml(directory/'score.musicxml', strings)
        rendered, measures = tab_pages(events, bpm=bpm, beats=beats, offset=offset, duration=duration, strings=strings)
    else:
        toolkit = verovio.toolkit()
        toolkit.setOptions({'pageWidth': 2100, 'pageHeight': 2970, 'scale': 40, 'breaks': 'auto', 'adjustPageHeight': True, 'svgViewBox': True})
        if not toolkit.loadFile(str(directory/'score.musicxml')):
            raise RuntimeError('Não foi possível desenhar a partitura.')
        rendered = [toolkit.renderToSVG(page) for page in range(1, toolkit.getPageCount()+1)]
        measures = []
    pdf = canvas.Canvas(str(directory/'score.pdf'), pagesize=A4)
    for page, svg in enumerate(rendered, 1):
        path = directory/f'page-{page}.svg'
        path.write_text(svg)
        for node in ET.fromstring(svg).iter():
            if notation != 'tab' and 'measure' in node.get('class', '').split():
                index = len(measures)
                measures.append(dict(number=index+1, start=round(offset + index*beats*60/bpm, 5),
                                     id=node.get('id'), page=page))
        image = ImageReader(io.BytesIO(render_score_png(svg)))
        width, height = image.getSize()
        scale = min((A4[0]-40)/width, (A4[1]-40)/height)
        pdf.drawImage(image, 20, A4[1]-20-height*scale, width=width*scale, height=height*scale)
        pdf.showPage()
    pdf.save()
    return dict(pages=len(rendered), measures=measures, notes=len(events), notation=notation, strings=strings,
                timeline=timeline_events(events, bpm=bpm, offset=offset, stem=stem, strings=strings),
                bpm=bpm, beats=beats, offset=offset, duration=duration, stem=stem)


def generate(source: Path, directory: Path, *, stem: str, bpm: float, beats: int,
             offset: float, notation: str = "standard", strings: int = 4, progress=lambda percent, message: None):
    import librosa
    import soundfile as sf
    info = sf.info(str(source))
    if info.duration > 900:
        raise ValueError('Esta versão aceita faixas de até 15 minutos.')
    progress(10, 'Lendo a faixa de áudio…')
    y, sr = librosa.load(str(source), sr=22050, mono=True)
    progress(25, 'Detectando notas do baixo…' if stem == 'bass' else 'Estimando bumbo, caixa e chimbal…')
    events = transcribe_bass(y, sr) if stem == 'bass' else transcribe_drums(y, sr)
    if not events or not any(e['end'] > offset for e in events):
        raise ValueError('Não foram detectadas notas ou eventos suficientes nesta faixa.')
    progress(75, 'Escrevendo e desenhando a partitura…')
    result = write_score(events, directory, stem=stem, bpm=bpm, beats=beats,
                         offset=offset, duration=info.duration, notation=notation, strings=strings)
    (directory/'result.json').write_text(json.dumps(result))
    progress(100, 'Partitura pronta — revise a transcrição.')
    return result


if __name__ == '__main__':
    import sys
    request = json.loads(Path(sys.argv[1]).read_text())
    def report(percent, message):
        print(json.dumps(dict(progress=percent, message=message)), flush=True)
    try:
        result = generate(Path(request.pop('source')), Path(request.pop('directory')),
                          progress=report, **request)
        print(json.dumps(dict(result=result)), flush=True)
    except Exception as exc:
        print(json.dumps(dict(error=str(exc))), flush=True)
        sys.exit(1)
