import { currentJobId, bpmChip, audioEngine, multitrack } from './state.js';

let activePanel = null;

export function makeScoreButton(stem) {
  if (!['bass', 'drums'].includes(stem)) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sd-score-button';
  button.textContent = '♫ Partitura';
  button.title = `Gerar partitura de ${stem === 'bass' ? 'baixo' : 'bateria'} (rascunho editável)`;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    openScore(currentJobId, stem, button);
  });
  return button;
}

function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  parent?.append(node);
  return node;
}

function openScore(jobId, stem, trigger) {
  if (!jobId) return;
  activePanel?.();
  if (!document.getElementById('sd-score-css')) {
    const css = element('link', null, document.head);
    css.id = 'sd-score-css'; css.rel = 'stylesheet'; css.href = '/css/scores.css';
  }
  const panel = element('section', null, document.body);
  panel.className = 'sd-score-panel';
  panel.setAttribute('aria-label', 'Partitura');
  const header = element('header', null, panel);
  const heading = element('h2', `Partitura · ${stem === 'bass' ? 'Baixo' : 'Bateria'}`, header);
  heading.tabIndex = -1;
  const close = element('button', 'Fechar ×', header);
  close.type = 'button';
  element('p', stem === 'bass'
    ? 'Rascunho automático em afinação original. Revise notas, ritmo e compasso no MuseScore.'
    : 'Experimental: estima bumbo, caixa e chimbal por faixas de frequência. Pode confundir peças e omitir viradas; revise no MuseScore.', panel);
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
  const generate = element('button', 'Gerar partitura', form);
  generate.type = 'submit';
  element('small', 'Grade de semicolcheias. Ajuste BPM, compasso e início se o ritmo não alinhar. Limite: 15 minutos.', panel);
  const status = element('p', 'Escolha o andamento e clique em Gerar partitura.', panel);
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const progress = element('progress', null, panel);
  progress.max = 100; progress.value = 0; progress.hidden = true;
  progress.setAttribute('aria-label', 'Progresso da transcrição');
  const exports = element('nav', null, panel);
  exports.setAttribute('aria-label', 'Baixar partitura');
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
    panel.remove();
    if (activePanel === destroy) activePanel = null;
    if (trigger.isConnected) trigger.focus();
  }
  activePanel = destroy;
  close.addEventListener('click', destroy);
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); destroy(); } });
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
    for (const obj of pages.querySelectorAll('object')) {
      const doc = obj.contentDocument;
      doc?.querySelectorAll('.sd-current').forEach(node => node.classList.remove('sd-current'));
      doc?.getElementById(highlighted)?.classList.add('sd-current');
    }
  }
  function showResult(value, base) {
    result = value;
    exports.replaceChildren(); pages.replaceChildren(); navigation.replaceChildren();
    for (const [label, filename] of [['PDF', 'score.pdf'], ['MusicXML · editar', 'score.musicxml'], ['MIDI', 'score.mid']]) {
      const a = element('a', label, exports);
      a.href = `${base}/file/${filename}`; a.download = `${stem}-${filename}`;
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
    for (let page = 1; page <= result.pages; page++) {
      const obj = element('object', null, pages);
      obj.type = 'image/svg+xml'; obj.data = `${base}/file/page-${page}.svg`;
      obj.dataset.page = String(page);
      obj.setAttribute('aria-label', `Partitura, página ${page}`);
      obj.addEventListener('load', () => {
        const doc = obj.contentDocument;
        if (!doc?.documentElement) return;
        const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.textContent = '.sd-current .note,.sd-current .rest{fill:#bc4e00!important;stroke:#bc4e00!important}';
        doc.documentElement.append(style);
        const svg = doc.documentElement;
        const box = svg.getAttribute('viewBox')?.split(/\s+/).map(Number);
        if (box?.length === 4) obj.style.aspectRatio = `${box[2]} / ${box[3]}`;
        obj.style.height = 'auto';
        highlighted = null; highlight();
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
      showResult(value.result, base);
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
    result = null; exports.replaceChildren(); pages.replaceChildren(); navigation.replaceChildren(); position.textContent = '';
    generate.disabled = true; progress.hidden = false; progress.value = 0;
    status.textContent = 'Enviando para transcrição…';
    const base = `/api/jobs/${encodeURIComponent(jobId)}/scores/${stem}`;
    try {
      const value = await request(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bpm: Number(bpm.value), beats: Number(beats.value), offset: Number(offset.value) }) });
      await follow(value, `${base}/${value.token}`, sequence);
    } catch (error) { fail(error, sequence); }
  });
  syncTimer = setInterval(highlight, 250);
}
