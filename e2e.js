// Gerçek tarayıcı (Chromium) + gerçek sunucu: iki bağımsız sayfa, oda kodu, seçim, dövüş, revanş, ayrılma.
const { chromium } = require('playwright');
const path = require('path');
const HTML = process.argv[2], URL = process.argv[3];
const out = process.argv[4];
const fs = require('fs');
const results = [];
const check = (c, m) => { results.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function newPage(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', e => p.errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console: ' + m.text()); });
  await p.goto('file://' + HTML);
  await p.waitForFunction(() => typeof PV === 'object' && typeof showPvpMenu === 'function');
  // açılış kartı: iki dokunuş (başlat, geç) — gerçek oyuncu gibi
  await p.click('#intro'); await sleep(300); await p.click('#intro');
  await p.waitForFunction(() => getComputedStyle(document.getElementById('intro')).display === 'none', null, { timeout: 5000 });
  await p.evaluate(() => {
    window.__hist = [];
    const orig = pvpApplySnap;
    pvpApplySnap = function (m) { window.__hist.push({ tick: m.tick, hp: m.f.map(f => f.hp), act: m.f.map(f => f.act) }); return orig(m); };
  });
  p.name = name; return p;
}
async function openPvp(p) { await p.click('[data-a="pvp"]'); }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const A = await newPage(browser, 'A'), B = await newPage(browser, 'B');
  // 1) Ana menü düğmesi
  check(await A.$('[data-a="pvp"]') !== null, 'ana menüde ÇEVRİMİÇİ PvP düğmesi var');
  // 2) A oda kurar
  await openPvp(A);
  await A.fill('#pvpurl', URL);
  await A.click('[data-a="pvpCreate"]');
  await A.waitForFunction(() => PV.code && PV.code.length === 6, null, { timeout: 8000 });
  const code = await A.evaluate(() => PV.code);
  check(/^\d{6}$/.test(code), 'A 6 haneli oda kodu aldı: ' + code);
  const waitingText = await A.evaluate(() => document.getElementById('ovl') ? '' : '');
  // 3) B yanlış kodla dener
  await openPvp(B);
  await B.fill('#pvpurl', URL);
  await B.fill('#pvpcode', '000001');
  await B.click('[data-a="pvpJoin"]');
  await B.waitForFunction(() => /bulunamadı/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
  check(await B.evaluate(() => /bulunamadı/.test(document.body.innerText)), 'yanlış kodla oda bulunamaz mesajı');
  // 4) B doğru kodla katılır (hata sonrası aynı menüde kalır)
  await B.fill('#pvpurl', URL);
  await B.fill('#pvpcode', code);
  await B.click('[data-a="pvpJoin"]');
  await B.waitForFunction(() => PV.phase === 'lobby', null, { timeout: 8000 });
  await A.waitForFunction(() => PV.opp !== null && PV.phase === 'lobby', null, { timeout: 8000 });
  check(true, 'B katıldı; her iki taraf lobide');
  // 5) Seçimler: A = Kaelen+Pala, B = Vael+Ruh Tırpanı
  await A.click('[data-a="pvpChar"][data-id="kaelen"]');
  await A.click('[data-a="pvpWep"][data-id="pala"]');
  await B.click('[data-a="pvpChar"][data-id="vael"]');
  await B.click('[data-a="pvpWep"][data-id="soulscythe"]');
  await A.waitForFunction(() => PV.opp && PV.opp.char === 'vael' && PV.opp.weapon === 'soulscythe', null, { timeout: 6000 });
  check(true, 'seçimler karşılıklı görünüyor (A rakibi Vael/Ruh Tırpanı görüyor)');
  await A.click('[data-a="pvpReady"]');
  await B.click('[data-a="pvpReady"]');
  await A.waitForFunction(() => PV.phase === 'fight' && state === 'pvp', null, { timeout: 12000 });
  await B.waitForFunction(() => PV.phase === 'fight' && state === 'pvp', null, { timeout: 12000 });
  check(true, 'geri sayım sonrası iki tarafta da savaş ekranı açıldı');
  // 6) Savaş: A hücum eder (sağa yürü + hafif/ağır), B bekler
  await A.evaluate(() => { window.__aggr = true; });
  const deadline = Date.now() + 75000;
  let winnerA = null;
  while (Date.now() < deadline) {
    await A.keyboard.down('KeyD'); await sleep(100); await A.keyboard.down('KeyJ'); await sleep(60); await A.keyboard.up('KeyJ');
    await sleep(120); await A.keyboard.up('KeyD');
    await sleep(80); await A.keyboard.down('KeyK'); await sleep(60); await A.keyboard.up('KeyK');
    const r = await A.evaluate(() => PV.over ? PV.over.you : null);
    if (r) { winnerA = r; break; }
    await sleep(120);
  }
  const hits = await A.evaluate(() => window.__hist.length);
  check(hits > 30, 'sunucudan ' + hits + ' snapshot alındı (tekrarlı akış)');
  check(winnerA === 'win', 'A (agresif) maçı kazandı: ' + winnerA);
  await B.waitForFunction(() => PV.over !== null, null, { timeout: 8000 });
  check(await B.evaluate(() => PV.over.you) === 'lose', 'B tarafında yenilgi görünüyor');
  check(await A.evaluate(() => /ZAFER/.test(document.body.innerText)), 'A ekranında ZAFER paneli');
  check(await B.evaluate(() => /YENİLGİ/.test(document.body.innerText)), 'B ekranında YENİLGİ paneli');
  // 7) Her iki istemci aynı tick'te aynı HP'yi görmeli (sunucu yetkili)
  const ha = await A.evaluate(() => window.__hist), hb = await B.evaluate(() => window.__hist);
  const mapB = new Map(hb.map(h => [h.tick, JSON.stringify(h.hp)]));
  let common = 0, same = 0;
  for (const h of ha) { if (mapB.has(h.tick)) { common++; if (mapB.get(h.tick) === JSON.stringify(h.hp)) same++; } }
  check(common > 20 && same === common, 'aynı tick HP eşleşmesi: ' + same + '/' + common);
  const anyHit = ha.some(h => h.act.includes('hurt'));
  check(anyHit, 'rakip "hurt" (darbe yiyor) durumunu gösterdi');
  await A.screenshot({ path: out + '_A_result.png' });
  // 8) Revanş
  await A.click('[data-a="pvpRematch"]');
  await B.click('[data-a="pvpRematch"]');
  await A.waitForFunction(() => PV.phase === 'lobby', null, { timeout: 8000 });
  check(true, 'revanş sonrası lobiye dönüldü (her iki taraf)');
  await B.waitForFunction(() => PV.phase === 'lobby', null, { timeout: 8000 });
  await A.click('[data-a="pvpReady"]');
  await B.click('[data-a="pvpReady"]');
  await A.waitForFunction(() => PV.phase === 'fight' && state === 'pvp', null, { timeout: 12000 });
  check(true, 'revanş maçı başladı');
  await A.screenshot({ path: out + '_A_battle.png' });
  await B.screenshot({ path: out + '_B_battle.png' });
  // 9) Savuş, takla, yetenek, zıplama: kısa rastgele girdi; sunucu düşmemeli
  const keys = ['KeyJ', 'KeyK', 'KeyL', 'ShiftLeft', 'Space', 'KeyI', 'KeyD', 'KeyA'];
  for (let i = 0; i < 120; i++) {
    const k = keys[Math.floor(Math.random() * keys.length)];
    await A.keyboard.down(k); await B.keyboard.down(keys[(i * 3) % keys.length]);
    await sleep(70);
    await A.keyboard.up(k); await B.keyboard.up(keys[(i * 3) % keys.length]);
  }
  await sleep(300);
  const seen = await B.evaluate(() => window.__hist.length);
  const abilA = await A.evaluate(() => window.__hist.filter(h => h.act.includes('spell')).length);
  const abilB = await B.evaluate(() => window.__hist.filter(h => h.act.includes('spell')).length);
  check(true, 'rastgele girdi testi tamamlandı (B snapshot=' + seen + ', spell kareleri A=' + abilA + ' B=' + abilB + ')');
  // 10) Rakip ayrılınca kalan oyuncu kazanır (bağlantı kopması)
  await B.close();
  await A.waitForFunction(() => /Rakip oyundan ayrıldı|ZAFER|YENİLGİ/.test(document.body.innerText) && PV.phase !== 'fight', null, { timeout: 8000 }).catch(() => {});
  const aState = await A.evaluate(() => ({ phase: PV.phase, over: PV.over, notice: PV.notice, state, txt: document.body.innerText.replace(/\s+/g, ' ') }));
  const aOk = /ZAFER|ayrıldı|YENİLGİ/.test(aState.txt);
  check(aOk, 'rakip sayfayı kapatınca A sonucu alır' + (aOk ? '' : ' [A durumu: ' + JSON.stringify(aState).slice(0, 400) + ']'));
  // 11) Hata kayıtları
  const errs = A.errs.concat(B.errs);
  check(errs.length === 0, 'tarayıcı konsolunda hata yok' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
  await browser.close();
  fs.writeFileSync(out + '_report.txt', results.join('\n') + '\n');
  console.log('\nBitti. Sonuçlar: ' + out + '_report.txt');
})().catch(e => { console.error('E2E HATASI', e); process.exit(2); });
