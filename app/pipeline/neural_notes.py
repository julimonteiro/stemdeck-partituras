"""Optional local note models; external packages/weights are not redistributed."""
from __future__ import annotations
import math
from pathlib import Path
import tempfile


def verify_model(path, expected):
    import hashlib
    if not path or not Path(path).is_file():
        raise RuntimeError('Modelo ausente. Reinstale os modelos avançados com --neural.')
    if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=expected:
        raise RuntimeError('O modelo não corresponde à versão validada. Reinstale os modelos avançados com --neural.')


def normalize_bass_notes(notes, *, strings, duration, support=()):
    """Constrain monophonic bass, reconcile reliable octave evidence, keep attacks."""
    minimum=23 if strings==5 else 28
    candidates=[]
    reliable=[s for s in support if s.get('confidence',0)>=.8]
    for index,n in enumerate(notes):
        a,b,p,c=float(n[0]),float(n[1]),int(n[2]),float(n[3])
        if not all(math.isfinite(x) for x in (a,b,c)) or c<.25:
            continue
        a,b=max(0,a),min(duration,b)
        if b-a<.06:
            continue
        votes={}
        for s in reliable:
            overlap=max(0,min(b,s['end'])-max(a,s['start']))
            votes[s['pitch']]=votes.get(s['pitch'],0)+overlap
        if votes:
            pitch,coverage=max(votes.items(),key=lambda v:v[1])
            if coverage>=(b-a)*.5 and abs(p-pitch)==12:
                p=pitch
        if minimum<=p<=67:
            candidates.append(dict(start=a,end=b,pitch=p,confidence=c,id=index))
    # Restore a clearly voiced note that the neural onset detector entirely missed.
    for s in reliable:
        a,b=max(0,s['start']),min(duration,s['end'])
        if b-a<.1 or not minimum<=s['pitch']<=67 or s.get('confidence',0)<(.8 if s['pitch']<=35 else .9):
            continue
        if any(max(0,min(b,n['end'])-max(a,n['start']))>(b-a)*.2 for n in candidates):
            continue
        candidates.append(dict(start=a,end=b,pitch=s['pitch'],confidence=s['confidence'],id=len(notes)+len(candidates)))
    boundaries=sorted({v for n in candidates for v in (n['start'],n['end'])})
    result=[]
    previous=None
    for a,b in zip(boundaries,boundaries[1:]):
        covering=[n for n in candidates if n['start']<=a+1e-7 and n['end']>=b-1e-7]
        if not covering:
            previous=None
            continue
        n=max(covering,key=lambda n:(n['confidence'],-n['pitch']))
        if result and previous==n['id'] and abs(result[-1]['end']-a)<1e-5:
            result[-1]['end']=round(b,5)
        else:
            result.append(dict(start=round(a,5),end=round(b,5),pitch=n['pitch'],
                               confidence=round(n['confidence'],4),velocity=max(30,min(120,round(n['confidence']*127)))))
        previous=n['id']
    cleaned=[]
    for event in (e for e in result if e['end']-e['start']>=.06):
        boundary=event['start']
        sustained=any(s.get('confidence',0)>=.7 and s['pitch']==event['pitch'] and s['start']<boundary-.1 and s['end']>=event['end']-.03 for s in support)
        if cleaned and cleaned[-1]['pitch']==event['pitch'] and abs(cleaned[-1]['end']-boundary)<.03 and event['end']-boundary<=.12 and event['confidence']<.45 and sustained:
            cleaned[-1]['end']=event['end']
        else:
            cleaned.append(event)
    return cleaned


def drum_events(peaks, *, duration, activations=None):
    result=[]
    classes=[35,38,47,42,49]
    for pitch,times in peaks.items():
        if pitch not in classes:
            continue
        for value in times:
            start=float(value)
            if not math.isfinite(start) or start<0 or start>=duration:
                continue
            confidence=.8
            if activations is not None:
                confidence=float(activations[min(len(activations)-1,round(start*100)),classes.index(pitch)])
            result.append(dict(start=round(start,5),end=round(min(duration,start+.06),5),
                               pitch=36 if pitch==35 else int(pitch),confidence=round(confidence,4),
                               velocity=max(30,min(120,round(confidence*127)))))
    return sorted(result,key=lambda e:(e['start'],e['pitch']))


def neural_bass(source: Path, *, strings, y, sr, support, progress):
    try:
        from basic_pitch.inference import Model,predict
        from basic_pitch import build_icassp_2022_model_path,FilenameSuffix
    except ImportError as exc:
        raise RuntimeError('Instale os modelos avançados com scripts/install-partituras-macos.py --neural, ou escolha Clássico.') from exc
    import librosa
    model_path=build_icassp_2022_model_path(FilenameSuffix.onnx)
    verify_model(model_path,'2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec')
    model=Model(model_path)
    progress(30,'Detectando ataques e durações com Basic Pitch…')
    # The official predictor windows/stitches its network outputs before note
    # decoding. Preserve that continuous decoding rather than cutting held notes
    # into independent files at arbitrary 20-second boundaries.
    _,_,notes=predict(source,model,minimum_frequency=float(librosa.midi_to_hz(23 if strings==5 else 28)),
                      maximum_frequency=float(librosa.midi_to_hz(67)),minimum_note_length=60,
                      onset_threshold=.4,frame_threshold=.25,melodia_trick=False)
    progress(70,'Conferindo oitavas e notas simultâneas…')
    return normalize_bass_notes(notes,strings=strings,duration=len(y)/sr,support=support)


def neural_drums(source: Path, *, progress):
    try:
        from adtof_pytorch import create_frame_rnn_model,calculate_n_bins,load_pytorch_weights,load_audio_for_model,get_default_weights_path,PeakPicker,LABELS_5
    except ImportError as exc:
        raise RuntimeError('Instale o modelo avançado de bateria com scripts/install-partituras-macos.py --neural, ou escolha Clássico.') from exc
    import numpy as np
    import soundfile as sf
    import torch
    weights=get_default_weights_path()
    if not weights or not Path(weights).is_file():
        raise RuntimeError('Pesos ADTOF ausentes. Reinstale os modelos avançados; nenhuma transcrição foi gerada com pesos aleatórios.')
    verify_model(weights,'1bc986e596ec47ba0b44916f87cd4a39f0b2bec23596df3fb5d0e87749217320')
    torch.set_num_threads(min(4,torch.get_num_threads()))
    model=load_pytorch_weights(create_frame_rnn_model(calculate_n_bins()),weights,strict=True)
    model.eval()
    info=sf.info(source)
    duration=info.duration
    predictions=[]
    with tempfile.TemporaryDirectory(prefix='stemdeck-drums-') as temp, sf.SoundFile(source) as audio:
        path=Path(temp)/'segment.wav'
        for start in range(0,math.ceil(duration),20):
            begin=max(0,start-1)
            end=min(duration,start+21)
            audio.seek(round(begin*info.samplerate))
            data=audio.read(round((end-begin)*info.samplerate),dtype='float32')
            sf.write(path,data,info.samplerate)
            x=load_audio_for_model(str(path))
            with torch.inference_mode():
                output=model(x).cpu().numpy()[0]
            crop=round((start-begin)*100)
            count=round((min(duration,start+20)-start)*100)
            segment=output[crop:crop+count]
            if len(segment)<count:
                segment=np.pad(segment,((0,count-len(segment)),(0,0)))
            predictions.append(segment)
            progress(25+int(45*min(start+20,duration)/duration),'Reconhecendo bumbo, caixa, tons e pratos…')
    activations=np.concatenate(predictions,axis=0)
    peaks=PeakPicker().pick(activations,labels=LABELS_5)[0]
    return drum_events(peaks,duration=duration,activations=activations)
