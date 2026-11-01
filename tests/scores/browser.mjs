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
  await page.getByLabel('Andamento (BPM)').fill('120');
  await page.getByRole('button',{name:'Gerar partitura',exact:true}).click();
  await page.locator('.sd-score-panel nav a').first().waitFor({timeout:60000});
  assert.equal(await page.locator('.sd-score-panel nav a').count(),3); console.log('exports ready'); await page.screenshot({path:'/tmp/stemdeck-score-ui.png'});
  await page.waitForFunction(() => document.querySelector('.sd-score-pages svg'),null,{timeout:15000}); console.log('svg ready');
  const svg = await page.locator('.sd-score-pages > div > svg').evaluate(o=>({height:o.clientHeight,viewBox:o.getAttribute('viewBox')}));
  assert(svg.height>100);
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
  await page.getByLabel('Visualização de baixo',{exact:true}).selectOption('tab');
  await page.locator('.sd-timeline-overlay[data-stem="bass"] .sd-timeline-note').first().waitFor();
  assert.equal(await page.locator('.sd-score-panel').count(),0);
  await page.evaluate(async()=>{const {setPlayheadTime}=await import('/js/transport.js');setPlayheadTime(.5);});
  await page.waitForFunction(()=>document.querySelector('.sd-timeline-note.sd-playing'));
  await page.waitForFunction(()=>Math.abs(Number(document.querySelector('.sd-timeline-cursor')?.getAttribute('x1'))-document.querySelector('.waves-column').clientWidth/12)<1);
  const before=await page.locator('.sd-timeline-cursor').getAttribute('x1');
  await page.evaluate(async()=>{const {setPlayheadTime}=await import('/js/transport.js');setPlayheadTime(2);});
  await page.waitForFunction(before=>document.querySelector('.sd-timeline-cursor')?.getAttribute('x1')!==before,before);
  await page.screenshot({path:'/tmp/stemdeck-timeline-ui.png'});
  await page.getByLabel('Visualização de baixo',{exact:true}).selectOption('standard');
  await page.waitForFunction(()=>document.querySelector('.sd-timeline-overlay ellipse'));
  await page.getByLabel('Visualização de baixo',{exact:true}).selectOption('audio');
  await page.waitForFunction(()=>!document.querySelector('.sd-timeline-overlay'));
  // A completed background request must not override a newer Audio choice.
  let completed=false;
  await page.route('**/api/jobs/e2e0deadbeef/scores/drums**',async route=>{
    const value={token:'pending-test',status:completed?'done':'running',progress:25,message:'Teste pendente',result:{pages:0,measures:[],timeline:[],duration:6,notation:'standard',stem:'drums',strings:5}};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await page.getByLabel('Visualização de bateria',{exact:true}).selectOption('standard');
  await page.getByRole('button',{name:'Gerar partitura',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Teste pendente'}).waitFor();
  await page.getByLabel('Visualização de bateria',{exact:true}).selectOption('audio');
  assert.equal(await page.locator('.sd-score-panel').count(),0);
  completed=true;
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('.sd-timeline-overlay').count(),0);
  console.log('PASS: timeline TAB/staff/audio toggle, active note, moving cursor, five-string selector, newer mode wins');
  assert.deepEqual(errors,[]);
  console.log('PASS: mixer button, real transcription, SVG, 3 exports, measure seek, desktop save bridge, Space close, no JS errors');
} finally {await browser.close();}
