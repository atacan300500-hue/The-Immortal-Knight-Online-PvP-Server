// Dövüş sırasında bozuk/beklenmeyen mesajlar: sunucu çökmemeli, ping'e yanıt vermeli.
'use strict';
const path = require('path');
const WebSocket = require(process.env.WS_PATH || 'ws');
const PORT = 8795; process.env.PORT = PORT;
const { server, rooms } = require(path.join(__dirname, '..', 'server.js'));
server.listen(PORT);
const url = `ws://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const open = () => new Promise(r => { const w = new WebSocket(url); w.msgs = []; w.on('message', d => w.msgs.push(JSON.parse(String(d)))); w.on('open', () => r(w)); });
const junk = () => {
  const pool = [
    'not json', '{}', '{"t":null}', '{"t":"lobby","char":{},"weapon":[]}', '{"t":"join","code":12345}', '{"t":"join","code":"abc"}',
    '{"t":"input","h":"x","e":"nope"}', '{"t":"input","h":{"left":1},"e":["light","heavy","bogus",null,{}]}',
    '{"t":"ready","v":"yes"}', '{"t":"rematch"}', '{"t":"create"}', '{"t":"unknown"}', '{"t":"ping"}', '[]', '42', 'null',
  ];
  return pool[Math.floor(Math.random() * pool.length)];
};
(async () => {
  const A = await open(), B = await open();
  A.send(JSON.stringify({ t: 'create' })); await sleep(100);
  const code = A.msgs.find(m => m.t === 'created').code;
  B.send(JSON.stringify({ t: 'join', code })); await sleep(100);
  for (const [w, c, wp] of [[A, 'kaelen', 'pala'], [B, 'vael', 'soulscythe']]) w.send(JSON.stringify({ t: 'lobby', char: c, weapon: wp }));
  await sleep(100);
  A.send(JSON.stringify({ t: 'ready', v: true })); B.send(JSON.stringify({ t: 'ready', v: true }));
  await sleep(4800); // geri sayım 4.5 sn
  let sent = 0;
  for (let i = 0; i < 600; i++) {
    const w = Math.random() < .5 ? A : B;
    w.send(Math.random() < .5 ? junk() : JSON.stringify({ t: 'input', h: { left: Math.random() < .5, right: Math.random() < .5, parry: Math.random() < .2 }, e: ['light', 'heavy', 'dodge', 'jump', 'special'].filter(() => Math.random() < .3) }));
    sent++; if (i % 50 === 0) await sleep(30);
  }
  await sleep(500);
  const alive = await new Promise(res => { A.send(JSON.stringify({ t: 'ping' })); const t = setTimeout(() => res(false), 2000); const iv = setInterval(() => { if (A.msgs.some(m => m.t === 'pong')) { clearTimeout(t); clearInterval(iv); res(true); } }, 50); });
  const fightRunning = A.msgs.some(m => m.t === 'snap');
  console.log((alive ? 'PASS' : 'FAIL') + ' sunucu ' + sent + ' bozuk/karışık mesajdan sonra hâlâ yanıt veriyor');
  console.log((fightRunning ? 'PASS' : 'FAIL') + ' dövüş akışı fuzz sırasında sürdü');
  A.close(); B.close(); await sleep(200);
  console.log('fuzz tamamlandı');
  process.exit(alive && fightRunning ? 0 : 1);
})().catch(e => { console.error('HATA', e); process.exit(2); });
