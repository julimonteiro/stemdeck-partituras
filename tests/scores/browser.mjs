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
  assert.deepEqual(errors,[]);
  console.log('PASS: mixer button, real transcription, SVG, 3 exports, measure seek, desktop save bridge, Space close, no JS errors');
} finally {await browser.close();}
