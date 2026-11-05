// İki bağımsız Chromium istemcisi + gerçek sunucu: geri sayım/giriş/duyuru/maç sonu seslerinin sırası ve tekrar sayısı.
// Not: bu tarayıcı AAC çözemez; test varyantı aynı seslerin WAV kopyasını kullanır (build/test_wav.html).
const { chromium } = require('playwright');
const HTML = process.argv[2], URL = process.argv[3];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function page(browser) {
  const p = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto('file://' + HTML);
  await p.waitForFunction(() => typeof PV === 'object' && typeof annMatchEnd === 'function');
  await p.click('#intro'); await sleep(300); await p.click('#intro');
  await p.waitForFunction(() => getComputedStyle(document.getElementById('intro')).display === 'none', null, { timeout: 5000 });
  return p;
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const A = await page(browser), B = await page(browser);
  await A.click('[data-a="pvp"]'); await A.fill('#pvpurl', URL); await A.click('[data-a="pvpCreate"]');
  await A.waitForFunction(() => PV.code.length === 6, null, { timeout: 8000 });
  const code = await A.evaluate(() => PV.code);
  await B.click('[data-a="pvp"]'); await B.fill('#pvpurl', URL); await B.fill('#pvpcode', code); await B.click('[data-a="pvpJoin"]');
  await A.waitForFunction(() => PV.opp !== null, null, { timeout: 8000 });
  await A.click('[data-a="pvpChar"][data-id="kaelen"]'); await A.click('[data-a="pvpWep"][data-id="pala"]');
  await B.click('[data-a="pvpChar"][data-id="vael"]'); await B.click('[data-a="pvpWep"][data-id="kilic"]');
  await A.waitForFunction(() => PV.opp && PV.opp.char === 'vael', null, { timeout: 6000 });
  await A.click('[data-a="pvpReady"]'); await B.click('[data-a="pvpReady"]');
  await A.waitForFunction(() => PV.phase === 'countdown', null, { timeout: 8000 });
  // Geri sayım etiketleri (sunucu zamanına göre)
  const labels = [];
  for (let i = 0; i < 6; i++) { labels.push(await A.evaluate(() => PV.phase === 'countdown' ? pvpCountLabel() : 'x')); await sleep(800); }
  check(labels.includes('1') && labels.includes('2') && labels.includes('3'), 'geri sayım etiketleri 1-2-3 sırasıyla görünüyor: ' + labels.join(','));
  await A.waitForFunction(() => PV.phase === 'fight', null, { timeout: 8000 });
  await sleep(300);
  const logA = await A.evaluate(() => ANN.log.slice()), logB = await B.evaluate(() => ANN.log.slice());
  const playsA = logA.filter(e => e.startsWith('play:'));
  console.log('A ses olayları:', playsA.join(' | '));
  const cnt = playsA.filter(e => e.startsWith('play:count:'));
  const ent = playsA.filter(e => e.startsWith('play:entrance:'));
  check(cnt.length === 1 && cnt[0].includes('1-2-3start'), 'geri sayım sesi tam bir kez çaldı');
  check(ent.length === 1 && ent[0].includes('pvpenterance1'), 'giriş sesi tam bir kez çaldı');
  const t = e => parseFloat(e.split('@')[1]);
  if (cnt.length && ent.length) {
    const gap = t(ent[0]) - t(cnt[0]);
    check(Math.abs(gap - 4.5) < 0.35, 'giriş, geri sayımdan ~4.5 sn sonra başladı (fark=' + gap.toFixed(3) + ' sn)');
  }
  // Savaş duyuruları: üst üste binmez, bekleme süresi var
  await A.keyboard.down('KeyD');
  const deadline = Date.now() + 70000;
  let over = null;
  while (Date.now() < deadline && !over) {
    await A.keyboard.down('KeyJ'); await sleep(60); await A.keyboard.up('KeyJ');
    await sleep(120); await A.keyboard.down('KeyK'); await sleep(60); await A.keyboard.up('KeyK');
    await sleep(120);
    over = await A.evaluate(() => PV.over ? PV.over.you : null);
  }
  await A.keyboard.up('KeyD');
  check(over === 'win', 'A maçı kazandı (' + over + ')');
  await sleep(600);
  const crit = (await A.evaluate(() => ANN.log.filter(e => e.startsWith('play:crit')))).map(e => ({ key: e.split(':')[2].split('@')[0], at: t(e) }));
  check(crit.length >= 1, 'savaş sırasında en az bir rastgele duyuru çaldı (' + crit.length + ' adet)');
  let overlap = false, short = false;
  for (let i = 1; i < crit.length; i++) { if (crit[i].at < crit[i - 1].at + 1.8) overlap = true; if (crit[i].at - crit[i - 1].at < 9) short = true; }
  check(!overlap, 'duyurular birbirini kesmiyor/üst üste binmiyor');
  check(!short, 'duyurular arasında en az 9 sn bekleme var');
  // Maç sonu: kazanan A'da zafer, B'de yenilgi sesi; her biri tek
  const endA = (await A.evaluate(() => ANN.log)).filter(e => e.startsWith('play:end:'));
  await sleep(300);
  const endB = (await B.evaluate(() => ANN.log)).filter(e => e.startsWith('play:end:'));
  console.log('A maç sonu:', endA.join(' | '), ' B maç sonu:', endB.join(' | '));
  check(endA.length === 1 && endA[0].includes('matchend-victory'), 'kazanan cihazda zafer sesi tam bir kez');
  check(endB.length === 1 && endB[0].includes('matchend-lost'), 'kaybeden cihazda yenilgi sesi tam bir kez');
  check(!endA.some(e => e.includes('matchend-lost')) && !endB.some(e => e.includes('matchend-victory')), 'iki cihazda ters ses yok');
  // Revanş: yeni maç, yeni geri sayım ve giriş bir kez
  await A.click('[data-a="pvpRematch"]'); await B.click('[data-a="pvpRematch"]');
  await A.waitForFunction(() => PV.phase === 'lobby', null, { timeout: 8000 });
  await B.waitForFunction(() => PV.phase === 'lobby', null, { timeout: 8000 });
  await A.click('[data-a="pvpReady"]'); await B.click('[data-a="pvpReady"]');
  await A.waitForFunction(() => PV.phase === 'fight', null, { timeout: 12000 });
  await sleep(500);
  const r2 = (await A.evaluate(() => ANN.log)).filter(e => e.startsWith('play:count:') || e.startsWith('play:entrance:'));
  check(r2.filter(e => e.startsWith('play:count:')).length === 2 && r2.filter(e => e.startsWith('play:entrance:')).length === 2, 'revanşta geri sayım ve giriş yeniden birer kez çaldı');
  // Aynı maç sonu/giriş olayı tekrar gelse de tekrar çalmaz
  const dup = await A.evaluate(() => { const n = ANN.log.length; annMatchEnd(ANN.matchId ? ANN.matchId : 1, true); annStartMatch(ANN.matchId, PV.countdownAt); return ANN.log.length - n; });
  check(dup === 0, 'aynı maç için tekrarlanan olay ses çalmıyor (eklenen=' + dup + ')');
  check(A.errs.length === 0 && B.errs.length === 0, 'sayfa hatası yok' + (A.errs.concat(B.errs).length ? ': ' + A.errs.concat(B.errs)[0] : ''));
  await browser.close();
  console.log(fails ? fails + ' başarısız' : 'tüm ses kontrolleri geçti');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('HATA', e); process.exit(2); });
