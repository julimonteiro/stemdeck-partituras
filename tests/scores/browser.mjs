import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { openStudio } from '../e2e/helpers.mjs';
const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
try {
  const context = await browser.newContext({baseURL:process.env.SCORE_TEST_URL || 'http://127.0.0.1:8124', viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("console", msg=>console.log("browser:",msg.text().slice(0,200)));
  const errors=[];
  page.on('pageerror', e => errors.push(e.message));
  await openStudio(page); console.log("studio ready");
  const button = page.locator('.lane-header[data-stem="bass"] .sd-score-button');
  await button.click(); console.log("panel open");
  await page.getByLabel('Precisão da transcrição',{exact:true}).selectOption('classic');
  await page.locator('.sd-score-advanced summary').click();
  await page.getByLabel('Andamento (BPM)').fill('120');
  await page.getByRole('button',{name:'Gerar partitura',exact:true}).click();
  await page.locator('.sd-score-panel nav a').first().waitFor({timeout:60000});
  assert.equal(await page.locator('.sd-score-panel nav a').count(),3); console.log('exports ready'); await page.screenshot({path:'/tmp/stemdeck-score-ui.png'});
  await page.waitForFunction(() => document.querySelector('.sd-score-pages svg'),null,{timeout:15000}); console.log('svg ready');
  const svg = await page.locator('.sd-score-pages > div > svg').evaluate(o=>({height:o.clientHeight,viewBox:o.getAttribute('viewBox')}));
  assert(svg.height>40);
  await page.locator('.sd-score-measures button').nth(1).click();
  await page.waitForFunction(() => document.querySelector('.sd-score-panel').textContent.includes('Compasso 2'));
  await page.screenshot({path:'/tmp/stemdeck-score-ui.png'});
  // The bass can switch from staff notation to a real four-string TAB.
  await page.getByLabel('Formato', {exact:true}).selectOption('tab');
  await page.getByRole('button',{name:'Gerar partitura',exact:true}).click();
  await page.locator('.sd-score-panel nav a').first().waitFor({timeout:60000});
  await page.waitForFunction(()=>document.querySelector('.sd-score-pages svg')?.textContent.includes('Tablatura (TAB)'));
  assert((await page.locator('.sd-score-pages').textContent()).includes('Números = trastes'));
  await page.screenshot({path:'/tmp/stemdeck-score-tab-ui.png'});
  await page.getByRole('button',{name:'Tela cheia',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.sd-score-panel').getBoundingClientRect().width>=window.innerWidth-2);
  await page.screenshot({path:'/tmp/stemdeck-fullscreen-ui.png'});
  await page.getByRole('button',{name:'Reproduzir',exact:true}).click();
  await page.getByRole('button',{name:'Pausar',exact:true}).waitFor();
  await page.getByRole('button',{name:'Pausar',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('.sd-score-panel').classList.contains('sd-score-fullscreen'));
  assert.equal(await page.locator('.sd-score-panel').count(),1);
  assert.equal(await page.locator('.sd-score-panel nav a').count(),3);
  console.log('PASS: full-screen score, playback controls, Escape restores inspector without losing score');
  // Desktop exports must use the native save bridge, not a WebView navigation.
  await page.evaluate(() => {
    window.scoreSaveCalls=[];
    window.__TAURI__={core:{invoke: async(cmd,args)=>{window.scoreSaveCalls.push({cmd,args});return cmd==='pick_export_destination'?'save-token':null;}}};
  });
  await page.locator('.sd-score-panel nav a').first().click();
  await page.waitForFunction(()=>window.scoreSaveCalls.length===2);
  const calls=await page.evaluate(()=>window.scoreSaveCalls);
  assert.equal(calls[1].cmd,'download_to_path');
  assert(calls[1].args.url.includes('/scores/bass/'));
  // Space should activate the panel's button, without triggering the transport shortcut.
  const close=page.getByRole('button',{name:'Fechar ×'});
  await close.focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('.sd-score-panel').count(),0);
  // Switch the bass waveform to five-string TAB, then staff, then back to audio.
  await page.locator('.lane-header[data-stem="bass"] .sd-view-segments [data-mode="tab"]').click();
  await page.locator('.sd-timeline-overlay[data-stem="bass"] .sd-timeline-note').first().waitFor();
  assert.equal(await page.locator('.sd-score-panel').count(),0);
  await page.evaluate(async()=>{const {setPlayheadTime}=await import('/js/transport.js');setPlayheadTime(.5);});
  await page.waitForFunction(()=>document.querySelector('.sd-timeline-note.sd-playing'));
  await page.waitForFunction(()=>Math.abs(document.querySelector('.sd-timeline-cursor')?.x1.baseVal.value-document.querySelector('.waves-column').clientWidth/12)<1);
  const before=await page.locator('.sd-timeline-cursor').getAttribute('x1');
  await page.evaluate(async()=>{const {setPlayheadTime}=await import('/js/transport.js');setPlayheadTime(2);});
  await page.waitForFunction(before=>document.querySelector('.sd-timeline-cursor')?.getAttribute('x1')!==before,before);
  await page.screenshot({path:'/tmp/stemdeck-timeline-ui.png'});
  await page.locator('.lane-header[data-stem="bass"] .sd-view-segments [data-mode="standard"]').click();
  await page.waitForFunction(()=>document.querySelector('.sd-timeline-overlay ellipse'));
  await page.locator('.lane-header[data-stem="bass"] .sd-view-segments [data-mode="audio"]').click();
  await page.waitForFunction(()=>!document.querySelector('.sd-timeline-overlay'));
  // A completed background request must not override a newer Audio choice.
  let completed=false;
  await page.route('**/api/jobs/e2e0deadbeef/scores/drums**',async route=>{
    const value={token:'pending-test',status:completed?'done':'running',progress:25,message:'Teste pendente',result:{pages:0,measures:[],timeline:[],duration:6,notation:'standard',stem:'drums',strings:5}};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await page.locator('.lane-header[data-stem="drums"] .sd-view-segments [data-mode="standard"]').click();
  await page.getByRole('button',{name:'Gerar partitura',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Teste pendente'}).waitFor();
  await page.locator('.lane-header[data-stem="drums"] .sd-view-segments [data-mode="audio"]').click();
  assert.equal(await page.locator('.sd-score-panel').count(),0);
  completed=true;
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('.sd-timeline-overlay').count(),0);
  console.log('PASS: timeline TAB/staff/audio toggle, active note, moving cursor, five-string selector, newer mode wins');
  await page.setViewportSize({width:1280,height:720});
  await page.waitForTimeout(300);
  const spacing=await page.locator('.lane-header[data-stem="bass"]').evaluate(row=>({meter:row.querySelector('.lane-vu').getBoundingClientRect().bottom,tools:row.querySelector('.sd-score-tools').getBoundingClientRect().top}));
  console.log('compact spacing',spacing);
  await page.screenshot({path:'/tmp/stemdeck-native-compact.png'});
  assert(spacing.meter<=spacing.tools,'Notation controls must not overlap the level meter');
  await page.screenshot({path:'/tmp/stemdeck-native-compact.png'});
  assert.deepEqual(errors,[]);
  await page.evaluate(async()=>{
    const state=await import('/js/state.js');state.setTotalDuration(180);
    const {showTimeline}=await import('/js/scoreTimeline.js');
    await showTimeline('e2e0deadbeef','bass',{duration:180,notation:'standard',stem:'bass',strings:5,bpm:120,beats:4,measures:[],timeline:Array.from({length:16},(_,i)=>({start:.5+i*.125,end:.625+i*.125,pitch:40,beats:.25}))});
  });
  await page.waitForFunction(()=>document.querySelector('.waves-column').clientWidth>10000);
  const gap=await page.locator('.sd-timeline-note ellipse').evaluateAll(notes=>Number(notes[1].getAttribute('cx'))-Number(notes[0].getAttribute('cx')));
  assert(gap>=39.5,'Dense long scores need readable spacing beyond waveform zoom limit');
  const width=await page.locator('.waves-column').evaluate(e=>e.clientWidth);
  await page.locator('.lane-header[data-stem="bass"]').getByRole('button',{name:'Afastar notas',exact:true}).click();
  await page.waitForFunction(width=>document.querySelector('.waves-column').clientWidth>width,width);
  await page.evaluate(async()=>{const {setPlayheadTime}=await import('/js/transport.js');setPlayheadTime(1);document.getElementById('wave-scroll').scrollLeft=200;});
  await page.waitForTimeout(100);
  const alignment=await page.evaluate(()=>{const r=document.querySelector('#ruler-time .playhead-marker').getBoundingClientRect();const y=document.querySelector('.sd-timeline-cursor').getBoundingClientRect();const ruler=document.querySelector('#ruler-time').getBoundingClientRect();const col=document.querySelector('.waves-column').getBoundingClientRect();return {red:r.left+r.width/2,yellow:y.left,rulerWidth:ruler.width,columnWidth:col.width,rulerLeft:ruler.left,columnLeft:col.left,svg:document.querySelector('.sd-timeline-overlay svg').getAttribute('viewBox'),cursor:document.querySelector('.sd-timeline-cursor').getAttribute('x1'),overlay:document.querySelector('.sd-timeline-overlay').getBoundingClientRect().width,svgWidth:document.querySelector('.sd-timeline-overlay svg').getBoundingClientRect().width};});
  console.log('cursor alignment',alignment);
  assert(Math.abs(alignment.red-alignment.yellow)<2,'Audio and notation cursors must coincide with zoom and scroll');
  for(const zoom of [12,32,96]){
    await page.evaluate(async zoom=>{const t=await import('/js/transport.js');t.setWaveZoomLevel(zoom);t.setPlayheadTime(1.5);document.getElementById('wave-scroll').scrollLeft=300;},zoom);
    await page.waitForTimeout(100);
    const geometry=await page.evaluate(()=>{const r=document.querySelector('#ruler-time .playhead-marker').getBoundingClientRect();const y=document.querySelector('.sd-timeline-cursor');return {offset:Math.abs(r.left+r.width/2-y.getBoundingClientRect().left),red:r.left+r.width/2,yellow:y.getBoundingClientRect().left,ruler:document.querySelector('#ruler-time').getBoundingClientRect().left,column:document.querySelector('.waves-column').getBoundingClientRect().left,scroll:document.querySelector('#wave-scroll').scrollLeft,percent:y.getAttribute('x1'),box:y.ownerSVGElement.getAttribute('viewBox')};});console.log('zoom geometry',zoom,geometry);const offset=geometry.offset;
    assert(offset<2,`Cursor alignment at ${zoom}x: ${offset}px`);
  }
  console.log('PASS: shared playhead alignment at 12x, 32x and 96x with horizontal scroll');
  await page.evaluate(async()=>{const state=await import('/js/state.js');state.setTotalDuration(6);const {clearTimeline}=await import('/js/scoreTimeline.js');clearTimeline('bass');});
  console.log('PASS: dense 3-minute score spacing, zoom beyond 10x, manual spacing control');
  console.log('PASS: mixer button, real transcription, SVG, 3 exports, measure seek, desktop save bridge, Space close, no JS errors');
} finally {await browser.close();}
