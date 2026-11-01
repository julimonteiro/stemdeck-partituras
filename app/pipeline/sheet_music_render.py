"""Vector score rendering helpers and standard four-string bass tablature."""
from __future__ import annotations
import io
import math
import xml.etree.ElementTree as ET

SVG = 'http://www.w3.org/2000/svg'


def render_score_png(svg):
    """Render notation at print resolution, preserving paths and nested SVGs."""
    import resvg_py
    root = ET.fromstring(svg)
    # Music webfonts are browser-only. Retain the explicit BPM direction.
    for parent in root.iter():
        for child in list(parent):
            if 'tempo' in child.get('class', '').split() or child.tag == f'{{{SVG}}}title':
                parent.remove(child)
    # Verovio's deeply nested, zero-size text containers work in WebKit but
    # several SVG libraries lose their inherited coordinates. Flatten text.
    for text in root.iter(f'{{{SVG}}}text'):
        attrs = dict(text.attrib)
        for name in ('x','y','text-anchor','font-size','font-weight','font-style','font-family'):
            if name == 'font-size' and attrs.get(name) == '0px': attrs.pop(name, None)
            if name not in attrs:
                match = next((n.get(name) for n in text.iter() if n.get(name) and n.get(name) != '0px'), None)
                if match is not None: attrs[name] = match
        content = ' '.join(''.join(text.itertext()).split())
        text.clear(); text.attrib.update(attrs); text.text = content
    return resvg_py.svg_to_bytes(svg_string=ET.tostring(root, encoding='unicode'), width=2520, background='white')


def bass_fingering(pitch, strings=4):
    # MusicXML string 1 is the highest-pitched string.
    choices = [(pitch-open_pitch, string) for string, open_pitch in ([(1,43),(2,38),(3,33),(4,28)] + ([(5,23)] if strings == 5 else []))
               if 0 <= pitch-open_pitch <= 24]
    if not choices:
        raise ValueError(f'Há notas fora do alcance de um baixo de {strings} cordas (24 trastes). Use a partitura tradicional ou selecione 5 cordas.')
    fret, string = min(choices)
    return string, fret


def add_tablature_to_xml(path, strings=4):
    from music21.pitch import Pitch
    tree = ET.parse(path)
    root = tree.getroot()
    clef = root.find('.//clef')
    clef.clear()
    ET.SubElement(clef, 'sign').text = 'TAB'
    ET.SubElement(clef, 'line').text = '5'
    attributes = root.find('.//attributes')
    details = ET.SubElement(attributes, 'staff-details')
    ET.SubElement(details, 'staff-lines').text = str(strings)
    tuning_notes = ([('B',0)] if strings == 5 else []) + [('E',1),('A',1),('D',2),('G',2)]
    for line, (step, octave) in enumerate(tuning_notes,1):
        tuning = ET.SubElement(details, 'staff-tuning', line=str(line))
        ET.SubElement(tuning, 'tuning-step').text = step
        ET.SubElement(tuning, 'tuning-octave').text = str(octave)
    for n in root.findall('.//note'):
        p = n.find('pitch')
        if p is None:
            continue
        pitch = Pitch()
        pitch.step = p.findtext('step')
        pitch.octave = int(p.findtext('octave'))
        pitch.accidental = float(p.findtext('alter', '0'))
        string, fret = bass_fingering(int(pitch.midi), strings)
        notations = n.find('notations')
        if notations is None:
            notations = ET.SubElement(n, 'notations')
        tech = ET.SubElement(notations, 'technical')
        ET.SubElement(tech, 'string').text = str(string)
        ET.SubElement(tech, 'fret').text = str(fret)
    tree.write(path, encoding='utf-8', xml_declaration=True)


def tab_pages(events, *, bpm, beats, offset, duration, strings=4):
    """Readable TAB with beat guides; measures retain source-time positions."""
    count = max(1, math.ceil((duration-offset)*bpm/60/beats))
    per_row = max(1, min(4, 16//beats))
    per_page = per_row * 6
    pages, measures = [], []
    grouped = quantize_events(events, bpm=bpm, offset=offset)
    quantized = {tick: (e['pitch'], end) for tick, group in grouped.items()
                 for e, end in [max(group, key=lambda pair: pair[1])]} 
    notes = []
    ordered = sorted(quantized)
    for i,tick in enumerate(ordered):
        pitch,end = quantized[tick]
        if i+1 < len(ordered): end = min(end, ordered[i+1])
        string,fret = bass_fingering(pitch, strings)
        notes.append((tick,end,string,fret))
    ET.register_namespace('', SVG)
    def add(parent, tag, text=None, **attrs):
        n = ET.SubElement(parent, f'{{{SVG}}}{tag}', {k.replace('_','-'):str(v) for k,v in attrs.items()})
        if text is not None: n.text = str(text)
        return n
    for first in range(0,count,per_page):
        rows = math.ceil(min(per_page,count-first)/per_row)
        height = 145+rows*130
        root = ET.Element(f'{{{SVG}}}svg', {'viewBox':f'0 0 840 {height}', 'width':'840', 'height':str(height)})
        add(root,'rect',x=0,y=0,width=840,height=height,fill='white')
        add(root,'text','Baixo — Tablatura (TAB)',x=30,y=36,font_family='Helvetica',font_size=22,fill='black')
        add(root,'text',f'{bpm:g} BPM · {beats}/4 · {strings} cordas · afinação {"B–E–A–D–G" if strings == 5 else "E–A–D–G"} · início {offset:g} s',x=30,y=65,font_family='Helvetica',font_size=13,fill='black')
        add(root,'text','Rascunho automático. Números = trastes; tracejado = tempos; linhas leves após o número = duração.',x=30,y=88,font_family='Helvetica',font_size=12,fill='black')
        for index in range(first,min(first+per_page,count)):
            row,col = divmod(index-first,per_row)
            x,y = 55+col*(750/per_row), 140+row*130
            width = 750/per_row
            group = add(root,'g',id=f'tab-m{index+1}',**{'class':'measure'})
            measures.append(dict(number=index+1,start=round(offset+index*beats*60/bpm,5),id=f'tab-m{index+1}',page=len(pages)+1))
            add(group,'text',str(index+1),x=x+4,y=y-20,font_family='Helvetica',font_size=12,fill='#444')
            for string,label in enumerate(['G','D','A','E'] + (['B'] if strings == 5 else []),1):
                sy = y+(string-1)*16
                add(group,'line',x1=x,y1=sy,x2=x+width,y2=sy,stroke='black',stroke_width=.8)
                if col == 0:
                    add(group,'text',label,x=x-23,y=sy+4,font_family='Helvetica',font_size=12,fill='black')
            for edge in [x,x+width]:
                add(group,'line',x1=edge,y1=y,x2=edge,y2=y+(strings-1)*16,stroke='black',stroke_width=1)
            for beat in range(beats):
                bx=x+12+beat*(width-24)/beats
                add(group,'line',x1=bx,y1=y-5,x2=bx,y2=y+(strings-1)*16+5,stroke='#bbb',stroke_width=.5,stroke_dasharray='2 3')
            start,end = index*beats*4,(index+1)*beats*4
            for tick,stop,string,fret in notes:
                if stop <= start or tick >= end: continue
                at=max(start,tick)
                nx=x+12+(at-start)/(beats*4)*(width-24)
                sy=y+(string-1)*16
                finish=x+12+(min(stop,end)-start)/(beats*4)*(width-24)
                add(group,'line',x1=nx+6,y1=sy-5,x2=max(nx+6,finish-2),y2=sy-5,stroke='#888',stroke_width=1)
                text=str(fret) if tick >= start else '~'
                add(group,'rect',x=nx-7,y=sy-9,width=16,height=17,fill='white')
                add(group,'text',text,x=nx,y=sy+5,font_family='Helvetica',font_size=14,font_weight='bold',text_anchor='middle',fill='black',**{'class':'note'})
        pages.append(ET.tostring(root,encoding='unicode'))
    return pages,measures


def quantize_events(events, *, bpm, offset):
    """Shared grid and stable collisions for notation, TAB and MIDI."""
    result = {}
    for event in events:
        if event['end'] <= offset:
            continue
        tick = max(0, round((event['start']-offset)*bpm/60*4))
        end = max(tick+1, round((event['end']-offset)*bpm/60*4))
        result.setdefault(tick, []).append((event, end))
    return result


def timeline_events(events, *, bpm, offset, stem, strings):
    grouped = quantize_events(events, bpm=bpm, offset=offset)
    ticks = sorted(grouped)
    result = []
    for index, tick in enumerate(ticks):
        group = grouped[tick]
        selected = [max(group,key=lambda pair:pair[1])] if stem == 'bass' else group
        for event, end in selected:
            if index+1 < len(ticks) and stem == 'bass': end = min(end,ticks[index+1])
            item = dict(start=offset+tick/4*60/bpm, end=offset+end/4*60/bpm,
                        pitch=event['pitch'], beats=(end-tick)/4)
            if stem == 'bass':
                try: item['string'],item['fret']=bass_fingering(event['pitch'],strings)
                except ValueError: pass
            result.append(item)
    return result
