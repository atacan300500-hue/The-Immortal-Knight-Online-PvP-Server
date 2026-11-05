// Bağlantı kopması: maç sırasında sunucu tamamen durursa iki istemci de "BAĞLANTI KOPTU" görmeli.
const { chromium } = require('playwright');
const { execFileSync, spawn } = require('child_process');
const HTML = process.argv[2], PORT = process.argv[3], SERVER = process.argv[4], out = process.argv[5];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = 'ws://127.0.0.1:' + PORT;
(async () => {
  const srv = spawn('node', [SERVER], { env: { ...process.env, PORT }, stdio: 'ignore' });
  await sleep(1200);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  async function page() {
    const p = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.goto('file://' + HTML);
    await p.waitForFunction(() => typeof PV === 'object');
    await p.click('#intro'); await sleep(300); await p.click('#intro');
    await p.waitForFunction(() => getComputedStyle(document.getElementById('intro')).display === 'none', null, { timeout: 5000 });
    return p;
  }
  const A = await page(), B = await page();
  await A.click('[data-a="pvp"]'); await A.fill('#pvpurl', URL); await A.click('[data-a="pvpCreate"]');
  await A.waitForFunction(() => PV.code.length === 6, null, { timeout: 8000 });
  const code = await A.evaluate(() => PV.code);
  await B.click('[data-a="pvp"]'); await B.fill('#pvpurl', URL); await B.fill('#pvpcode', code); await B.click('[data-a="pvpJoin"]');
  await A.waitForFunction(() => PV.opp !== null, null, { timeout: 8000 });
  await A.click('[data-a="pvpChar"][data-id="kaelen"]'); await A.click('[data-a="pvpWep"][data-id="kilic"]');
  await B.click('[data-a="pvpChar"][data-id="vael"]'); await B.click('[data-a="pvpWep"][data-id="hancer"]');
  await A.waitForFunction(() => PV.opp && PV.opp.char === 'vael', null, { timeout: 6000 });
  await A.click('[data-a="pvpReady"]'); await B.click('[data-a="pvpReady"]');
  await A.waitForFunction(() => state === 'pvp' && PV.phase === 'fight', null, { timeout: 12000 });
  await sleep(800);
  const before = await A.evaluate(() => PV.snap ? PV.snap.tick : -1);
  check = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  check(before > 0, 'maç sırasında sunucu akışı alınıyor (tick=' + before + ')');
  srv.kill('SIGTERM');              // sunucu durdu
  await sleep(2500);
  const aLost = await A.evaluate(() => /BAĞLANTI KOPTU/.test(document.body.innerText));
  const bLost = await B.evaluate(() => /BAĞLANTI KOPTU/.test(document.body.innerText));
  check(aLost, 'sunucu durunca A "BAĞLANTI KOPTU" ekranı görür');
  check(bLost, 'sunucu durunca B "BAĞLANTI KOPTU" ekranı görür');
  await A.screenshot({ path: out + '_lost_A.png' });
  check(A.errs.length === 0, 'A tarafında sayfa hatası yok' + (A.errs.length ? ': ' + A.errs[0] : ''));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('HATA', e); process.exit(2); });
