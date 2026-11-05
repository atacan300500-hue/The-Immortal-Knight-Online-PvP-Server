// Gerçek WebSocket ile iki istemci: oda kodu, katılım, seçim, hazır, geri sayım, dövüş, sonuç, rakip ayrılması.
'use strict';
const path = require('path');
const WebSocket = require(process.env.WS_PATH || 'ws');
const PORT = 8790;
process.env.PORT = PORT;
const { server, rooms } = require(path.join(__dirname, '..', 'server.js'));
server.listen(PORT);
const url = `ws://127.0.0.1:${PORT}`;
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) { passes++; console.log('  PASS', msg); } else { fails++; console.log('  FAIL', msg); } };
function client(name) {
  const ws = new WebSocket(url); const inbox = []; const waiters = [];
  ws.on('message', d => { const m = JSON.parse(String(d)); inbox.push(m); for (const w of waiters.slice()) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); } });
  ws.snaps = () => inbox.filter(m => m.t === 'snap');
  ws.wait = (pred, ms = 5000) => new Promise((res, rej) => {
    const hit = inbox.find(pred); if (hit) return res(hit);
    const w = { pred, res }; waiters.push(w);
    setTimeout(() => rej(new Error(name + ' timeout waiting')), ms);
  });
  ws.send2 = o => ws.send(JSON.stringify(o));
  ws.inbox = inbox; ws.name = name;
  return new Promise(r => ws.on('open', () => r(ws)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const A = await client('A'), B = await client('B');
  // 1) oda kur
  A.send2({ t: 'create' });
  const created = await A.wait(m => m.t === 'created');
  ok(/^\d{6}$/.test(created.code), 'oda kodu 6 haneli: ' + created.code);
  // 2) yanlış kod
  B.send2({ t: 'join', code: '000000' });
  const nf = await B.wait(m => m.t === 'err');
  ok(nf.e === 'not_found', 'yanlış kod reddedilir (not_found)');
  // 3) doğru kod ile katıl
  B.send2({ t: 'join', code: created.code });
  const joined = await B.wait(m => m.t === 'joined');
  ok(joined.you === 'b', 'ikinci oyuncu b olarak katıldı');
  await A.wait(m => m.t === 'room' && m.opp && m.phase === 'lobby');
  ok(true, 'A rakibin katıldığını görür (lobby)');
  // 4) hazır olmadan önce seçim şart
  A.send2({ t: 'ready', v: true });
  const sel = await A.wait(m => m.t === 'err' && m.e === 'select_first');
  ok(!!sel, 'seçim yapılmadan hazır olunamaz');
  // 5) seçimler: Kaelen-Pala, Vael-Tırpan
  A.send2({ t: 'lobby', char: 'kaelen', weapon: 'pala' });
  B.send2({ t: 'lobby', char: 'vael', weapon: 'soulscythe' });
  await sleep(50);
  B.send2({ t: 'lobby', char: 'vael', weapon: 'kilic' });
  A.send2({ t: 'ready', v: true }); B.send2({ t: 'ready', v: true });
  await A.wait(m => m.t === 'room' && m.phase === 'countdown');
  ok(true, 'iki hazır olunca geri sayım başlar');
  await A.wait(m => m.t === 'room' && m.phase === 'fight', 6000);
  ok(true, 'geri sayım sonrası dövüş başlar');
  // 6) dövüş: A sürekli hafif vuruş, B boşta. Hasar B'ye gelmeli.
  for (let i = 0; i < 40; i++) {
    A.send2({ t: 'input', h: { right: true }, e: ['light'] });
    await sleep(120);
  }
  await sleep(300);
  const last = A.snaps().slice(-1)[0];
  ok(!!last, 'sunucu snapshot gönderiyor');
  const fa = last.f[0], fb = last.f[1];
  ok(fa.char === 'kaelen' && fb.char === 'vael', 'snapshot karakterleri doğru: ' + fa.char + ' / ' + fb.char);
  ok(fb.hp < 90, 'A saldırıları B canını düşürdü (B hp=' + fb.hp + ')');
  ok(fa.hp === 100, 'A hasar almadı (A hp=' + fa.hp + ')');
  // İki istemci aynı tick'lerde aynı sunucu durumunu almalı (sunucu yetkili)
  const bl = B.snaps().slice(-1)[0];
  const sameTick = B.snaps().find(s => s.tick === last.tick);
  ok(!!sameTick && JSON.stringify(sameTick.f.map(f => f.hp)) === JSON.stringify(last.f.map(f => f.hp)), 'aynı tick için iki istemci aynı HP değerlerini alıyor');
  ok(!!bl, 'B de snapshot alıyor');
  const hitEvents = A.snaps().flatMap(s => s.ev).filter(e => e.k === 'hit' || e.k === 'block');
  ok(hitEvents.length > 0, 'isabet olayları istemcilere iletiliyor (' + hitEvents.length + ' adet)');
  // 8) Dövüş bitene kadar A saldırsın
  const endP = A.wait(m => m.t === 'over', 60000);
  const hitterStart = Date.now();
  while (Date.now() - hitterStart < 60000 && !A.inbox.some(m => m.t === 'over')) {
    A.send2({ t: 'input', h: { right: true }, e: ['heavy', 'light'] });
    await sleep(160);
  }
  const over = await endP;
  ok(over.you === 'win' || over.you === 'lose', 'maç sonucu gönderildi: ' + over.you + ' (' + over.reason + ')');
  const bOver = await B.wait(m => m.t === 'over');
  ok(bOver.you !== over.you, 'iki oyuncu zıt sonuç görüyor');
  // 9) revanş
  A.send2({ t: 'rematch' }); B.send2({ t: 'rematch' });
  await A.wait(m => m.t === 'room' && m.phase === 'lobby' && m.rematch && m.rematch.opp === true && m.rematch.me === true, 3000).catch(() => {});
  await sleep(200);
  const lob = A.inbox.filter(m => m.t === 'room').slice(-1)[0];
  ok(lob.phase === 'lobby', 'revanş sonrası lobiye dönülür');
  // 10) rakip ayrılması
  B.send2({ t: 'leave' });
  const lost = await A.wait(m => m.t === 'opp_left', 3000).catch(() => null);
  ok(!!lost, 'rakip ayrılınca kalan oyuncu bilgilendirilir');
  A.close(); B.close(); await sleep(100);
  // 11) sunucu temiz: oda silinmiş olmalı
  await sleep(200);
  ok(rooms.size === 0, 'boş oda temizlenir (oda sayısı=' + rooms.size + ')');
  console.log(`\n${passes} geçti, ${fails} başarısız`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('TEST HATASI', e); process.exit(2); });
