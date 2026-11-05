'use strict';
/*
 * The Immortal Knight — 1v1 Online PvP sunucusu (WebSocket, sunucu yetkili).
 * - 6 haneli oda kodu ile oda kurma / katılma
 * - Karakter + silah seçimi, hazır olma, geri sayım
 * - Gerçek zamanlı savaş: hareket, saldırı, ağır saldırı, savuşturma, savuş, takla, büyü/yetenek, zıplama
 * - HP, mana, zamanlama, isabet ve sonuç SUNUCUDA hesaplanır; istemci yalnızca girdi gönderir.
 * Bağımlılık: yalnızca "ws" paketi. Oyun verisi weapons.json (tools/extract-weapons.js ile oyundan üretilir).
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean); // boşsa tüm kökenlere izin
const WEAPONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'weapons.json'), 'utf8'));
const WEAPON_KEYS = Object.keys(WEAPONS);

// ---- Oyun sabitleri (oyunun 480x270 mantıksal alanıyla aynı) ----
const ARENA = { minX: 40, maxX: 440, ground: 222, grav: 1000 };
const TICK = 1 / 30;
const COUNTDOWN_MS = 4500;   // 1-2-3-START sesinin süresi; savaş bu süre sonunda başlar
let matchSeq = 0;            // her maça benzersiz kimlik: ses/sonuç olayları maç başına bir kez çalışır
const MIN_SEP = 26;
const BASE_DMG = 7;          // hasar = BASE_DMG * silah çarpanı * karakter çarpanı
const CHAT_RATE = 120;       // saniyede en fazla mesaj

// ---- Karakterler: dengeli istatistikler ----
// Kaelen: dengeli, büyü ile uzak hasar. Vael: çift bıçak, daha hızlı saldırı, daha az can, kasırga yeteneği.
const CHARS = {
  kaelen: { n: 'Kaelen', hp: 100, mp: 100, mpRegen: 12, spd: 78, tm: 1.0, dm: 1.0, jumpV: 370,
            spell: { cost: 30, cd: 1.0, dmg: 18, reach: 110 } },
  vael:   { n: 'Vael',   hp: 90,  mp: 100, mpRegen: 14, spd: 96, tm: 0.8, dm: 0.85, jumpV: 380,
            spell: { cost: 35, cd: 2.5, dmg: 14, reach: 70 } }, // Kan Kasırgası: ileri atılma + dönüş vuruşu
};
const CHAR_KEYS = Object.keys(CHARS);
const DODGE = { dur: 0.4, inv: 0.24, speed: 240, cd: 0.7 };
const PARRY_PERFECT = 0.16, PARRY_BLOCK_MULT = 0.35;
const HURT_LIGHT = 0.25, HURT_HEAVY = 0.45;
const COMBO_WINDOW = 0.45;

// ---- Oda yönetimi ----
const rooms = new Map();          // kod -> oda
const sockets = new Set();

function newCode() {
  for (let i = 0; i < 1000; i++) {
    const c = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    if (!rooms.has(c)) return c;
  }
  throw new Error('oda kodu üretilemedi');
}
function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function otherSlot(s) { return s === 'a' ? 'b' : 'a'; }

function makeRoom(code) {
  return { code, slots: { a: null, b: null }, phase: 'lobby', countdownAt: 0, matchId: 0, fight: null, winner: null, reason: null,
           rematch: { a: false, b: false }, tick: 0 };
}
function newFighter(role, p) {
  const c = CHARS[p.char];
  return { role, char: p.char, weapon: p.weapon, x: role === 'a' ? 170 : 290, y: ARENA.ground, vx: 0, vy: 0, g: true,
           face: role === 'a' ? 1 : -1, hp: c.hp, mp: c.mp, act: null, t: 0, dur: 0, ci: 0, hsty: 0,
           kind: null, atk: null, hitDone: false, stun: 0, comboT: 0, parryT: 0, dodgeCd: 0, spellCd: 0, spellDone: false,
           dash: 0, dead: false };
}
function playerInfo(room, slot) {
  const p = room.slots[slot];
  if (!p) return null;
  return { char: p.char, weapon: p.weapon, ready: p.ready, connected: true };
}
function roomView(room, slot) {
  const opp = room.slots[otherSlot(slot)];
  return {
    t: 'room', code: room.code, phase: room.phase, you: slot, matchId: room.matchId, countdownAt: room.countdownAt,
    me: playerInfo(room, slot), opp: opp ? playerInfo(room, otherSlot(slot)) : null,
    rematch: { me: room.rematch[slot], opp: room.rematch[otherSlot(slot)] },
    winner: room.winner, reason: room.reason,
  };
}
function broadcastRoom(room) {
  for (const s of ['a', 'b']) if (room.slots[s]) send(room.slots[s].ws, roomView(room, s));
}
function roomIsEmpty(room) { return !room.slots.a && !room.slots.b; }

function endFight(room, winnerSlot, reason) {
  room.phase = 'over'; room.winner = winnerSlot; room.reason = reason; room.rematch = { a: false, b: false };
  for (const s of ['a', 'b']) {
    if (room.slots[s]) {
      room.slots[s].ready = false;
      send(room.slots[s].ws, { t: 'over', match: room.matchId, winner: winnerSlot, you: winnerSlot === s ? 'win' : 'lose', reason });
    }
  }
  broadcastRoom(room);
}

// ---- Dövüş mantığı (sunucu tarafı) ----
function attackDef(f, kind) {
  const W = WEAPONS[f.weapon]; const c = CHARS[ (f.char) ];
  let atk, idx = 0;
  if (kind === 'light') {
    idx = f.comboT > 0 ? (f.ci + 1) % W.light.length : 0;
    atk = W.light[idx];
  } else {
    atk = W.heavy;
    f.hsty ^= 1;
  }
  return { atk, idx, c, W };
}
function startAttack(f, kind) {
  const { atk, idx, c } = attackDef(f, kind);
  f.act = kind; f.kind = kind; f.atk = atk; f.ci = idx; f.t = 0; f.hitDone = false;
  f.dur = (atk.w + atk.a + atk.r) * c.tm;
  f.aw = atk.w * c.tm; f.aa = atk.a * c.tm; f.ar = atk.r * c.tm;
  f.comboT = 0;
}
function inRange(att, def, reach) {
  if (def.dead) return false;
  if (Math.abs(def.y - ARENA.ground) > 46) return false;           // zıplayan rakip kaçmış olur
  return Math.abs(def.x - att.x) <= reach + 12;
}
function frontOf(att, def) { return (def.x - att.x) * att.face >= 0; }

// Hasar uygula: sonuç 'dodged' | 'parried' | 'blocked' | 'hit' döner
function resolveHit(room, att, def, baseDmg, reach, heavy) {
  if (def.act === 'dodge' && def.t < DODGE.inv) return 'dodged';
  if (!inRange(att, def, reach)) return 'miss';
  if (def.act === 'parry' && frontOf(def, att)) {
    if (def.parryT <= PARRY_PERFECT) {                // kusursuz savuş: saldırgan sersemler
      stagger(att, heavy ? HURT_HEAVY : HURT_LIGHT);
      def.mp = Math.min(CHARS[def.char].mp, def.mp + 12);
      room.fight.ev.push({ k: 'parry', to: def.role });
      return 'parried';
    }
    applyDamage(room, def, baseDmg * PARRY_BLOCK_MULT, heavy, true, att);
    return 'blocked';
  }
  applyDamage(room, def, baseDmg, heavy, false, att);
  return 'hit';
}
function applyDamage(room, def, dmg, heavy, blocked, att) {
  dmg = Math.round(dmg * 10) / 10;
  def.hp = Math.max(0, def.hp - dmg);
  if (def.hp <= 0 && !room.fight.koBy) room.fight.koBy = att.role;   // ilk ölümcül vuruşun sahibi kazanır
  room.fight.ev.push({ k: blocked ? 'block' : 'hit', to: def.role, dmg });
  stagger(def, heavy ? HURT_HEAVY : HURT_LIGHT);
  if (def.hp <= 0 && !def.dead) def.dead = true;
}
function stagger(f, dur) {
  f.act = 'hurt'; f.t = 0; f.stun = dur; f.hitDone = true; f.dash = 0;
}

function updateFighter(room, f, o, inp, dt) {
  const c = CHARS[f.char];
  const fight = room.fight;
  // Bekleme sayaçları
  f.mp = Math.min(c.mp, f.mp + c.mpRegen * dt);
  f.dodgeCd = Math.max(0, f.dodgeCd - dt);
  f.spellCd = Math.max(0, f.spellCd - dt);
  if (f.act === null) f.comboT = Math.max(0, f.comboT - dt);

  // Olay kuyruğu (basışlar)
  for (const e of inp.ev) {
    if (f.dead) break;
    if (e === 'light' || e === 'heavy') {
      // Saldırı yalnızca boşta, savunmada veya kombo penceresinde (önceki hafif vuruş bittikten sonra) başlar
      const canAct = f.act === null || f.act === 'parry';
      if (canAct) startAttack(f, e);
    } else if (e === 'dodge') {
      if (f.dodgeCd <= 0 && (f.act === null || f.act === 'parry')) { f.act = 'dodge'; f.t = 0; f.dodgeCd = DODGE.cd; f.dash = DODGE.speed * -f.face; }
    } else if (e === 'jump') {
      if (f.g && (f.act === null || f.act === 'parry')) { f.vy = -c.jumpV; f.g = false; }
    } else if (e === 'special') {
      if (f.spellCd <= 0 && f.mp >= c.spell.cost && (f.act === null || f.act === 'parry')) {
        f.mp -= c.spell.cost; f.spellCd = c.spell.cd; f.act = 'spell'; f.t = 0; f.spellDone = false;
        f.dash = f.char === 'vael' ? 340 * f.face : 0; // Vael: kasırga ileri atılır
        fight.ev.push({ k: 'spell', to: f.role });
      }
    }
  }

  // Aksiyon zamanlaması ve isabet
  if (f.act === 'light' || f.act === 'heavy') {
    f.t += dt;
    const atk = f.atk;
    if (!f.hitDone && f.t >= f.aw && f.t <= f.aw + f.aa + dt) {
      const heavy = f.kind === 'heavy';
      const dmg = BASE_DMG * atk.m * c.dm * (heavy ? 1 : 1);
      resolveHit(room, f, o, dmg, atk.reach, heavy);
      f.hitDone = true;
    }
    // Atılma (lunge) yalnızca aktif vuruş penceresinde
    f.vx = (f.t >= f.aw && f.t <= f.aw + f.aa) ? f.face * (atk.lunge / Math.max(f.aa, 0.05)) * 0.5 : 0;
    if (f.t >= f.dur) { if (f.kind === 'light') f.comboT = COMBO_WINDOW; endAction(f); }
  } else if (f.act === 'spell') {
    f.t += dt;
    if (f.dash && f.t < 0.18) f.vx = f.dash; else f.vx = 0;
    if (!f.spellDone && f.t >= 0.2) {
      f.spellDone = true;
      const sp = c.spell;
      const reach = sp.reach;
      if (!inRange(f, o, reach)) { /* ıska */ } else resolveHit(room, f, o, sp.dmg, reach, false);
    }
    if (f.t >= 0.6) endAction(f);
  } else if (f.act === 'dodge') {
    f.t += dt;
    f.vx = f.t < DODGE.dur * 0.6 ? f.dash : 0;
    if (f.t >= DODGE.dur) endAction(f);
  } else if (f.act === 'hurt') {
    f.t += dt; f.vx = 0;
    f.stun -= dt;
    if (f.stun <= 0) endAction(f);
  } else if (f.act === 'parry') {
    f.parryT += dt;
    f.vx = inp.left && !inp.right ? -c.spd * 0.35 : inp.right && !inp.left ? c.spd * 0.35 : 0;
    if (!inp.parry) endAction(f);
  } else { // boşta: yürüme
    const d = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    f.vx = d * c.spd;
    if (inp.parry) { f.act = 'parry'; f.parryT = 0; f.t = 0; }
  }
  if (f.act !== 'parry') f.parryT = 0;
  if (f.act === null || f.act === 'parry') {
    if (f.act === null && !f.dead && Math.abs(o.x - f.x) > 2) f.face = o.x > f.x ? 1 : -1;
  }

  // Dash (yetenek) ve atılmalar vx'i ezebilir; fizik
  if (f.dash && (f.act === 'spell' || f.act === 'dodge')) { /* f.vx zaten ayarlandı */ }
  f.x += f.vx * dt;
  f.x = Math.max(ARENA.minX, Math.min(ARENA.maxX, f.x));
  if (!f.g) {
    f.vy += ARENA.grav * dt; f.y += f.vy * dt;
    if (f.y >= ARENA.ground) { f.y = ARENA.ground; f.vy = 0; f.g = true; }
  }
}
function endAction(f) {
  f.act = null; f.t = 0; f.dur = 0; f.kind = null; f.vx = 0; f.dash = 0; f.hitDone = false; f.parryT = 0;
}

function stepRoom(room, dt) {
  const f = { a: room.fight.a, b: room.fight.b };
  const inputs = { a: takeInput(room.slots.a), b: takeInput(room.slots.b) };
  updateFighter(room, f.a, f.b, inputs.a, dt);
  updateFighter(room, f.b, f.a, inputs.b, dt);
  // Gövde ayrımı (üst üste binmeyi önler)
  const dx = f.b.x - f.a.x;
  if (Math.abs(dx) < MIN_SEP && f.a.g && f.b.g) {
    const push = (MIN_SEP - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
    f.a.x = Math.max(ARENA.minX, Math.min(ARENA.maxX, f.a.x - push));
    f.b.x = Math.max(ARENA.minX, Math.min(ARENA.maxX, f.b.x + push));
  }
  if ((f.a.dead || f.b.dead) && room.phase === 'fight') {
    endFight(room, room.fight.koBy || (f.a.dead ? 'b' : 'a'), 'ko');
  }
}

// Girdi: son basılı durum + bu tick'te birikmiş olaylar (sonra temizlenir)
function takeInput(p) {
  if (!p) return { left: false, right: false, parry: false, ev: [] };
  const ev = p.queue.splice(0, p.queue.length);
  return { left: !!p.held.left, right: !!p.held.right, parry: !!p.held.parry, ev };
}

function snapshot(room) {
  const fa = room.fight.a, fb = room.fight.b;
  const pack = f => ({ role: f.role, char: f.char, weapon: f.weapon, x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10,
    face: f.face, hp: Math.round(f.hp * 10) / 10, mp: Math.round(f.mp * 10) / 10, act: f.act, t: Math.round(f.t * 1000) / 1000,
    ci: f.ci, hsty: f.hsty, g: f.g, vx: Math.round(f.vx), aw: f.aw, aa: f.aa, ar: f.ar, kind: f.kind, dead: f.dead });
  const ev = room.fight.ev.splice(0, room.fight.ev.length);
  return { t: 'snap', tick: room.tick, f: [pack(fa), pack(fb)], ev };
}

// ---- Oda döngüsü ----
setInterval(() => {
  for (const room of rooms.values()) {
    try { tickRoom(room); } catch (err) { console.error('oda hatası', room.code, err); endRoomSafely(room); }
  }
}, TICK * 1000);

function endRoomSafely(room) {
  if (room.phase === 'fight' || room.phase === 'countdown') {
    room.phase = 'lobby'; room.fight = null; room.countdownAt = 0;
    broadcastRoom(room);
  }
}
function tickRoom(room) {
  {
    if (room.phase === 'countdown') {
      if (Date.now() >= room.countdownAt + COUNTDOWN_MS && room.slots.a && room.slots.b) {
        room.phase = 'fight';
        room.fight = { a: newFighter('a', room.slots.a), b: newFighter('b', room.slots.b), ev: [], koBy: null };
        room.tick = 0;
        broadcastRoom(room);
      }
    } else if (room.phase === 'fight') {
      room.tick++;
      stepRoom(room, TICK);
      // Son kare (KO dahil) her durumda gönderilir; 'over' mesajı zaten endFight içinde gider
      const snap = snapshot(room);
      if (room.slots.a) send(room.slots.a.ws, snap);
      if (room.slots.b) send(room.slots.b.ws, snap);
    }
  }
}

// ---- HTTP + WebSocket ----
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
});
const wss = new WebSocketServer({
  server,
  verifyClient: (info, cb) => {
    const origin = info.origin || '';
    if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) return cb(false, 403, 'origin not allowed');
    cb(true);
  },
});

wss.on('connection', ws => {
  ws.isAlive = true; ws.msgs = []; ws.room = null; ws.slot = null;
  sockets.add(ws);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    const now = Date.now();
    ws.msgs = ws.msgs.filter(t => now - t < 1000); ws.msgs.push(now);
    if (ws.msgs.length > CHAT_RATE) return ws.close(1008, 'rate limit');
    let m; try { m = JSON.parse(String(data)); } catch (e) { return send(ws, { t: 'err', e: 'bad_json' }); }
    if (!m || typeof m.t !== 'string') return;
    handle(ws, m);
  });
  ws.on('close', () => { sockets.delete(ws); leave(ws); });
  ws.on('error', () => {});
});

function handle(ws, m) {
  switch (m.t) {
    case 'ping': return send(ws, { t: 'pong', ts: m.ts, st: Date.now() });
    case 'create': {
      if (ws.room) return send(ws, { t: 'err', e: 'already_in_room' });
      const code = newCode(); const room = makeRoom(code); rooms.set(code, room);
      attach(ws, room, 'a');
      return send(ws, { t: 'created', code, you: 'a' }), broadcastRoom(room);
    }
    case 'join': {
      if (ws.room) return send(ws, { t: 'err', e: 'already_in_room' });
      const code = String(m.code || '');
      if (!/^\d{6}$/.test(code)) return send(ws, { t: 'err', e: 'bad_code' });
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'err', e: 'not_found' });
      const slot = !room.slots.a ? 'a' : !room.slots.b ? 'b' : null;
      if (!slot) return send(ws, { t: 'err', e: 'full' });
      attach(ws, room, slot);
      send(ws, { t: 'joined', code, you: slot });
      broadcastRoom(room);
      return;
    }
    case 'lobby': {
      const p = ws.room && ws.slot ? ws.room.slots[ws.slot] : null;
      const room = ws.room;
      if (!p || !room || room.phase !== 'lobby') return send(ws, { t: 'err', e: 'not_in_lobby' });
      if (!CHAR_KEYS.includes(m.char)) return send(ws, { t: 'err', e: 'bad_char' });
      if (!WEAPON_KEYS.includes(m.weapon)) return send(ws, { t: 'err', e: 'bad_weapon' });
      p.char = m.char; p.weapon = m.weapon; p.ready = false;
      return broadcastRoom(room);
    }
    case 'ready': {
      const room = ws.room; const p = room && ws.slot ? room.slots[ws.slot] : null;
      if (!p || room.phase !== 'lobby') return;
      if (!p.char || !p.weapon) return send(ws, { t: 'err', e: 'select_first' });
      p.ready = !!m.v;
      const a = room.slots.a, b = room.slots.b;
      if (a && b && a.ready && b.ready) { room.phase = 'countdown'; room.countdownAt = Date.now(); room.matchId = ++matchSeq; room.tick = 0; }
      return broadcastRoom(room);
    }
    case 'input': {
      const room = ws.room; const p = room && ws.slot ? room.slots[ws.slot] : null;
      if (!p || room.phase !== 'fight') return;
      if (m.h && typeof m.h === 'object') p.held = { left: !!m.h.left, right: !!m.h.right, parry: !!m.h.parry };
      if (Array.isArray(m.e)) {
        const ok = ['light', 'heavy', 'dodge', 'jump', 'special'];
        for (const e of m.e.slice(0, 10)) if (ok.includes(e) && p.queue.length < 20) p.queue.push(e);
      }
      return;
    }
    case 'rematch': {
      const room = ws.room;
      if (!room || room.phase !== 'over' || !ws.slot) return;
      room.rematch[ws.slot] = true;
      if (room.rematch.a && room.rematch.b) {
        room.phase = 'lobby'; room.winner = null; room.reason = null; room.rematch = { a: false, b: false };
        room.fight = null;
        if (room.slots.a) room.slots.a.ready = false;
        if (room.slots.b) room.slots.b.ready = false;
      }
      return broadcastRoom(room);
    }
    case 'leave': return leave(ws, true);
    default: return send(ws, { t: 'err', e: 'unknown' });
  }
}

function attach(ws, room, slot) {
  ws.room = room; ws.slot = slot;
  room.slots[slot] = { ws, char: null, weapon: null, ready: false, held: {}, queue: [] };
}

function leave(ws, explicit) {
  const room = ws.room; const slot = ws.slot;
  if (!room || !slot) return;
  const me = room.slots[slot];
  room.slots[slot] = null;
  ws.room = null; ws.slot = null;
  if (me && me.ws === ws) me.ws = null;
  const other = room.slots[otherSlot(slot)];
  if (roomIsEmpty(room)) { rooms.delete(room.code); return; }
  if (room.phase === 'fight') {
    // Bağlantı kopması ya da çıkış: kalan oyuncu kazanır
    endFight(room, otherSlot(slot), 'opp_left');
  } else if (room.phase === 'countdown') {
    room.phase = "lobby"; room.countdownAt = 0;
    if (other) other.ready = false;
    broadcastRoom(room);
  } else if (room.phase === 'over') {
    room.phase = 'lobby'; room.winner = null; room.reason = null; room.rematch = { a: false, b: false };
    if (other) other.ready = false;
    broadcastRoom(room);
  } else {
    if (other) other.ready = false;
    broadcastRoom(room);
  }
  if (other) send(other.ws, { t: 'opp_left', explicit: !!explicit });
}

// Ölü bağlantıları temizle
setInterval(() => {
  for (const ws of sockets) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; try { ws.ping(); } catch (e) {}
  }
}, 15000);

if (require.main === module) {
  server.listen(PORT, () => console.log(`PvP sunucusu dinliyor: ws://0.0.0.0:${PORT}  (sağlık: /health)`));
}
module.exports = { server, CHARS, WEAPONS, rooms };
