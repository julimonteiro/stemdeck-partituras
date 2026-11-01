import { showTimeline, clearTimeline, timelineMode } from './scoreTimeline.js';
import { currentJobId, bpmChip, audioEngine, multitrack, waveZoom } from './state.js';

let activePanel = null;
const recentScores = new Map();
let bassStrings=5;
function rememberScore(jobId,stem,value){recentScores.set(`${jobId}:${stem}:${value.notation}`,value);if(recentScores.size>12)recentScores.delete(recentScores.keys().next().value);}

function ensureScoreStyles(){
  if (!document.getElementById('sd-score-css')) {
    const css = element('link', null, document.head);
    css.id = 'sd-score-css'; css.rel = 'stylesheet'; css.href = '/css/scores.css';
  }
}

export function makeScoreButton(stem) {
  if (!['bass', 'drums'].includes(stem)) return null;
  ensureScoreStyles();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sd-score-button';
  button.textContent = 'Partitura';
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 16 16');icon.setAttribute('aria-hidden','true');
  const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','M6 11V3l7-1v8M6 5l7-1M6 11c0 1-1 2-2.5 2S1 12 1 11s1-2 2.5-2S6 10 6 11Zm7-1c0 1-1 2-2.5 2S8 11 8 10s1-2 2.5-2S13 9 13 10Z');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.2');icon.append(path);button.prepend(icon);
  button.title = `Gerar partitura de ${stem === 'bass' ? 'baixo' : 'bateria'} (rascunho editável)`;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    openScore(currentJobId, stem, button);
  });
  const wrap=document.createElement('div');
  wrap.className='sd-score-tools';wrap.append(button);
  wrap.addEventListener('keydown',event=>event.stopPropagation());
  const view=document.createElement('select');
  view.className='sd-score-view';view.hidden=true;view.tabIndex=-1;view.setAttribute('aria-hidden','true');view.setAttribute('aria-label',`Visualização de ${stem==='bass'?'baixo':'bateria'}`);
  for(const [value,label] of [['audio','Áudio'],['standard','Partitura'],...(stem==='bass'?[['tab','TAB']]:[])]){
    const option=document.createElement('option');option.value=value;option.textContent=label;view.append(option);
  }
  view.value=timelineMode(stem);
  view.addEventListener('change',()=>{
    const desired=view.value;
    activePanel?.();
    view.value=desired;
    if(view.value==='audio'){clearTimeline(stem);return;}
    const cached=recentScores.get(`${currentJobId}:${stem}:${view.value}`);
    if(cached)showTimeline(currentJobId,stem,cached);
    else openScore(currentJobId,stem,button,view.value,true);
  });
  const segments=document.createElement('div');segments.className='sd-view-segments';segments.setAttribute('role','group');segments.setAttribute('aria-label','Visão da faixa');
  for(const option of view.options){const item=document.createElement('button');item.type='button';item.textContent=option.value==='standard'?'Pauta':option.textContent;item.dataset.mode=option.value;item.setAttribute('aria-pressed',String(view.value===option.value));item.addEventListener('click',()=>{view.value=option.value;view.dispatchEvent(new Event('change'));});segments.append(item);}
  const zoom=document.createElement('div');zoom.className='sd-note-zoom';zoom.setAttribute('role','group');zoom.setAttribute('aria-label','Espaçamento da notação');
  for(const [label,factor,title]of [['−',1/1.35,'Aproximar notas'],['+',1.35,'Afastar notas']]){const control=document.createElement('button');control.type='button';control.textContent=label;control.title=title;control.setAttribute('aria-label',title);control.addEventListener('click',async()=>{const {setWaveZoomLevel}=await import('./transport.js');setWaveZoomLevel(waveZoom*factor);});zoom.append(control);}
  const refreshSegments=()=>{for(const item of segments.children)item.setAttribute('aria-pressed',String(item.dataset.mode===view.value));zoom.hidden=view.value==='audio';};
  view.addEventListener('change',refreshSegments);
  const refresh=()=>{if(!view.isConnected){document.removeEventListener('sd-score-timeline-changed',refresh);return;}view.value=timelineMode(stem);refreshSegments();};
  document.addEventListener('sd-score-timeline-changed',refresh);
  wrap.append(view,zoom,segments);refreshSegments();
  return wrap;
}

function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  parent?.append(node);
  return node;
}

function openScore(jobId, stem, trigger, requestedNotation=null, autoTimeline=false) {
  if (!jobId) return;
  activePanel?.();
  ensureScoreStyles();
  const panel = element('section', null, document.body);
  panel.className = 'sd-score-panel';
  panel.setAttribute('aria-label', 'Partitura');
  const footer=document.querySelector('.daw-footer');
  const fitDock=()=>{if(footer)panel.style.bottom=`${Math.max(0,window.innerHeight-footer.getBoundingClientRect().top)}px`;};
  const dockObserver=new ResizeObserver(fitDock);if(footer)dockObserver.observe(footer);fitDock();
  element('div','ESTÚDIO / NOTAÇÃO',panel).className='sd-score-eyebrow';
  const header = element('header', null, panel);
  const heading = element('h2', `Partitura · ${stem === 'bass' ? 'Baixo' : 'Bateria'}`, header);
  heading.tabIndex = -1;
  const close = element('button', 'Fechar ×', header);
  close.className='sd-score-close';
  close.type = 'button';
  element('p', stem === 'bass'
    ? 'Transforme a faixa de baixo em uma partitura ou tablatura para acompanhar e estudar.'
    : 'Notação experimental de bumbo, caixa e chimbal. Revise a transcrição antes de usar.', panel);
  const form = element('form', null, panel);
  function input(label, value, min, max, step) {
    const wrapper = element('label', label, form);
    const field = element('input', null, wrapper);
    Object.assign(field, { type: 'number', value: String(value), min: String(min), max: String(max), step: String(step), required: true });
    return field;
  }
  const detectedBpm = Number(bpmChip?.textContent.match(/\d+(?:\.\d+)?/)?.[0]);
  const bpm = input('Andamento (BPM)', detectedBpm >= 30 && detectedBpm <= 300 ? detectedBpm : 120, 30, 300, .1);
  const beats = input('Tempos por compasso (/4)', 4, 1, 12, 1);
  const offset = input('Primeiro tempo (segundos)', 0, 0, 60, .01);
  const formatLabel = element('label', 'Formato', form);
  const notation = element('select', null, formatLabel);
  notation.setAttribute('aria-label', 'Formato');
  element('option', 'Partitura tradicional', notation).value = 'standard';
  if (stem === 'bass') element('option', 'Tablatura (TAB)', notation).value = 'tab';
  if(requestedNotation)notation.value=requestedNotation;
  const stringsLabel=element('label','Cordas do baixo',form);
  const strings=element('select',null,stringsLabel);strings.setAttribute('aria-label','Cordas do baixo');
  element('option','4 cordas · E–A–D–G',strings).value='4';
  element('option','5 cordas · B–E–A–D–G',strings).value='5';
  strings.value=String(bassStrings);
  strings.addEventListener('change',()=>{bassStrings=Number(strings.value);});
  if(stem!=='bass')stringsLabel.hidden=true;
  if (stem !== 'bass') formatLabel.hidden = true;
  const advanced=element('details',null,form);advanced.className='sd-score-advanced';
  element('summary','Ajustes de transcrição',advanced);
  const advancedGrid=element('div',null,advanced);advancedGrid.className='sd-score-advanced-grid';
  advancedGrid.append(bpm.parentElement,beats.parentElement,offset.parentElement);
  const generate = element('button', 'Gerar partitura', form);
  generate.className='sd-score-generate';
  generate.type = 'submit';
  element('small','Grade de semicolcheias · até 15 minutos. A transcrição automática pode precisar de correções.',advanced);
  const status = element('p', 'Escolha o formato para começar.', panel);
  status.className='sd-score-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const progress = element('progress', null, panel);
  progress.max = 100; progress.value = 0; progress.hidden = true;
  progress.setAttribute('aria-label', 'Progresso da transcrição');
  const exports = element('nav', null, panel);
  exports.setAttribute('aria-label', 'Baixar partitura');
  const timelineButton=element('button','Ver na timeline',panel);timelineButton.type='button';timelineButton.hidden=true;timelineButton.className='sd-score-open-timeline';
  timelineButton.addEventListener('click',()=>{if(result){showTimeline(jobId,stem,result);destroy();}});
  const position = element('div', null, panel);
  const navigation = element('div', null, panel);
  navigation.className = 'sd-score-measures';
  navigation.setAttribute('aria-label', 'Ir para compasso');
  const pages = element('div', null, panel);
  pages.className = 'sd-score-pages';
  let closed = false, requestNumber = 0, timer, syncTimer, aborter;
  let result = null, highlighted = null;
  function destroy() {
    closed = true;
    clearTimeout(timer); clearInterval(syncTimer); aborter?.abort();
    dockObserver.disconnect();
    panel.remove();
    document.dispatchEvent(new Event("sd-score-timeline-changed"));
    if (activePanel === destroy) activePanel = null;
    if (trigger.isConnected) trigger.focus();
  }
  activePanel = destroy;
  close.addEventListener('click', destroy);
  panel.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.stopPropagation(); destroy(); } });
  heading.focus();
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, signal: aborter.signal });
    const value = await response.json();
    if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : 'Não foi possível gerar a partitura. Confira os valores e tente novamente.');
    return value;
  }
  function highlight() {
    if (jobId !== currentJobId) { destroy(); return; }
    if (!result) return;
    const time = (audioEngine || multitrack)?.getCurrentTime?.() || 0;
    const measure = result.measures.findLast(m => m.start <= time);
    position.textContent = measure ? `Compasso ${measure.number} · ${time.toFixed(1)} s` : 'Antes do primeiro compasso';
    const previous = navigation.querySelector('[aria-current]');
    if (previous) previous.removeAttribute('aria-current');
    navigation.children[measure?.number - 1]?.setAttribute('aria-current', 'true');
    if (highlighted === measure?.id) return;
    highlighted = measure?.id;
    pages.querySelectorAll('.sd-current').forEach(node => node.classList.remove('sd-current'));
    if (highlighted) pages.querySelector(`#${CSS.escape(highlighted)}`)?.classList.add('sd-current');
  }
  function showResult(value, base) {
    result = value;
    timelineButton.hidden=false;
    rememberScore(jobId,stem,value);
    exports.replaceChildren(); pages.replaceChildren(); navigation.replaceChildren();
    for (const [label, filename] of [['PDF', 'score.pdf'], ['MusicXML · editar', 'score.musicxml'], ['MIDI', 'score.mid']]) {
      const a = element('a', label, exports);
      a.href = `${base}/file/${filename}`; a.download = `${stem}-${filename}`;
      a.addEventListener('click', async (event) => {
        const invoke = window.__TAURI__?.core?.invoke;
        if (!invoke) return;
        event.preventDefault(); event.stopPropagation();
        try {
          const token = await invoke('pick_export_destination', { filename: a.download });
          if (!token) return;
          status.textContent = 'Salvando arquivo…';
          await invoke('download_to_path', { token, url: a.href });
          status.textContent = 'Arquivo salvo.';
        } catch (error) { status.textContent = `Falha ao salvar: ${String(error)}`; }
      });
    }
    for (const measure of result.measures) {
      const button = element('button', String(measure.number), navigation);
      button.type = 'button'; button.title = `Ir para compasso ${measure.number}`;
      button.addEventListener('click', async () => {
        const { setPlayheadTime } = await import('./transport.js');
        if (currentJobId !== jobId || closed) return;
        setPlayheadTime(measure.start);
        pages.querySelector(`[data-page="${measure.page}"]`)?.scrollIntoView({ block: 'nearest' });
      });
    }
    const renderingResult = result;
    for (let page = 1; page <= result.pages; page++) {
      const holder = element('div', 'Carregando página…', pages);
      holder.dataset.page = String(page);
      // Inline SVG works under the desktop's object-src 'none' policy. Only
      // notation from our generated endpoint is loaded, with active content removed.
      fetch(`${base}/file/page-${page}.svg`, {signal: aborter.signal})
        .then(response => { if (!response.ok) throw new Error('Página indisponível'); return response.text(); })
        .then(text => {
          if (closed || result !== renderingResult) return;
          const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
          const svg = doc.documentElement;
          if (svg.localName !== 'svg') throw new Error('Partitura inválida');
          svg.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(node => node.remove());
          for (const node of [svg, ...svg.querySelectorAll('*')]) {
            for (const attr of [...node.attributes]) {
              if (/^on/i.test(attr.name) || (attr.localName === 'href' && !attr.value.startsWith('#'))) node.removeAttributeNode(attr);
            }
          }
          if (!svg.getAttribute('viewBox')) {
            svg.setAttribute('viewBox', `0 0 ${parseFloat(svg.getAttribute('width'))} ${parseFloat(svg.getAttribute('height'))}`);
          }
          const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
          style.textContent = '.sd-current .note,.sd-current .rest{fill:#bc4e00!important;stroke:#bc4e00!important}';
          svg.append(style);
          svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Partitura, página ${page}`);
          holder.replaceChildren(document.importNode(svg, true));
          highlighted = null; highlight();
        }).catch(error => {
          if (!closed && error.name !== 'AbortError' && result === renderingResult) holder.textContent = `Falha ao carregar página: ${error.message}`;
        });
    }
    highlight();
  }
  async function follow(value, base, sequence) {
    if (closed || sequence !== requestNumber) return;
    status.textContent = value.message;
    progress.value = value.progress;
    if (value.status === 'done') {
      progress.hidden = true; generate.disabled = false;
      if(autoTimeline){rememberScore(jobId,stem,value.result);showTimeline(jobId,stem,value.result);destroy();}
      else showResult(value.result, base);
    } else if (value.status === 'error') {
      progress.hidden = true; generate.disabled = false;
      status.textContent = `Falha: ${value.message} Você pode tentar novamente.`;
    } else {
      timer = setTimeout(async () => {
        try { await follow(await request(base), base, sequence); }
        catch (error) { fail(error, sequence); }
      }, 1500);
    }
  }
  function fail(error, sequence) {
    if (closed || sequence !== requestNumber || error.name === 'AbortError') return;
    status.textContent = `Falha: ${error.message}`;
    progress.hidden = true; generate.disabled = false;
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    clearTimeout(timer); aborter?.abort(); aborter = new AbortController();
    const sequence = ++requestNumber;
    result = null; timelineButton.hidden=true; exports.replaceChildren(); pages.replaceChildren(); navigation.replaceChildren(); position.textContent = '';
    generate.disabled = true; progress.hidden = false; progress.value = 0;
    status.textContent = 'Enviando para transcrição…';
    const base = `/api/jobs/${encodeURIComponent(jobId)}/scores/${stem}`;
    try {
      const value = await request(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strings:Number(strings.value), notation: notation.value, bpm: Number(bpm.value), beats: Number(beats.value), offset: Number(offset.value) }) });
      await follow(value, `${base}/${value.token}`, sequence);
    } catch (error) { fail(error, sequence); }
  });
  syncTimer = setInterval(highlight, 250);
}
