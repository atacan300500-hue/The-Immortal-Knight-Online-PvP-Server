// Hikâye modu regresyonu: PvP menüsüne gidip dönmek ve normal sefer başlatmak hata vermemeli.
const { chromium } = require('playwright');
const HTML = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const p = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + HTML);
  await p.waitForFunction(() => typeof PV === 'object');
  await p.click('#intro'); await sleep(300); await p.click('#intro');
  await p.waitForFunction(() => getComputedStyle(document.getElementById('intro')).display === 'none', null, { timeout: 5000 });
  const menuHasStory = await p.evaluate(() => !!document.querySelector('[data-a="sel"]'));
  console.log((menuHasStory ? 'PASS' : 'FAIL') + ' ana menüde SEFERE BAŞLA var');
  // PvP menüsüne git ve geri dön
  await p.click('[data-a="pvp"]'); await sleep(200);
  console.log((await p.evaluate(() => /ÇEVRİMİÇİ PvP/.test(document.body.innerText)) ? 'PASS' : 'FAIL') + ' PvP menüsü açılır');
  await p.click('[data-a="menu"]'); await sleep(200);
  console.log((await p.evaluate(() => !!document.querySelector('[data-a="sel"]')) ? 'PASS' : 'FAIL') + ' PvP menüsünden ana menüye dönülür');
  // Hikâye: normal sefer başlat, birkaç saniye oyna
  await p.evaluate(() => startRun(1));
  await sleep(3000);
  const st = await p.evaluate(() => ({ state, ch: run && run.ch, cine: !!cine }));
  console.log((['play', 'cine'].includes(st.state) ? 'PASS' : 'FAIL') + ' hikâye seferi başladı: ' + JSON.stringify(st));
  await p.keyboard.down('KeyD'); await sleep(600); await p.keyboard.up('KeyD');
  await sleep(400);
  console.log((errs.length === 0 ? 'PASS' : 'FAIL') + ' hata yok' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await browser.close();
})().catch(e => { console.error('HATA', e); process.exit(2); });
