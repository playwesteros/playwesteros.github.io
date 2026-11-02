'use strict';

const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const { randomUUID, randomBytes } = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500,http://localhost:5501,http://127.0.0.1:5501')
    .split(',').map(value => value.trim()).filter(Boolean)
);

const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, service: 'iron-throne-game-server' }));
app.get('/', (_req, res) => res.type('text').send('The Iron Throne multiplayer server is running.'));
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error(`Origin not allowed: ${origin}`), false);
    },
    methods: ['GET', 'POST']
  },
  allowRequest(req, callback) {
    const origin = req.headers.origin;
    callback(null, !origin || allowedOrigins.has(origin));
  }
});

const HOUSE_DEFS = [
  { id: 'stark', name: 'Stark', color: '#91a8c1', sigil: '🐺', motto: 'Winter is Coming', capital: 'Winterfell', buff: 'King of the North: the city of Winterfell cannot be attacked by ships, and gains +2 defense when attacked.', nerf: null },
  { id: 'lannister', name: 'Lannister', color: '#c8a45c', sigil: '🦁', motto: 'Hear Me Roar!', capital: 'Casterly Rock', buff: 'Rich as a Lannister: The city of Casterly Rock yields 18 gold a round instead of 15 to every player living there, and the house begins with 5 extra gold.', nerf: null },
  { id: 'baratheon', name: 'Baratheon', color: '#c7b8a0', sigil: '🦌', motto: 'Ours Is the Fury', capital: 'Storm’s End', buff: 'Royal Blood: a Baratheon always starts as king.', nerf: null },
  { id: 'targaryen', name: 'Targaryen', color: '#bf6258', sigil: '🐉', motto: 'Fire and Blood', capital: 'Dragonstone', buff: 'Dragonlord: begins with 1 dragon; each dragon adds 5 battle strength and +2 siege strength.', nerf: 'The realm fears dragons: failed spy missions against this house are more likely.' },
  { id: 'tyrell', name: 'Tyrell', color: '#76a77d', sigil: '🌹', motto: 'Growing Strong', capital: 'Highgarden', buff: 'The Reach: gains 2 extra gold per capital at round start.', nerf: 'Lavish courts: infantry recruitment costs 5 gold each.' },
  { id: 'greyjoy', name: 'greyjoy', color: '#8f9da7', sigil: '🐙', motto: 'We Do Not Sow', capital: 'Pyke', buff: 'Iron Fleet: ships cost 4 gold each.', nerf: 'Hard shores: infantry recruitment costs 5 gold each.' },
  { id: 'martell', name: 'martell', color: '#d49b62', sigil: '☀', motto: 'Unbowed, Unbent, Unbroken', capital: 'Sunspear', buff: 'Desert defense: +2 defense when Sunspear is attacked.', nerf: 'Distant ports: naval recruitment costs 6 gold each.' },
  { id: 'arryn', name: 'arryn', color: '#8cb8c9', sigil: '🦅', motto: 'As High as Honor', capital: 'The Eyrie', buff: 'High ground: +2 defense when the Eyrie is attacked.', nerf: 'Mountain roads: infantry recruitment costs 5 gold each.' }
];

const CAPITAL_DEFS = [
  { id: 'winterfell', name: 'Winterfell', region: 'The North', icon: '❄', defense: 5, originalHouseId: 'stark' },
  { id: 'casterly-rock', name: 'Casterly Rock', region: 'The Westerlands', icon: '⛰', defense: 5, originalHouseId: 'lannister' },
  { id: 'storms-end', name: 'Storm’s End', region: 'The Stormlands', icon: '⛈', defense: 5, originalHouseId: 'baratheon' },
  { id: 'dragonstone', name: 'Dragonstone', region: 'The Crownlands', icon: '🐉', defense: 4, originalHouseId: 'targaryen' },
  { id: 'highgarden', name: 'Highgarden', region: 'The Reach', icon: '🌹', defense: 4, originalHouseId: 'tyrell' },
  { id: 'pyke', name: 'Pyke', region: 'The Iron Islands', icon: '⚓', defense: 4, originalHouseId: 'greyjoy' },
  { id: 'sunspear', name: 'Sunspear', region: 'Dorne', icon: '☀', defense: 4, originalHouseId: 'martell' },
  { id: 'the-eyrie', name: 'The Eyrie', region: 'The Vale', icon: '🦅', defense: 4, originalHouseId: 'arryn' },
  { id: 'kings-landing', name: 'King’s Landing', region: 'The Crownlands', icon: '👑', defense: 6, originalHouseId: null }
];

let players = new Map();
let tokenToPlayerId = new Map();
let alliances = [];
let allianceOffers = [];
let treaties = [];
let spoils = [];
let notices = [];
let publicMessages = [];
let privateMessages = [];
let taxLedger = [];
let events = [];
let houses;
let capitals;
let phase;
let round;
let hostId;
let kingPlayerId;
let handPlayerId;
let gameSettings;
let dragonIds;
let gameOver;
let startHouseCount;

function freshHouses() {
  return HOUSE_DEFS.map(def => ({
    ...def,
    infantryCost: ['tyrell', 'greyjoy', 'arryn'].includes(def.id) ? 5 : def.id === 'targaryen' ? 4 : 4,
    navyCost: def.id === 'greyjoy' ? 4 : def.id === 'martell' ? 6 : 5,
  }));
}
function freshCapitals() {
  return CAPITAL_DEFS.map(cap => ({ ...cap, ownerHouseId: cap.originalHouseId }));
}
function resetWorld(keepPlayers = true, rematch = false) {
  const keptSettings = rematch ? { ...gameSettings } : null;
  const keptHouses = rematch ? new Map([...players.values()].map(p => [p.id, p.houseId])) : null;
  phase = 'LOBBY';
  round = 1;
  gameSettings = { configured: false, maxPlayers: 10, gameType: 'CLASSIC', dragonCount: 1, dragonRounds: 5, friendlyFire: true, teamSize: 2 };
  dragonIds = [];
  gameOver = null;
  startHouseCount = 0;
  kingPlayerId = null;
  handPlayerId = null;
  houses = freshHouses();
  capitals = freshCapitals();
  alliances.length = 0;
  allianceOffers.length = 0;
  treaties.length = 0;
  spoils.length = 0;
  notices.length = 0;
  publicMessages.length = 0;
  privateMessages.length = 0;
  taxLedger.length = 0;
  events.length = 0;
  if (!keepPlayers) {
    players.clear();
    tokenToPlayerId.clear();
    hostId = null;
  } else {
    for (const p of players.values()) {
      p.houseId = null;
      p.lastSpyRound = 0;
      p.traitor = false;
      p.isKing = false;
      p.isHand = false;
      p.eliminated = false;
      delete p.w; p.cityId = null;
    }
    if (rematch) for (const p of players.values()) { p.houseId = keptHouses.get(p.id) || null; }
  }
  if (rematch && keptSettings) gameSettings = keptSettings;
  addEvent('important', rematch ? 'A new game begins. Everyone keeps their house; the host can start when ready.' : 'The Great Houses gather. The realm is reset and the lobby is open.');
}
resetWorld(false);
const gameRooms = new Map();
const roomOwners = new Map();
const hostDisconnectTimers = new Map();
const HOST_DISCONNECT_GRACE_MS = 2 * 60 * 1000;
function cancelHostDisconnect(roomCode) {
  const timer = hostDisconnectTimers.get(roomCode);
  if (timer) clearTimeout(timer);
  hostDisconnectTimers.delete(roomCode);
}
function endGameRoom(roomCode, message) {
  if (!gameRooms.has(roomCode)) return;
  cancelHostDisconnect(roomCode);
  io.to(roomCode).emit('game-ended', { message });
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.gameCode !== roomCode) continue;
    socket.data.gameCode = null;
    socket.data.playerId = null;
    socket.data.roomOwnerToken = null;
    socket.leave(roomCode);
  }
  gameRooms.delete(roomCode);
  roomOwners.delete(roomCode);
}
function scheduleHostDisconnect(roomCode) {
  cancelHostDisconnect(roomCode);
  const timer = setTimeout(() => {
    const roomExists = gameRooms.has(roomCode);
    if (!roomExists) return hostDisconnectTimers.delete(roomCode);
    const hostOnline = withWorld(roomCode, () => {
      const host = hostId ? players.get(hostId) : null;
      if (host) return host.connected;
      const ownerToken = roomOwners.get(roomCode);
      return [...io.sockets.sockets.values()].some(socket => socket.data.gameCode === roomCode && socket.data.roomOwnerToken === ownerToken);
    });
    if (hostOnline) return hostDisconnectTimers.delete(roomCode);
    endGameRoom(roomCode, 'This game ended because the host did not reconnect in time.');
  }, HOST_DISCONNECT_GRACE_MS);
  hostDisconnectTimers.set(roomCode, timer);
}
function captureWorld() {
  return { players, tokenToPlayerId, alliances, allianceOffers, treaties, spoils, notices, publicMessages, privateMessages, taxLedger, events, houses, capitals, phase, round, hostId, kingPlayerId, handPlayerId, gameSettings, dragonIds, gameOver, startHouseCount };
}
function activateWorld(world) {
  ({ players, tokenToPlayerId, alliances, allianceOffers, treaties, spoils, notices, publicMessages, privateMessages, taxLedger, events, houses, capitals, phase, round, hostId, kingPlayerId, handPlayerId, gameSettings, dragonIds, gameOver, startHouseCount } = world);
}
const initialWorld = structuredClone(captureWorld());
function withWorld(roomCode, callback) {
  const room = gameRooms.get(roomCode);
  if (!room) return null;
  const previous = captureWorld();
  activateWorld(room);
  try { return callback(); }
  finally {
    gameRooms.set(roomCode, captureWorld());
    activateWorld(previous);
  }
}

function findHouse(id) { return houses.find(h => h.id === id) || null; }
function findCapital(id) { return capitals.find(c => c.id === id) || null; }
function houseName(id) { return findHouse(id)?.name || 'Unknown house'; }
function getPlayerForSocket(socket) {
  const id = socket.data.playerId;
  return id ? players.get(id) || null : null;
}
function addEvent(kind, text) {
  events.unshift({ id: randomUUID(), round, kind, text: String(text).slice(0, 400) });
  if (events.length > 80) events.length = 80;
}
function connectedPlayers() { return [...players.values()].filter(p => p.connected && !p.left); }
// Bots no longer recruit automatically; houses only grow when a player recruits.
function recalculateCapitalCounts() {
  for (const h of houses) h.capitalCount = capitals.filter(c => c.ownerHouseId === h.id).length;
}
function playerPublic(p) {
  return { id: p.id, username: p.username, connected: p.connected, left: Boolean(p.left), isBot: Boolean(p.isBot), houseId: p.houseId, isKing: p.id === kingPlayerId, isHand: p.id === handPlayerId, eliminated: Boolean(p.eliminated) };
}
// Every player has their own purse and army (a "wallet" that reads house details through its prototype).
function makeWallet(p) {
  const house = findHouse(p.houseId);
  const w = Object.create(house);
  Object.assign(w, { playerId: p.id, money: 15 + (house.id === 'lannister' ? 5 : 0), infantry: 3, navy: 1, navyBuilding: 0, dragons: house.id === 'targaryen' ? 1 : 0, pendingAttack: null, hasAttackedThisRound: false, commandUsedRound: 0, lockedUntilRound: 0, spyReports: [], ledger: [] });
  p.w = w;
  return w;
}
function houseWallets(houseId) { return houseMembers(houseId).map(p => p.w).filter(Boolean); }
function houseSum(houseId, key) { return houseWallets(houseId).reduce((n, w) => n + (w[key] || 0), 0); }
function loseInfantry(houseId, count, why) {
  let left = count;
  for (const w of houseWallets(houseId)) { const take = Math.min(w.infantry, left); if (!take) continue; w.infantry -= take; left -= take; note(w, 'infantry', -take, why); }
}
// Cities: only the players living in a city earn its income (each gets the full amount); holding a city elsewhere earns nothing.
function residentsOf(c) { return [...players.values()].filter(p => !p.left && !p.eliminated && p.cityId === c.id && p.houseId === c.ownerHouseId); }
function yieldFor(p, c) {
  if (p.left || p.eliminated || !c.ownerHouseId || c.contested) return 0;
  const income = capitalIncome(c);
  if (p.cityId === c.id && p.houseId === c.ownerHouseId) return income;
  return 0;
}
function playerIncome(p) { return capitals.reduce((n, c) => n + yieldFor(p, c), 0); }
function homeCityOf(p) {
  const own = capitals.find(c => c.originalHouseId === p.houseId);
  if (own && own.ownerHouseId === p.houseId && !own.contested) return own;
  return capitals.find(c => c.id !== 'kings-landing' && c.ownerHouseId === p.houseId && !c.contested) || null;
}
// A sacked city: everyone living there is defeated and their gold goes to the victor(s).
function sackCity(c, victorIds) {
  const victors = victorIds.map(id => players.get(id)).filter(p => p && p.w);
  const fallen = [];
  for (const p of players.values()) {
    if (p.left || p.eliminated || p.cityId !== c.id || !p.w) continue;
    const gold = p.w.money || 0;
    if (gold && victors.length) {
      const each = Math.floor(gold / victors.length);
      victors.forEach((v, i) => { const g = each + (i === 0 ? gold - each * victors.length : 0); v.w.money += g; note(v.w, 'gold', g, `Gold of ${p.username}, fallen at ${c.name}`); });
      note(p.w, 'gold', -gold, `Taken when ${c.name} was sacked`);
    }
    p.w.money = 0; p.w.infantry = 0; p.w.navy = 0; p.w.dragons = 0; p.w.pendingAttack = null;
    p.eliminated = true; fallen.push(p);
    notify('attacked', [], [p.id], `${c.name} was sacked`, `Your city fell. You are defeated${gold ? ` and your ${gold} gold goes to the victor` : ''}. You can still watch and speak at court.`, [p.houseId]);
  }
  if (fallen.length) addEvent('important', `${c.name} was sacked. ${fallen.map(p => p.username).join(', ')} ${fallen.length > 1 ? 'were' : 'was'} defeated.`);
  return fallen;
}
function evictResidents(c) { for (const p of players.values()) if (p.cityId === c.id && p.houseId !== c.ownerHouseId) p.cityId = null; }
function incomePerCapital(h) { return 15 + (h.id === 'tyrell' ? 3 : 0); }
function armySize(h) { return h.infantry + h.navy + h.dragons; }
const SPY_MISSIONS = {
  troops: { label: 'Count troops', successBase: 0.35, successPer: 0.045, dangerBase: 0.75, dangerPer: 0.03 },
  movement: { label: 'Watch movements', successBase: 0.35, successPer: 0.045, dangerBase: 0.75, dangerPer: 0.03 },
  ravens: { label: 'Shoot ravens', successBase: 0.15, successPer: 0.04, dangerBase: 0.25, dangerPer: 0.015 },
  mole: { label: 'Place a mole', successBase: 0.15, successPer: 0.04, dangerBase: 0.80, dangerPer: 0.03 }
};
function spyOdds(spend, targetId, mission) {
  const m = SPY_MISSIONS[mission] || SPY_MISSIONS.troops;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return { success: clamp(m.successBase + m.successPer * (spend - 2) - (targetId === 'targaryen' ? 0.15 : 0), 0.05, 0.95), caught: clamp(m.dangerBase - m.dangerPer * (spend - 2), 0.05, 0.9) };
}
function spyFindings(mission, target) {
  if (mission === 'troops') return { infantry: houseSum(target.id, 'infantry'), navy: houseSum(target.id, 'navy'), dragons: houseSum(target.id, 'dragons') };
  if (mission === 'movement') {
    const moving = houseWallets(target.id).find(w => w.pendingAttack);
    const cap = moving ? findCapital(moving.pendingAttack.targetCapitalId) : null;
    return { movingOn: cap?.name || null };
  }
  if (mission === 'ravens') {
    const memberIds = new Set(houseMembers(target.id).map(p => p.id));
    const letters = [];
    for (const m of privateMessages) {
      if (memberIds.has(m.senderId) || (m.targets || []).some(t => memberIds.has(t.id))) letters.push({ from: m.senderName, fromHouseId: m.senderHouseId, to: (m.targets || []).map(t => t.name).join(', '), text: m.message });
    }
    for (const t of treaties) {
      if (t.fromHouseId === target.id || t.toHouseId === target.id) letters.push({ from: `House ${capWord(houseName(t.fromHouseId))}`, fromHouseId: t.fromHouseId, to: `House ${capWord(houseName(t.toHouseId))}`, text: [t.gold && `${t.gold} gold`, t.infantry && `${t.infantry} infantry`, t.navy && `${t.navy} ships`].filter(Boolean).join(', ') + (t.message ? `: ${t.message}` : '') });
    }
    return { letters: letters.slice(-3).reverse() };
  }
  // mole
  const options = [{ kind: 'wealth', gold: houseSum(target.id, 'money') }];
  const secret = alliances.filter(a => a.scope === 'secret' && [a.houseA, a.houseB].includes(target.id)).map(a => (a.houseA === target.id ? a.houseB : a.houseA));
  if (secret.length) options.push({ kind: 'alliance', houses: secret });
  if (gameSettings.gameType === 'LAST_DRAGON') options.push({ kind: 'dragon', houseId: target.id, hasDragon: houseMembers(target.id).some(p => dragonIds.includes(p.id)) });
  return { mole: options[randomInt(0, options.length - 1)] };
}
function capitalIncome(c) { const h = findHouse(c.ownerHouseId); return h ? incomePerCapital(h) + (c.id === 'casterly-rock' ? 3 : 0) : 0; }
function currentHouseView(h) {
  if (!h) return null;
  const { money, infantry, navy, navyBuilding, dragons, infantryCost, navyCost, pendingAttack, hasAttackedThisRound, commandUsedRound, lockedUntilRound, spyReports, ledger, ...definition } = h;
  const members = [...players.values()].filter(p => p.houseId === h.id).map(p => ({ id: p.id, username: p.username, connected: p.connected, left: Boolean(p.left) }));
  return { ...definition, players: members, capitalCount: capitals.filter(c => c.ownerHouseId === h.id).length, fallen: houseFallen(h) };
}
function makePrivateHouseView(h) {
  if (!h) return null;
  const me = h.playerId ? players.get(h.playerId) : null;
  const target = h.pendingAttack ? findCapital(h.pendingAttack.targetCapitalId) : null;
  return {
    id: h.id, name: h.name, fallen: houseFallen(h), money: h.money || 0, infantry: h.infantry || 0, navy: h.navy || 0, navyBuilding: h.navyBuilding || 0, dragons: h.dragons || 0,
    infantryCost: h.infantryCost, navyCost: h.navyCost,
    capitalCount: capitals.filter(c => c.ownerHouseId === h.id).length, incomePerCapital: incomePerCapital(h), incomePerRound: me ? playerIncome(me) : 0, upkeepPerRound: armySize({ infantry: h.infantry || 0, navy: h.navy || 0, dragons: h.dragons || 0 }),
    cityId: me?.cityId || null,
    pendingAttack: h.pendingAttack ? {
      ...h.pendingAttack,
      targetName: target?.name || h.pendingAttack.targetName,
      units: { ...h.pendingAttack.units }
    } : null,
    ledger: (h.ledger || []).map(e => ({ ...e })),
    hasAttackedThisRound: Boolean(h.hasAttackedThisRound),
    commandUsedRound: h.commandUsedRound || 0,
    lockedByEmbargo: (h.lockedUntilRound || 0) >= round,
  };
}
function viewFor(playerId) {
  recalculateCapitalCounts();
  const me = playerId ? players.get(playerId) : null;
  const myHouse = me?.houseId ? findHouse(me.houseId) : null;
  const visibleOffers = allianceOffers.filter(o => o.scope === 'public' || (myHouse && (o.fromHouseId === myHouse.id || o.toHouseId === myHouse.id)))
    .map(o => ({ ...o, isOutgoing: Boolean(myHouse && o.fromHouseId === myHouse.id), canRespond: Boolean(myHouse && o.toHouseId === myHouse.id) }));
  const visibleAlliances = alliances.filter(a => a.scope === 'public' || (myHouse && (a.houseA === myHouse.id || a.houseB === myHouse.id))).map(a => ({ ...a }));
  const privateForMe = me ? privateMessages.filter(m => m.senderId === me.id || (m.targets || []).some(t => t.id === me.id)).map(m => ({
    ...m, senderHouseName: houseName(m.senderHouseId), targets: (m.targets || []).map(t => ({ ...t, name: players.get(t.id)?.username || t.name, houseId: players.get(t.id)?.houseId ?? t.houseId }))
  })) : [];
  return {
    phase, round, hostId, king: kingPlayerId && players.has(kingPlayerId) ? { id: kingPlayerId, username: players.get(kingPlayerId).username } : null,
    hand: handPlayerId && players.has(handPlayerId) ? { id: handPlayerId, username: players.get(handPlayerId).username } : null,
    settings: { ...gameSettings },
    gameOver: gameOver ? { ...gameOver, winners: gameOver.winners } : null,
    dragonsLeft: isLastDragon() ? dragonIds.filter(id => !dragonDefeated(id)).length : null,
    dragon: me && dragonIds.includes(me.id) ? { fellow: dragonList().filter(d => d.id !== me.id) } : null,
    crownOffer: Boolean(me && capitals.some(c => c.vacant && c.offerTo === me.id)),
    throneVacant: capitals.some(c => c.vacant),
    isHost: Boolean(me && me.id === hostId), isKing: Boolean(me && me.id === kingPlayerId), isHand: Boolean(me && me.id === handPlayerId),
    me: me ? { id: me.id, username: me.username, houseId: me.houseId, lastSpyRound: me.lastSpyRound, eliminated: Boolean(me.eliminated) } : null,
    myHouse: makePrivateHouseView(me?.w || myHouse),
    houses: houses.map(currentHouseView),
    players: [...players.values()].map(p => (me && me.id === kingPlayerId ? { ...playerPublic(p), traitor: Boolean(p.traitor) } : playerPublic(p))),
    notices: myHouse ? notices.filter(n => n.playerIds.includes(me.id) || n.houseIds.includes(myHouse.id)).slice(0, 30).map(n => ({ id: n.id, round: n.round, kind: n.kind, title: n.title, text: n.text, banners: [...n.banners] })) : [],
    decrees: myHouse ? taxLedger.filter(d => d.kingPlayerId === me.id || me.id === handPlayerId || d.recipients.some(r => r.houseId === myHouse.id)).slice(0, 20).map(d => {
      const issuer = d.kingPlayerId === me.id;
      return { id: d.id, round: d.round, kingName: d.kingName, kingHouseId: d.kingHouseId, message: d.message, gold: d.gold, infantry: d.infantry, navy: d.navy, isIssuer: issuer, myState: d.recipients.find(r => r.houseId === myHouse.id)?.state || null, recipients: me.id === handPlayerId ? d.recipients.map(r => ({ ...r })) : undefined };
    }) : [],
    capitals: capitals.map(c => ({ ...c, income: capitalIncome(c), residents: residentsOf(c).length })),
    allianceOffers: visibleOffers,
    alliances: visibleAlliances,
    treaties: myHouse ? treaties.filter(t => t.fromHouseId === myHouse.id || t.toHouseId === myHouse.id).map(t => ({ ...t, isOutgoing: t.fromHouseId === myHouse.id })) : [],
    spoils: myHouse ? spoils.filter(x => [x.houseA, x.houseB].includes(myHouse.id)).slice(0, 10).map(x => ({ ...x, claims: { ...x.claims }, capitalName: findCapital(x.capitalId)?.name || '' })) : [],
    publicMessages: publicMessages.map(m => ({ ...m })),
    privateMessages: privateForMe,
    spyReports: me?.w ? me.w.spyReports.map(r => ({ ...r })) : [],
    events: events.map(e => ({ ...e }))
  };
}
function broadcastState(roomCode) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.gameCode === roomCode) socket.emit('state', viewFor(socket.data.playerId || null));
  }
}
function ack(callback, result) {
  if (typeof callback === 'function') callback(result);
}
function fail(message) { return { ok: false, message }; }
function ok(message) { return { ok: true, message }; }
function action(socket, eventName, handler) {
  socket.on(eventName, (payload = {}, callback) => {
    try {
      const roomCode = socket.data.gameCode;
      if (!roomCode) return ack(callback, fail('Create or join a game before continuing.'));
      const result = withWorld(roomCode, () => {
        const player = getPlayerForSocket(socket);
        const outcome = handler(player, payload || {}, socket);
        if (outcome?.ok !== false) broadcastState(roomCode);
        return outcome;
      });
      ack(callback, result || fail('That game room is no longer available.'));
    } catch (error) {
      console.error(`Action ${eventName} failed:`, error);
      ack(callback, fail('The server could not complete that action. Try again.'));
    }
  });
}

// ---- Win conditions -------------------------------------------------------
function dragonSettings(payload, maxPlayers, gameType) {
  if (gameType !== 'LAST_DRAGON') return { dragonCount: 1, dragonRounds: 5 };
  const dragonCount = Number(payload.dragonCount ?? 1), dragonRounds = Number(payload.dragonRounds ?? 5);
  const most = Math.max(1, Math.floor(maxPlayers / 2));
  if (!Number.isInteger(dragonCount) || dragonCount < 1 || dragonCount > most) return { error: `Choose 1 to ${most} Dragons for a ${maxPlayers}-player game.` };
  if (!Number.isInteger(dragonRounds) || dragonRounds < 1 || dragonRounds > 30) return { error: 'Choose how many rounds the Dragons must survive (1 to 30).' };
  return { dragonCount, dragonRounds };
}
const isLastDragon = () => gameSettings.gameType === 'LAST_DRAGON';
function holdsCapital(h) { return capitals.some(c => c.ownerHouseId === h.id || (c.contested && (c.contested.houseA === h.id || c.contested.houseB === h.id))); }
function houseFallen(h) {
  if (!h || ['LOBBY', 'HAND_SELECTION'].includes(phase)) return false;
  const mem = [...players.values()].filter(p => p.houseId === h.id && !p.left);
  return !holdsCapital(h) || (mem.length > 0 && mem.every(p => p.eliminated));
}
function dragonList() { return dragonIds.map(id => players.get(id)).filter(Boolean).map(p => ({ id: p.id, username: p.username, houseId: p.houseId })); }
function dragonDefeated(id) { const p = players.get(id); return !p || p.left || p.eliminated || houseFallen(findHouse(p.houseId)); }
function endGame(type, winnerHouseId, text) {
  const winners = type === 'CLASSIC' ? houseMembers(winnerHouseId).map(p => p.username) : [];
  gameOver = { type, winnerHouseId: winnerHouseId || null, text, winners, dragons: isLastDragon() ? dragonList() : [] };
  addEvent('important', text);
}
// King's Landing is the Iron Throne. Whoever takes it eliminates the king and the Hand and becomes king;
// the new king then names any Hand they like.
function throneTaken(houseId, orderedBy) {
  const house = findHouse(houseId); if (!house) return;
  const members = houseMembers(houseId).filter(p => !p.eliminated);
  const humans = members.filter(p => !p.isBot);
  const pool = humans.length ? humans : members;
  if (!pool.length) return;
  const ordered = orderedBy ? players.get(orderedBy) : null;
  const heir = ordered && pool.some(p => p.id === ordered.id) ? ordered : pool[randomInt(0, pool.length - 1)];
  const fallen = [];
  for (const id of [kingPlayerId, handPlayerId]) {
    const p = id ? players.get(id) : null;
    if (p && p.id !== heir.id && !p.eliminated) { p.eliminated = true; fallen.push(p.username); }
  }
  kingPlayerId = heir.id;
  handPlayerId = null;
  const seat = capitals.find(c => c.id === 'kings-landing'); const wasVacant = Boolean(seat?.vacant);
  if (seat) { seat.vacant = false; seat.offerTo = null; seat.ownerPlayerId = heir.id; seat.ownerHouseId = heir.houseId || seat.ownerHouseId; evictResidents(seat); }
  heir.cityId = 'kings-landing';
  addEvent('important', `House ${capWord(house.name)} took King’s Landing. ${heir.username} is the new king${fallen.length ? `; ${fallen.join(' and ')} ${fallen.length > 1 ? 'were' : 'was'} eliminated` : ''}.`);
  if (wasVacant) notifyAll('crown', 'A new king', `${heir.username} of House ${capWord(house.name)} took the empty throne and is now king.`, [houseId]);
  notify('battle-won', [houseId], [], 'The Iron Throne is yours', `You hold King’s Landing and wear the crown. Appoint a Hand of the King from the Relations menu.`, [houseId]);
}
function checkVictory(endOfRound) {
  if (gameOver || !['ACTION', 'COURT', 'RESOLUTION'].includes(phase)) return;
  if (isLastDragon()) {
    if (dragonIds.length && dragonIds.every(dragonDefeated)) return endGame('REALM', null, 'The last Dragon has fallen. The realm is saved and the whole realm wins.');
    if (dragonIds.includes(kingPlayerId)) return endGame('DRAGONS', null, `${players.get(kingPlayerId)?.username || 'A Dragon'} has taken the Iron Throne. The Dragons win.`);
    if (endOfRound && round >= gameSettings.dragonRounds) return endGame('DRAGONS', null, `The Dragons survived ${gameSettings.dragonRounds} rounds. The Dragons win.`);
    return;
  }
  if (startHouseCount < 2) return;
  const standing = houses.filter(h => houseMembers(h.id).filter(p => !p.eliminated).length && !houseFallen(h));
  if (standing.length === 1) endGame('CLASSIC', standing[0].id, `House ${capWord(standing[0].name)} has defeated every other house and wins the game.`);
}
function requirePlayer(player) { return player || fail('Enter the realm before taking that action.'); }
function requireHouse(player) {
  if (!player) return fail('Enter the realm before taking that action.');
  const h = player.houseId ? findHouse(player.houseId) : null;
  if (h && gameOver) return fail('The game is over.');
  if (h && player.eliminated) return fail('You have been eliminated. You can still watch and speak at court.');
  if (h && houseFallen(h)) return fail('Your house has fallen. You can still watch and speak at court.');
  return (h && player.w) || h || fail('Choose a house first.');
}
const isTeams = () => gameSettings.gameType === 'TEAMS';
const MODE_LABEL = { CLASSIC: 'Classic', LAST_DRAGON: 'Last Dragon', TEAMS: 'Teams' };
// Validates host setup. Classic: up to 8 players, one house each. Last Dragon: up to 7 (no Targaryen). Teams: 2-4 per house.
function parseSettings(payload) {
  const gameType = String(payload.gameType || '');
  if (!MODE_LABEL[gameType]) return { error: 'Choose Classic, Teams or Last Dragon.' };
  const maxPlayers = Number(payload.maxPlayers);
  const lo = gameType === 'TEAMS' ? 4 : 3, hi = gameType === 'CLASSIC' ? 8 : gameType === 'LAST_DRAGON' ? 7 : 16;
  if (!Number.isInteger(maxPlayers) || maxPlayers < lo || maxPlayers > hi) return { error: `Choose a player limit from ${lo} to ${hi}.` };
  let teamSize = 2;
  if (gameType === 'TEAMS') {
    teamSize = Number(payload.teamSize ?? 2);
    if (!Number.isInteger(teamSize) || teamSize < 2 || teamSize > 4) return { error: 'Choose a team size from 2 to 4.' };
    if (maxPlayers > houses.length * teamSize) return { error: `${houses.length} teams of ${teamSize} hold at most ${houses.length * teamSize} players.` };
  }
  const ds = dragonSettings(payload, maxPlayers, gameType); if (ds.error) return ds;
  return { configured: true, maxPlayers, gameType, teamSize, dragonCount: ds.dragonCount, dragonRounds: ds.dragonRounds, friendlyFire: payload.friendlyFire !== false };
}
// Existing players must fit the chosen mode.
function settingsConflict(next) {
  const active = [...players.values()].filter(p => !p.left);
  if (active.length > next.maxPlayers) return `The player limit cannot be lower than the ${active.length} players already joined.`;
  const by = {}; for (const p of active) if (p.houseId) by[p.houseId] = (by[p.houseId] || 0) + 1;
  if (next.gameType === 'TEAMS') { if (Object.values(by).some(n => n > next.teamSize)) return `A team already has more than ${next.teamSize} players.`; }
  else if (Object.values(by).some(n => n > 1)) return 'Two players share a house. Each player needs their own house in this mode.';
  if (next.gameType === 'LAST_DRAGON' && by.targaryen) return 'Someone already chose House Targaryen, which is not available in Last Dragon. Ask them to pick another house first.';
  return null;
}
// Returns an error message if `playerId` may not take house `h`, otherwise null.
function houseError(h, playerId) {
  const others = [...players.values()].filter(p => !p.left && p.houseId === h.id && p.id !== playerId).length;
  if (isTeams()) {
    if (others >= gameSettings.teamSize) return `Team ${h.name} is full (${gameSettings.teamSize} players).`;
    const maxTeams = Math.ceil(gameSettings.maxPlayers / gameSettings.teamSize);
    const used = new Set([...players.values()].filter(p => !p.left && p.houseId && p.id !== playerId).map(p => p.houseId));
    if (!others && used.size >= maxTeams) return `All ${maxTeams} teams are formed. Join an existing team.`;
    return null;
  }
  return others ? `House ${h.name} is already taken.` : null;
}
// Names only have to be unique inside one lobby.
function nameTaken(name, exceptId) { const n = String(name).toLowerCase(); return [...players.values()].some(p => !p.left && p.id !== exceptId && p.username.toLowerCase() === n); }
const nameTakenMsg = name => `The name “${name}” is already used in this lobby. Choose a different one.`;
function isHost(player) { return Boolean(player && player.id === hostId); }
function canDiplomacy() { return phase === 'ACTION' || phase === 'COURT'; }
function houseMembers(houseId) { return [...players.values()].filter(p => p.houseId === houseId && !p.left); }
function houseIsBotOnly(houseId) { const m = houseMembers(houseId); return m.length > 0 && m.every(p => p.isBot); }
function areAllied(a, b) { return alliances.some(x => [x.houseA, x.houseB].includes(a) && [x.houseA, x.houseB].includes(b)); }
function wholeNumber(value) { const n = Number(value || 0); return Number.isInteger(n) && n >= 0 ? n : null; }
function closeTreaty(t, status, byPlayerId) {
  const recipient = status === 'accepted' ? (players.get(byPlayerId) || houseMembers(t.toHouseId)[0]) : (players.get(t.fromPlayerId) || houseMembers(t.fromHouseId)[0]);
  const receiver = recipient?.w;
  if (receiver) {
    receiver.money += t.gold; receiver.infantry += t.infantry; receiver.navy += t.navy;
    const why = status === 'accepted' ? `Treaty from House ${houseName(t.fromHouseId)}` : `Treaty to House ${houseName(t.toHouseId)} ${status === 'declined' ? 'declined' : 'withdrawn'}: returned`;
    note(receiver, 'gold', t.gold, why); note(receiver, 'infantry', t.infantry, why); note(receiver, 'navy', t.navy, why);
  }
  t.status = status;
  t.closedRound = round;
  const settled = treaties.filter(x => x.status !== 'pending');
  if (settled.length > 30) for (const old of settled.slice(30)) treaties.splice(treaties.indexOf(old), 1);
}
function note(h, res, delta, text) {
  if (!h || !delta) return;
  h.ledger = h.ledger || [];
  h.ledger.unshift({ id: randomUUID(), round, res, delta, text: String(text).slice(0, 160) });
  if (h.ledger.length > 120) h.ledger.length = 120;
}
// Pop-up notices (alliances, traitor labels, attacks, battle results) addressed to houses or individual players.
function capWord(t) { return String(t || '').replace(/^\w/, c => c.toUpperCase()); }
function notifyAll(kind, title, text, banners) { notify(kind, [], [...players.values()].filter(p => !p.left).map(p => p.id), title, text, banners); }
function notify(kind, houseIds, playerIds, title, text, banners) {
  notices.unshift({ id: randomUUID(), round, kind, houseIds: [...new Set(houseIds)], playerIds, title, text: String(text).slice(0, 260), banners });
  if (notices.length > 60) notices.length = 60;
}
function forceStrength(u) { return u.infantry + u.navy + u.dragons * 5 + (u.dragons ? 2 : 0); }
function giveSpoil(s, winnerId, how) {
  const cap = findCapital(s.capitalId);
  if (cap) {
    cap.ownerHouseId = winnerId; cap.contested = null;
    const ordered = s.orderers?.[winnerId] ? players.get(s.orderers[winnerId]) : null;
    cap.ownerPlayerId = (ordered && ordered.houseId === winnerId ? ordered : houseMembers(winnerId)[0])?.id || null;
    evictResidents(cap);
  }
  if (cap?.id === 'kings-landing') throneTaken(winnerId, s.orderers?.[winnerId]);
  s.status = 'settled'; s.winnerId = winnerId;
  addEvent('battle', `${cap?.name || 'The captured capital'} now belongs to House ${houseName(winnerId)} ${how}.`);
}
function settleSpoils(forced) {
  for (const s of spoils) {
    if (s.status !== 'open') continue;
    const [a, b] = [s.houseA, s.houseB];
    if (s.claims[a] && s.claims[a] === s.claims[b]) { giveSpoil(s, s.claims[a], 'by agreement of the allies'); continue; }
    if (!forced || s.deadlineRound > round) continue;
    const ha = findHouse(a), hb = findHouse(b);
    const sa = forceStrength({ infantry: houseSum(a, 'infantry'), navy: houseSum(a, 'navy'), dragons: houseSum(a, 'dragons') }) + randomInt(0, 6);
    const sb = forceStrength({ infantry: houseSum(b, 'infantry'), navy: houseSum(b, 'navy'), dragons: houseSum(b, 'dragons') }) + randomInt(0, 6);
    const winner = sa >= sb ? ha : hb, loser = winner === ha ? hb : ha;
    const lost = Math.ceil(houseSum(loser.id, 'infantry') * 0.25);
    loseInfantry(loser.id, lost, 'Lost fighting an ally over the spoils');
    const al = alliances.find(x => [x.houseA, x.houseB].includes(a) && [x.houseA, x.houseB].includes(b));
    if (al) alliances.splice(alliances.indexOf(al), 1);
    notify('alliance-broken', [a, b], [], 'Allies at war', `House ${capWord(winner.name)} won the fight over the spoils; House ${capWord(loser.name)} lost, and the alliance is broken.`, [winner.id, loser.id]);
    giveSpoil(s, winner.id, `after the former allies fought over it (${Math.max(sa, sb)} vs. ${Math.min(sa, sb)}); House ${loser.name} lost ${lost} infantry and the alliance is broken`);
  }
}
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

io.on('connection', socket => {
  socket.data.playerId = null;
  socket.data.gameCode = null;
  socket.on('create-game-room', (payload = {}, callback) => {
    const ownerToken = String(payload.clientToken || '');
    if (ownerToken.length < 16 || ownerToken.length > 200) return ack(callback, fail('Your browser session token is invalid. Refresh and try again.'));
    if (socket.data.gameCode) socket.leave(socket.data.gameCode);
    let pin;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
      const bytes = randomBytes(4);
      pin = [...bytes].map(byte => alphabet[byte & 31]).join('');
    } while (gameRooms.has(pin));
    gameRooms.set(pin, structuredClone(initialWorld));
    roomOwners.set(pin, ownerToken);
    socket.data.gameCode = pin;
    socket.data.playerId = null;
    socket.data.roomOwnerToken = ownerToken;
    socket.join(pin);
    withWorld(pin, () => socket.emit('state', viewFor(null)));
    ack(callback, { ...ok('Game created.'), pin });
  });

  socket.on('join-game-room', ({ pin: requestedPin, clientToken } = {}, callback) => {
    const pin = String(requestedPin || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (!gameRooms.has(pin)) return ack(callback, fail('No game was found with that PIN. Check it and try again.'));
    if (socket.data.gameCode) socket.leave(socket.data.gameCode);
    socket.data.gameCode = pin;
    socket.data.playerId = null;
    socket.data.roomOwnerToken = String(clientToken || '') === roomOwners.get(pin) ? String(clientToken) : null;
    socket.join(pin);
    if (socket.data.roomOwnerToken) cancelHostDisconnect(pin);
    withWorld(pin, () => socket.emit('state', viewFor(null)));
    ack(callback, { ...ok('Joined the game.'), pin });
  });

  socket.on('check-room', ({ pin: requestedPin } = {}, callback) => {
    const pin = String(requestedPin || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    ack(callback, gameRooms.has(pin) ? ok('Game found.') : fail('Game not found.'));
  });

  socket.on('request-state', () => {
    const roomCode = socket.data.gameCode;
    if (!roomCode) return socket.emit('state', viewFor(null));
    withWorld(roomCode, () => socket.emit('state', viewFor(socket.data.playerId || null)));
  });

  socket.on('set-room-settings', (payload = {}, callback) => {
    const roomCode = socket.data.gameCode;
    if (!roomCode || roomOwners.get(roomCode) !== String(payload.clientToken || '') || socket.data.roomOwnerToken !== String(payload.clientToken || '')) return ack(callback, fail('Only the game host can prepare this room.'));
    withWorld(roomCode, () => {
      if (phase !== 'LOBBY') return ack(callback, fail('Game setup is closed after the game begins.'));
      if (gameSettings.configured) return ack(callback, fail('This game has already been prepared.'));
      const next = parseSettings(payload); if (next.error) return ack(callback, fail(next.error));
      gameSettings = next;
      addEvent('important', `The host set up a ${MODE_LABEL[next.gameType]} game for ${next.maxPlayers} players.`);
      broadcastState(roomCode);
      ack(callback, ok('Game prepared. Choose your house to continue.'));
    });
  });

  socket.on('login', (payload = {}, callback) => {
    const roomCode = socket.data.gameCode;
    if (!roomCode) return ack(callback, fail('Create or join a game before entering the realm.'));
    const result = withWorld(roomCode, () => {
      const name = String(payload.username || '').trim().replace(/\s+/g, ' ');
      const token = String(payload.clientToken || '');
      if (name.length < 2 || name.length > 22) return fail('Name must be between 2 and 22 characters.');
      if (token.length < 16 || token.length > 200) return fail('This browser session token is invalid. Refresh the page and try again.');

      let playerId = tokenToPlayerId.get(token);
      let player = playerId ? players.get(playerId) : null;
      if (nameTaken(name, player?.id)) return fail(nameTakenMsg(name));
      let isNew = false;
      if (!player) {
        if (!hostId && roomOwners.get(roomCode) !== token) return fail('Waiting for the host to enter the game. Try again in a moment.');
        if (hostId && !gameSettings.configured) return fail('The host is setting up the game. Try joining again in a moment.');
        if (phase !== 'LOBBY') return fail('This game has already started.');
        if (gameSettings.configured && [...players.values()].filter(existing => !existing.left).length >= gameSettings.maxPlayers) return fail('This game is full.');
        playerId = randomUUID();
        player = { id: playerId, username: name, token, houseId: null, lastSpyRound: 0, connected: true, left: false, socketId: socket.id };
        players.set(playerId, player);
        tokenToPlayerId.set(token, playerId);
        isNew = true;
        if (!hostId) hostId = playerId;
        addEvent('normal', `${name} entered the realm.`);
      } else {
        player.username = name;
        player.connected = true;
        player.left = false;
        player.socketId = socket.id;
        if (player.houseId && phase === 'LOBBY') {
          const h = findHouse(player.houseId);
          if (h) player.houseId = h.id;
        }
      }
      socket.data.playerId = playerId;
      if (playerId === hostId || token === roomOwners.get(roomCode)) cancelHostDisconnect(roomCode);
      broadcastState(roomCode);
      return ok(isNew ? 'Welcome to the realm.' : 'Welcome back. Your browser session was restored.');
    });
    ack(callback, result || fail('That game room is no longer available.'));
  });

  socket.on('logout-player', (_payload, callback) => {
    const roomCode = socket.data.gameCode;
    if (!roomCode) return ack(callback, ok('Signed out.'));
    let hostSignedOut = false;
    let noHost = false;
    withWorld(roomCode, () => {
      const player = getPlayerForSocket(socket);
      if (player && player.socketId === socket.id) {
        player.connected = false;
        player.left = true;
        player.socketId = null;
        hostSignedOut = player.id === hostId;
      }
      noHost = !hostId;
      socket.data.playerId = null;
      if (socket.data.roomOwnerToken) socket.data.roomOwnerToken = null;
      broadcastState(roomCode);
    });
    if (hostSignedOut || (roomOwners.get(roomCode) && noHost)) endGameRoom(roomCode, 'The host left. This game has ended.');
    ack(callback, ok('Signed out.'));
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.gameCode;
    if (!roomCode) return;
    let wasHost = false;
    let noHost = false;
    const wasRoomOwner = Boolean(socket.data.roomOwnerToken && socket.data.roomOwnerToken === roomOwners.get(roomCode));
    withWorld(roomCode, () => {
      const player = getPlayerForSocket(socket);
      noHost = !hostId;
      if (!player || player.socketId !== socket.id) return;
      player.connected = false;
      player.socketId = null;
      wasHost = player.id === hostId;
      broadcastState(roomCode);
    });
    if (wasHost || (wasRoomOwner && noHost)) scheduleHostDisconnect(roomCode);
  });

  action(socket, 'select-house', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (phase !== 'LOBBY') return fail('House selection is closed after the lobby.');
    const h = findHouse(String(payload.houseId || '')); if (!h) return fail('That house does not exist.');
    if (isLastDragon() && h.id === 'targaryen') return fail('House Targaryen is not available in Last Dragon. The Dragons are hidden among the players.');
    const taken = houseError(h, player.id); if (taken) return fail(taken);
    const previous = player.houseId;
    player.houseId = h.id;
    if (previous !== h.id) addEvent('normal', `${player.username} joined House ${h.name}.`);
    return ok(`You have joined House ${h.name}.`);
  });

  action(socket, 'set-game-settings', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can set up this game.');
    if (phase !== 'LOBBY') return fail('Game setup is closed after the game begins.');
    const next = parseSettings(payload); if (next.error) return fail(next.error);
    const conflict = settingsConflict(next); if (conflict) return fail(conflict);
    gameSettings = next;
    addEvent('important', `The host set up a ${MODE_LABEL[next.gameType]} game for ${next.maxPlayers} players.`);
    return ok('Game setup saved. The hall is open.');
  });

  action(socket, 'edit-player-name', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (phase !== 'LOBBY') return fail('Names can only be changed in the lobby.');
    const name = String(payload.username || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 22) return fail('Name must be between 2 and 22 characters.');
    if (nameTaken(name, player.id)) return fail(nameTakenMsg(name));
    player.username = name;
    return ok('Your name has been updated.');
  });

  action(socket, 'add-bot', (player) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can add a bot.');
    if (phase !== 'LOBBY') return fail('Bots can only be added in the lobby.');
    if (!gameSettings.configured) return fail('Finish game setup before adding bots.');
    if ([...players.values()].filter(existing => !existing.left).length >= gameSettings.maxPlayers) return fail('The game is full.');
    const usedNames = new Set([...players.values()].map(existing => existing.username));
    let botNumber = 1;
    while (usedNames.has(`Bot ${botNumber}`)) botNumber += 1;
    const activeMembers = houseId => [...players.values()].filter(existing => !existing.left && existing.houseId === houseId);
    const open = houses.filter(candidate => !houseError(candidate, null) && !(isLastDragon() && candidate.id === 'targaryen'));
    if (!open.length) return fail('No house is open for a bot.');
    const house = isTeams() ? [...open].sort((a, b) => (activeMembers(a.id).length === 0) - (activeMembers(b.id).length === 0) || activeMembers(a.id).length - activeMembers(b.id).length)[0] : open[randomInt(0, open.length - 1)];
    const bot = { id: randomUUID(), username: `Bot ${botNumber}`, token: `bot-${randomUUID()}`, houseId: house.id, lastSpyRound: 0, connected: true, left: false, isBot: true, socketId: null };
    players.set(bot.id, bot);
    addEvent('normal', `${bot.username} joined House ${house.name}.`);
    return ok(`${bot.username} joined the lobby as House ${house.name}.`);
  });

  action(socket, 'edit-bot', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can edit a bot.');
    if (phase !== 'LOBBY') return fail('Bots can only be edited in the lobby.');
    const bot = players.get(String(payload.botId || ''));
    if (!bot || !bot.isBot || bot.left) return fail('That bot is no longer in the lobby.');
    const name = String(payload.username || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 22) return fail('Name must be between 2 and 22 characters.');
    const h = findHouse(String(payload.houseId || '')); if (!h) return fail('That house does not exist.');
    const taken = houseError(h, bot.id); if (taken) return fail(taken);
    if (nameTaken(name, bot.id)) return fail(nameTakenMsg(name));
    const previousName = bot.username;
    const previousHouse = bot.houseId;
    bot.username = name;
    bot.houseId = h.id;
    if (previousHouse !== h.id) addEvent('normal', `${name} moved to House ${h.name}.`);
    else if (previousName !== name) addEvent('normal', `${previousName} is now called ${name}.`);
    return ok(`${name} updated.`);
  });

  action(socket, 'remove-bot', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can remove a bot.');
    if (phase !== 'LOBBY') return fail('Bots can only be removed in the lobby.');
    const bot = players.get(String(payload.botId || ''));
    if (!bot || !bot.isBot) return fail('That bot is no longer in the lobby.');
    players.delete(bot.id);
    addEvent('normal', `${bot.username} left the lobby.`);
    return ok(`${bot.username} was removed.`);
  });

  action(socket, 'kick-player', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can remove a player.');
    if (phase !== 'LOBBY') return fail('Players can only be removed in the lobby.');
    const target = players.get(String(payload.playerId || ''));
    if (!target || target.isBot) return fail('That player is no longer in the lobby.');
    if (target.id === player.id) return fail('You cannot remove yourself.');
    const sock = target.socketId ? io.sockets.sockets.get(target.socketId) : null;
    players.delete(target.id);
    if (sock) {
      sock.data.playerId = null;
      sock.data.gameCode = null;
      sock.leave(socket.data.gameCode);
      sock.emit('game-ended', { message: 'The host removed you from the game.' });
    }
    addEvent('normal', `${target.username} was removed by the host.`);
    return ok(`${target.username} was removed.`);
  });

  action(socket, 'start-game', player => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the lobby host can begin the game.');
    if (phase !== 'LOBBY') return fail('The game has already left the lobby.');
    if (!gameSettings.configured) return fail('The host must finish game setup first.');
    const connected = connectedPlayers();
    if (connected.length < 2) return fail('At least two players are needed so the king can appoint a Hand.');
    if (connected.some(p => !p.houseId)) return fail('Everyone connected must choose a house before the game begins.');
    const humans = connected.filter(p => !p.isBot);
    if (!humans.length) return fail('A human player is needed to be the first king. Bots cannot be king.');
    if (isTeams()) {
      const sizes = houses.map(h => ({ h, n: connected.filter(p => p.houseId === h.id).length })).filter(x => x.n > 0);
      if (sizes.length < 2) return fail('Teams mode needs at least 2 teams.');
      const need = Math.ceil(connected.length / gameSettings.teamSize);
      if (sizes.length !== need) return fail(`With ${connected.length} players and teams of ${gameSettings.teamSize}, there must be ${need} teams. Right now there ${sizes.length === 1 ? 'is 1' : `are ${sizes.length}`}.`);
      const most = Math.max(...sizes.map(x => x.n)), least = Math.min(...sizes.map(x => x.n));
      if (most - least > 1) return fail(`Teams must be as even as possible. ${sizes.filter(x => x.n === most).map(x => x.h.name).join(', ')} ${most === 1 ? 'has' : 'have'} ${most}; ${sizes.filter(x => x.n === least).map(x => x.h.name).join(', ')} ${least === 1 ? 'has' : 'have'} ${least}.`);
    }
    if (isLastDragon() && connected.length < 3) return fail('Last Dragon needs at least 3 players: a king, a Dragon and someone loyal to the realm.');
    if (isLastDragon() && connected.some(p => p.houseId === 'targaryen')) return fail('House Targaryen is not available in Last Dragon. Ask that player to choose another house.');
    const royal = humans.filter(p => p.houseId === 'baratheon');
    const kingPool = royal.length ? royal : humans;
    kingPlayerId = kingPool[randomInt(0, kingPool.length - 1)].id;
    const king = players.get(kingPlayerId);
    const throne = capitals.find(c => c.id === 'kings-landing'); if (throne) throne.ownerHouseId = king?.houseId || 'baratheon';
    startHouseCount = new Set(connected.map(p => p.houseId)).size;
    for (const p of players.values()) if (!p.left && p.houseId) { makeWallet(p); p.cityId = capitals.find(c => c.originalHouseId === p.houseId)?.id || null; }
    for (const c of capitals) { c.ownerPlayerId = c.originalHouseId ? (houseMembers(c.originalHouseId)[0]?.id || null) : null; }
    if (throne) throne.ownerPlayerId = kingPlayerId;
    if (king && throne) king.cityId = 'kings-landing';
    dragonIds = [];
    if (isLastDragon()) {
      const pool = connected.filter(p => p.id !== kingPlayerId);
      for (let i = 0; (i < gameSettings.dragonCount && pool.length > 1) || (i === 0 && pool.length); i++) dragonIds.push(pool.splice(randomInt(0, pool.length - 1), 1)[0].id);
      addEvent('important', `${dragonIds.length} secret Dragon${dragonIds.length === 1 ? '' : 's'} walk among the players. They win by surviving ${gameSettings.dragonRounds} rounds or taking the Iron Throne.`);
    }
    if (king?.isBot) {
      const candidates = connected.filter(candidate => candidate.id !== king.id);
      handPlayerId = candidates[randomInt(0, candidates.length - 1)].id;
      phase = 'ACTION';
      round = 1;
      for (const h of houses) h.hasAttackedThisRound = false;
      addEvent('important', `${king.username} appointed ${players.get(handPlayerId).username} as Hand of the King.`);
      addEvent('important', 'Round 1 begins. The game is underway.');
      return ok(`${king.username} appointed the Hand of the King. Round 1 begins.`);
    }
    handPlayerId = null;
    phase = 'HAND_SELECTION';
    addEvent('important', `${players.get(kingPlayerId)?.username || 'A player'} was chosen at random as the first king.`);
    return ok(`${players.get(kingPlayerId)?.username || 'A player'} is the first king. They must appoint a Hand of the King.`);
  });

  action(socket, 'replace-hand', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!canDiplomacy()) return fail('A new Hand can be named during the action and court phases.');
    if (player.id !== kingPlayerId) return fail('Only the king can appoint the Hand of the King.');
    const target = players.get(String(payload.playerId || ''));
    if (!target || target.left) return fail('Choose a player who is still in the game.');
    if (target.id === player.id) return fail('The king cannot appoint themself as the Hand of the King.');
    if (target.eliminated) return fail('That player has been eliminated.');
    if (target.id === handPlayerId) return fail(`${target.username} is already the Hand of the King.`);
    handPlayerId = target.id;
    addEvent('important', `${player.username} appointed ${target.username} as the new Hand of the King.`);
    return ok(`${target.username} is now the Hand of the King.`);
  });

  action(socket, 'appoint-hand', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (phase !== 'HAND_SELECTION') return fail('The king is not choosing a Hand right now.');
    if (player.id !== kingPlayerId) return fail('Only the king can appoint the Hand of the King.');
    const targetId = String(payload.playerId || '');
    const target = players.get(targetId);
    if (!target) return fail('Choose a player who has joined this game.');
    if (target.id === player.id) return fail('The king cannot appoint themself as the Hand of the King.');
    if (target.left) return fail('Choose a player who has not left the game.');
    handPlayerId = target.id;
    addEvent('important', `${player.username} appointed ${target.username} as Hand of the King.`);
    phase = 'ACTION';
    round = 1;
    for (const h of houses) h.hasAttackedThisRound = false;
    addEvent('important', 'Round 1 begins. The game is underway.');
    return ok(`${target.username} is the Hand of the King. Round 1 begins.`);
  });

  action(socket, 'purchase', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (phase !== 'ACTION') return fail('Recruitment is only available during the action phase.');
    if (check.lockedUntilRound >= round) return fail('A royal embargo blocks recruitment this round.');
    const h = check;
    const unit = payload.unit;
    const amount = Number(payload.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 10) return fail('Choose a whole number of units between 1 and 10.');
    if (!['infantry', 'navy'].includes(unit)) return fail('That unit type is not available.');
    const cost = unit === 'infantry' ? h.infantryCost : h.navyCost;
    const total = cost * amount;
    if (h.money < total) return fail(`This purchase costs ${total} gold, but your house has ${h.money}.`);
    h.money -= total;
    // Ships take one day (until the next round) to build; once built they can sail and fight at once.
    if (unit === 'navy') h.navyBuilding = (h.navyBuilding || 0) + amount; else h[unit] += amount;
    note(h, 'gold', -total, `Recruited ${amount} ${unit === 'navy' ? 'ships' : 'infantry'}`); if (unit !== 'navy') note(h, unit, amount, 'Recruited');
    addEvent('normal', `House ${h.name} recruited ${amount} ${unit === 'navy' ? 'ships' : 'infantry'}.`);
    return ok(unit === 'navy' ? `${amount} ships ordered. They will be built by the next round.` : `Recruited ${amount} infantry.`);
  });

  action(socket, 'disband', (player, payload) => {
    const h = requireHouse(player); if (h.ok === false) return h;
    if (phase !== 'ACTION') return fail('Units can be disbanded during the action phase.');
    const unit = String(payload.unit || '');
    if (!['infantry', 'navy', 'dragons'].includes(unit)) return fail('Choose a unit type to disband.');
    const amount = Number(payload.amount);
    if (!Number.isInteger(amount) || amount < 1) return fail('Choose a whole number of units to disband.');
    if (amount > h[unit]) return fail(`You only have ${h[unit]} ${unit}.`);
    h[unit] -= amount;
    note(h, unit, -amount, 'Disbanded');
    addEvent('normal', `House ${h.name} disbanded some of its troops.`);
    return ok(`Disbanded ${amount} ${unit === 'navy' ? 'ships' : unit}.`);
  });

  action(socket, 'spy', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    const h = check;
    if (phase !== 'ACTION') return fail('Spies can only be sent during the action phase.');
    if (player.lastSpyRound === round) return fail('You have already sent spies this round.');
    const target = findHouse(String(payload.targetHouseId || ''));
    if (!target || target.id === h.id) return fail('Choose another house as your target.');
    if (!houseMembers(target.id).length) return fail('That house has no players in this game.');
    const spend = Number(payload.spend ?? 8);
    if (!Number.isInteger(spend) || spend < 2 || spend > 20) return fail('Spend between 2 and 20 gold on a spy mission.');
    const spendCost = spend;
    if (h.money < spendCost) return fail(`You chose to spend ${spend} gold, but your house only has ${h.money}.`);
    h.money -= spendCost;
    note(h, 'gold', -spendCost, `Spy mission against House ${target.name}`);
    player.lastSpyRound = round;
    const mission = SPY_MISSIONS[payload.mission] ? payload.mission : 'troops';
    const odds = spyOdds(spend, target.id, mission);
    const success = Math.random() < odds.success;
    const caught = !success && Math.random() < odds.caught;
    const report = { id: randomUUID(), targetHouseId: target.id, targetName: target.name, round, mission, success, caught, spent: spend, ...(success ? { findings: spyFindings(mission, target) } : {}) };
    h.spyReports.unshift(report);
    if (h.spyReports.length > 15) h.spyReports.length = 15;
    addEvent('normal', caught ? `Spies were caught in House ${target.name}'s halls.` : `House ${h.name} sent spies toward House ${target.name}.`);
    if (caught) notify('spy-caught', [target.id], [], 'Spies caught', `Agents of House ${capWord(h.name)} were caught spying on your house.`, [h.id, target.id]);
    return ok(caught ? `Your spies were captured. House ${target.name} knows it was you.` : success ? `Your spies returned with intelligence from House ${target.name}.` : `Your spy mission against House ${target.name} failed.`);
  });

  // The king may forfeit the crown: he returns to his home city and the Hand chooses whether to take it.
  action(socket, 'forfeit-crown', (player) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (player.id !== kingPlayerId) return fail('Only the king can forfeit the crown.');
    if (phase !== 'ACTION') return fail('You can forfeit the crown during the action phase.');
    const home = homeCityOf(player);
    if (!home) return fail('You have no home city to return to.');
    const throne = capitals.find(c => c.id === 'kings-landing');
    const hand = handPlayerId ? players.get(handPlayerId) : null;
    const offerTo = hand && !hand.eliminated && !hand.left && hand.id !== player.id ? hand : null;
    player.cityId = home.id;
    kingPlayerId = null; handPlayerId = offerTo ? offerTo.id : null;
    if (throne) { throne.ownerHouseId = null; throne.ownerPlayerId = null; throne.vacant = true; throne.offerTo = offerTo ? offerTo.id : null; throne.forfeitedBy = { name: player.username, houseId: player.houseId }; }
    addEvent('important', `${player.username} forfeited the crown and returned to ${home.name}. ${offerTo ? `${offerTo.username}, the Hand, must choose whether to take it.` : 'King’s Landing stands open to the first army that reaches it.'}`);
    if (!offerTo) notifyAll('crown', 'There is no king', `${player.username} forfeited the crown. King’s Landing is open: the first army to reach it takes the throne without a fight.`, [player.houseId]);
    if (offerTo) notify('notice', [], [offerTo.id], 'The crown is offered', `${player.username} forfeited the crown. Take the throne, or refuse and let the first army to reach King’s Landing take it without a fight.`, [player.houseId]);
    return ok(`You forfeited the crown and returned to ${home.name}.`);
  });

  action(socket, 'crown-choice', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    const throne = capitals.find(c => c.id === 'kings-landing');
    if (!throne?.vacant || throne.offerTo !== player.id) return fail('The crown is not offered to you.');
    throne.offerTo = null;
    if (payload.accept === true) {
      kingPlayerId = player.id; handPlayerId = null;
      throne.vacant = false; throne.ownerPlayerId = player.id; throne.ownerHouseId = player.houseId;
      player.cityId = 'kings-landing';
      addEvent('important', `${player.username} took the crown and now lives in King’s Landing.`);
      notifyAll('crown', 'A new king', `${throne.forfeitedBy?.name || 'The king'} forfeited the crown. ${player.username} of House ${capWord(houseName(player.houseId))} took the throne and is now king.`, [player.houseId]);
      checkVictory();
      return ok('You wear the crown. Appoint a Hand of the King from the Relations menu.');
    }
    handPlayerId = null;
    addEvent('important', `${player.username} refused the crown. King’s Landing stands open to the first army that reaches it.`);
    notifyAll('crown', 'There is no king', `${throne.forfeitedBy?.name || 'The king'} forfeited the crown and ${player.username}, the Hand, refused it. The first army to reach King’s Landing takes the throne without a fight.`, [throne.forfeitedBy?.houseId, player.houseId].filter(Boolean));
    return ok('You refused the crown. The first army to reach King’s Landing will take it unopposed.');
  });

  action(socket, 'send-gift', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (phase !== 'ACTION') return fail('Gifts can be sent during the action phase.');
    const to = players.get(String(payload.toPlayerId || ''));
    if (!to || to.id === player.id || to.left || to.eliminated || !to.w) return fail('Choose another player to receive the gift.');
    const gold = wholeNumber(payload.gold), infantry = wholeNumber(payload.infantry), navy = wholeNumber(payload.navy);
    if (gold === null || infantry === null || navy === null) return fail('Gold, soldiers and ships must be whole numbers of zero or more.');
    const message = String(payload.message || '').trim().slice(0, 300);
    if (gold + infantry + navy === 0 && !message) return fail('Add gold, soldiers, ships or a note to the gift.');
    if (gold > check.money) return fail(`You only have ${check.money} gold.`);
    if (infantry > check.infantry) return fail(`You only have ${check.infantry} infantry available.`);
    if (navy > check.navy) return fail(`You only have ${check.navy} ships available.`);
    check.money -= gold; check.infantry -= infantry; check.navy -= navy;
    to.w.money += gold; to.w.infantry += infantry; to.w.navy += navy;
    for (const [res, n] of [['gold', gold], ['infantry', infantry], ['navy', navy]]) { note(check, res, -n, `Gift to ${to.username}`); note(to.w, res, n, `Gift from ${player.username}`); }
    const parts = [gold && `${gold} gold`, infantry && `${infantry} infantry`, navy && `${navy} ${navy === 1 ? 'ship' : 'ships'}`].filter(Boolean);
    notify('notice', [], [to.id], 'A gift', `${player.username} sent you ${parts.join(', ') || 'a note'}${message ? `: “${message}”` : '.'}`, [player.houseId]);
    return ok(`Gift sent to ${to.username}.`);
  });

  action(socket, 'plan-attack', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    const h = check;
    if (phase !== 'ACTION') return fail('Attacks can only be ordered during the action phase.');
    if (round < 2) return fail('Attacks unlock after Round 1.');
    if (h.pendingAttack) return fail('You already have a pending attack order.');
    if (h.hasAttackedThisRound) return fail('You have already planned an attack this round.');
    const target = findCapital(String(payload.targetCapitalId || ''));
    if (!target || target.contested || (!target.ownerHouseId && !target.vacant)) return fail('Choose a city held by someone else.');
    if (target.ownerPlayerId === player.id) return fail('That city is already yours.');
    const sameHouse = target.ownerHouseId === h.id, allyTarget = !sameHouse && areAllied(h.id, target.ownerHouseId);
    if (sameHouse && !gameSettings.friendlyFire) return fail('Friendly fire is off: you cannot attack a city held by your own house.');
    if (allyTarget && !gameSettings.friendlyFire) return fail(`Friendly fire is off: House ${houseName(target.ownerHouseId)} is your ally.`);
    const units = { infantry: Number(payload.infantry), navy: Number(payload.navy), dragons: Number(payload.dragons) };
    if (target.id === 'winterfell' && units.navy > 0) return fail('Winterfell cannot be attacked by ships. Send land forces only.');
    if (Object.values(units).some(n => !Number.isInteger(n) || n < 0)) return fail('Committed forces must be whole numbers of zero or greater.');
    if (units.infantry + units.navy + units.dragons < 1) return fail('Commit at least one unit to the attack.');
    if (units.infantry > h.infantry || units.navy > h.navy || units.dragons > h.dragons) return fail('You do not have enough uncommitted forces.');
    h.infantry -= units.infantry;
    h.navy -= units.navy;
    h.dragons -= units.dragons;
    for (const k of ['infantry', 'navy', 'dragons']) note(h, k, -units[k], `Sent to war on ${target.name}`);
    h.pendingAttack = { targetCapitalId: target.id, targetName: target.name, orderedRound: round, resolveRound: round + 1, units, playerId: player.id };
    h.hasAttackedThisRound = true;
    addEvent('normal', `House ${h.name} secretly committed an attack against a capital.`);
    return ok(`Attack order placed. It will resolve after Round ${round + 1} court.`);
  });

  action(socket, 'offer-alliance', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (!canDiplomacy()) return fail('Alliance offers can be sent during the action and court phases.');
    const target = findHouse(String(payload.targetHouseId || ''));
    const scope = payload.scope === 'secret' ? 'secret' : 'public';
    if (!target || target.id === check.id) return fail('Choose another house.');
    if (!houseMembers(target.id).length) return fail(`No player leads House ${target.name} in this game.`);
    if (areAllied(check.id, target.id)) return fail('Your houses already have an alliance.');
    if (allianceOffers.some(o => o.fromHouseId === check.id && o.toHouseId === target.id)) return fail('Your house already has an outstanding offer to that house.');
    if (allianceOffers.some(o => o.fromHouseId === target.id && o.toHouseId === check.id)) return fail(`House ${target.name} already offered you an alliance. Accept it in the Relations menu.`);
    if (houseIsBotOnly(target.id)) {
      alliances.push({ id: randomUUID(), houseA: check.id, houseB: target.id, scope, createdRound: round });
      addEvent('important', `House ${target.name} accepted an alliance with House ${check.name}.`);
      notify('alliance', [check.id, target.id], [], 'An alliance is forged', `House ${capWord(check.name)} and House ${capWord(target.name)} now stand together.`, [check.id, target.id]);
      return ok(`House ${target.name} accepted your alliance.`);
    }
    allianceOffers.unshift({ id: randomUUID(), fromHouseId: check.id, toHouseId: target.id, scope, round });
    addEvent('normal', scope === 'public' ? `House ${check.name} publicly offered an alliance to House ${target.name}.` : `House ${check.name} sent a secret alliance offer.`);
    return ok('Alliance offer sent.');
  });

  action(socket, 'respond-alliance', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (!canDiplomacy()) return fail('Alliance offers can be answered during the action and court phases.');
    const offer = allianceOffers.find(o => o.id === String(payload.offerId || ''));
    if (!offer || offer.toHouseId !== check.id) return fail('That offer is no longer available to your house.');
    allianceOffers.splice(allianceOffers.indexOf(offer), 1);
    if (payload.accept === true) {
      if (!areAllied(offer.fromHouseId, offer.toHouseId)) alliances.push({ id: randomUUID(), houseA: offer.fromHouseId, houseB: offer.toHouseId, scope: offer.scope, createdRound: round });
      addEvent('important', `House ${check.name} accepted an alliance with House ${houseName(offer.fromHouseId)}.`);
      notify('alliance', [offer.fromHouseId, offer.toHouseId], [], 'An alliance is forged', `House ${capWord(houseName(offer.fromHouseId))} and House ${capWord(check.name)} now stand together.`, [offer.fromHouseId, offer.toHouseId]);
      return ok('Alliance accepted.');
    }
    addEvent('normal', `House ${check.name} declined an alliance offer from House ${houseName(offer.fromHouseId)}.`);
    return ok('Alliance declined.');
  });

  action(socket, 'break-alliance', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (!canDiplomacy()) return fail('Alliances can be broken during the action and court phases.');
    const alliance = alliances.find(a => a.id === String(payload.allianceId || ''));
    if (!alliance || ![alliance.houseA, alliance.houseB].includes(check.id)) return fail('Your house is not part of that alliance.');
    const other = alliance.houseA === check.id ? alliance.houseB : alliance.houseA;
    alliances.splice(alliances.indexOf(alliance), 1);
    addEvent('important', `House ${check.name} broke its alliance with House ${houseName(other)}.`);
    notify('alliance-broken', [check.id, other], [], 'An alliance is broken', `House ${capWord(check.name)} has broken its alliance with House ${capWord(houseName(other))}.`, [check.id, other]);
    return ok('Alliance broken.');
  });

  action(socket, 'offer-treaty', (player, payload) => {
    const h = requireHouse(player); if (h.ok === false) return h;
    if (!canDiplomacy()) return fail('Treaties can be offered during the action and court phases.');
    const target = findHouse(String(payload.targetHouseId || ''));
    if (!target || target.id === h.id) return fail('Choose another house for the treaty.');
    if (!houseMembers(target.id).length) return fail(`No player leads House ${target.name} in this game.`);
    const gold = wholeNumber(payload.gold), infantry = wholeNumber(payload.infantry), navy = wholeNumber(payload.navy);
    if (gold === null || infantry === null || navy === null) return fail('Gold, soldiers and ships must be whole numbers of zero or more.');
    const message = String(payload.message || '').trim().slice(0, 300);
    if (gold + infantry + navy === 0 && !message) return fail('Add gold, soldiers, ships or a message to the treaty.');
    if (gold > h.money) return fail(`You only have ${h.money} gold.`);
    if (infantry > h.infantry) return fail(`You only have ${h.infantry} infantry available.`);
    if (navy > h.navy) return fail(`You only have ${h.navy} ships available.`);
    if (treaties.some(t => t.status === 'pending' && t.fromHouseId === h.id && t.toHouseId === target.id)) return fail(`You already have a treaty waiting on House ${target.name}.`);
    h.money -= gold; h.infantry -= infantry; h.navy -= navy;
    const why = `Treaty offered to House ${target.name} (held until they answer)`;
    note(h, 'gold', -gold, why); note(h, 'infantry', -infantry, why); note(h, 'navy', -navy, why);
    const treaty = { id: randomUUID(), fromPlayerId: player.id, fromHouseId: h.id, toHouseId: target.id, gold, infantry, navy, message, round, status: 'pending' };
    treaties.unshift(treaty);
    addEvent('normal', `House ${h.name} sent a treaty to House ${target.name}.`);
    if (houseIsBotOnly(target.id)) {
      closeTreaty(treaty, 'accepted');
      addEvent('important', `House ${target.name} accepted a treaty from House ${h.name}.`);
      return ok(`House ${target.name} accepted your treaty.`);
    }
    return ok('Treaty sent. Your offering is held until they reply.');
  });

  action(socket, 'respond-treaty', (player, payload) => {
    const h = requireHouse(player); if (h.ok === false) return h;
    if (!canDiplomacy()) return fail('Treaties can be answered during the action and court phases.');
    const t = treaties.find(x => x.id === String(payload.treatyId || ''));
    if (!t || t.status !== 'pending' || t.toHouseId !== h.id) return fail('That treaty is no longer available to your house.');
    const accept = payload.accept === true;
    closeTreaty(t, accept ? 'accepted' : 'declined', player.id);
    addEvent(accept ? 'important' : 'normal', `House ${h.name} ${accept ? 'accepted' : 'declined'} a treaty from House ${houseName(t.fromHouseId)}.`);
    return ok(accept ? 'Treaty accepted. The offering is yours.' : 'Treaty declined. The offering returns to its sender.');
  });

  action(socket, 'cancel-treaty', (player, payload) => {
    const h = requireHouse(player); if (h.ok === false) return h;
    const t = treaties.find(x => x.id === String(payload.treatyId || ''));
    if (!t || t.status !== 'pending' || t.fromHouseId !== h.id) return fail('That treaty cannot be withdrawn.');
    closeTreaty(t, 'cancelled');
    return ok('Treaty withdrawn. Your offering has returned.');
  });

  action(socket, 'claim-spoils', (player, payload) => {
    const h = requireHouse(player); if (h.ok === false) return h;
    const s = spoils.find(x => x.id === String(payload.spoilId || '') && x.status === 'open' && [x.houseA, x.houseB].includes(h.id));
    if (!s) return fail('Those spoils are no longer in dispute.');
    const claim = String(payload.claimHouseId || '');
    if (![s.houseA, s.houseB].includes(claim)) return fail('Choose one of the two allied houses to rule the capital.');
    s.claims[h.id] = claim;
    settleSpoils(false);
    if (s.status === 'settled') return ok('You agreed. The capital has a new ruler.');
    const other = s.houseA === h.id ? s.houseB : s.houseA;
    return ok(`Your choice is recorded. If you and House ${houseName(other)} still disagree when court ends in Round ${s.deadlineRound}, you will fight for it.`);
  });

  // Royal decrees (stored in `taxLedger`): a sealed message, optionally demanding gold or troops. Nothing moves unless the house presses Send.
  action(socket, 'issue-decree', (player, payload) => {
    const h = requireHouse(player); if (h.ok === false) return h;
    if (player.id !== kingPlayerId) return fail('Only the king can issue a royal decree.');
    if (!canDiplomacy()) return fail('Decrees can be issued during the action and court phases.');
    if (h.commandUsedRound === round) return fail('You have already issued a decree this round.');
    const gold = wholeNumber(payload.gold), infantry = wholeNumber(payload.infantry), navy = wholeNumber(payload.navy);
    if (gold === null || infantry === null || navy === null) return fail('Demands must be whole numbers of zero or more.');
    const message = String(payload.message || '').trim().slice(0, 300);
    if (!message && gold + infantry + navy === 0) return fail('Write a decree or name a demand.');
    const wanted = Array.isArray(payload.targetHouseIds) ? payload.targetHouseIds.map(String) : [];
    const handHouseId = handPlayerId ? players.get(handPlayerId)?.houseId : null;
    const targets = houses.filter(x => x.id !== h.id && x.id !== handHouseId && houseMembers(x.id).length && (!wanted.length || wanted.includes(x.id)));
    if (!targets.length) return fail(wanted.length && wanted.every(id => id === handHouseId) ? 'The Hand’s house does not pay decrees.' : 'No other house has a player to receive the decree.');
    taxLedger.unshift({ id: randomUUID(), round, kingPlayerId: player.id, kingName: player.username, kingHouseId: h.id, message, gold, infantry, navy, recipients: targets.map(x => ({ houseId: x.id, state: gold + infantry + navy === 0 ? 'noted' : 'pending' })) });
    if (taxLedger.length > 20) taxLedger.length = 20;
    h.commandUsedRound = round;
    if (handPlayerId && players.has(handPlayerId)) {
      const asks = [gold && `${gold} gold`, infantry && `${infantry} infantry`, navy && `${navy} ships`].filter(Boolean).join(', ');
      notify('decree', [], [handPlayerId], 'The king sent a subsidy decree', `King ${player.username} sent a decree to ${targets.length} house${targets.length === 1 ? '' : 's'}${asks ? ` demanding ${asks} from each` : ''}. See the Hand’s ledger.`, [h.id]);
    }
    addEvent('important', `King ${player.username} issued a royal decree${gold + infantry + navy ? ' with demands' : ''}.`);
    return ok(`Your decree has been sealed and sent to ${targets.length} house${targets.length === 1 ? '' : 's'}.`);
  });

  action(socket, 'respond-decree', (player, payload) => {
    const h = requireHouse(player); if (h.ok === false) return h;
    const d = taxLedger.find(x => x.id === String(payload.decreeId || ''));
    const r = d?.recipients.find(x => x.houseId === h.id && x.state === 'pending');
    if (!r) return fail('That decree is no longer waiting on your house.');
    if (h.money < d.gold || h.infantry < d.infantry || h.navy < d.navy) return fail(`You cannot meet this demand: you have ${h.money} gold, ${h.infantry} infantry and ${h.navy} ships.`);
    const king = players.get(d.kingPlayerId)?.w;
    h.money -= d.gold; h.infantry -= d.infantry; h.navy -= d.navy;
    if (king) { king.money += d.gold; king.infantry += d.infantry; king.navy += d.navy; }
    const out = `Sent to King ${d.kingName} by decree`, inn = `Decree answered by House ${h.name}`;
    note(h, 'gold', -d.gold, out); note(h, 'infantry', -d.infantry, out); note(h, 'navy', -d.navy, out);
    note(king, 'gold', d.gold, inn); note(king, 'infantry', d.infantry, inn); note(king, 'navy', d.navy, inn);
    r.state = 'sent';
    addEvent('normal', `House ${h.name} answered the king's decree.`);
    return ok('Sent. The king has received your answer.');
  });

  action(socket, 'mark-traitor', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (player.id !== kingPlayerId) return fail('Only the king can label traitors.');
    const target = players.get(String(payload.playerId || ''));
    if (!target || target.left || target.id === player.id) return fail('Choose another player.');
    target.traitor = payload.traitor === true;
    if (target.traitor) { const kh = findHouse(player.houseId); notify('traitor', [], [target.id], 'Branded a traitor', `King ${player.username} has named you a traitor to the crown.`, kh ? [kh.id] : []); }
    return ok(target.traitor ? `${target.username} is now labelled a traitor.` : `${target.username} has been pardoned.`);
  });

  action(socket, 'send-chat', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    const message = String(payload.message || '').trim().slice(0, 350);
    if (!message) return fail('Write a message first.');
    const scope = payload.scope === 'secret' ? 'secret' : 'public';
    if (scope === 'public') {
      publicMessages.push({ id: randomUUID(), senderId: player.id, senderName: player.username, senderHouseName: check.name, senderHouseId: check.id, scope, round, message });
      if (publicMessages.length > 150) publicMessages.shift();
    } else {
      const wanted = [...new Set((Array.isArray(payload.targetPlayerIds) ? payload.targetPlayerIds : []).map(String))].filter(id => id !== player.id).slice(0, 16);
      const targets = wanted.map(id => players.get(id)).filter(p => p && !p.left);
      if (!targets.length) return fail('Choose at least one player to message privately.');
      privateMessages.push({ id: randomUUID(), senderId: player.id, senderName: player.username, senderHouseId: check.id, senderHouseName: check.name, targets: targets.map(t => ({ id: t.id, name: t.username, houseId: t.houseId })), scope: 'secret', round, message });
      if (privateMessages.length > 150) privateMessages.shift();
    }
    return ok('Message sent.');
  });

  action(socket, 'advance-phase', (player) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can advance the game.');
    if (gameOver) return fail('The game is over. Return to the lobby to play again.');
    if (phase === 'ACTION') {
      phase = 'COURT';
      addEvent('important', `Round ${round} action phase ended. Court is now in session.`);
      return ok('Court is now in session.');
    }
    if (phase === 'COURT') {
      phase = 'RESOLUTION';
      resolveDueAttacks();
      settleSpoils(true);
      addEvent('important', `Round ${round} court has concluded. The realm has entered resolution.`);
      checkVictory(true);
      return ok('Round resolution has begun.');
    }
    if (phase === 'RESOLUTION') {
      round += 1;
      phase = 'ACTION';
      for (const p of players.values()) {
        const h = p.w;
        if (!h || p.left) continue;
        h.hasAttackedThisRound = false;
        if (h.navyBuilding) { h.navy += h.navyBuilding; note(h, 'navy', h.navyBuilding, 'Ships finished building'); h.navyBuilding = 0; }
        if (p.eliminated) continue;
        const income = playerIncome(p);
        h.money += income;
        note(h, 'gold', income, 'City income');
        // Army upkeep: 1 gold per unit, taken automatically. Unpaid troops desert.
        const due = armySize(h);
        const paid = Math.min(due, h.money);
        h.money -= paid;
        note(h, 'gold', -paid, `Army upkeep (${due} units)`);
        let short = due - paid;
        if (short > 0) {
          const deserted = [];
          for (const k of ['infantry', 'navy', 'dragons']) {
            const take = Math.min(h[k], short);
            if (!take) continue;
            h[k] -= take; short -= take;
            note(h, k, -take, 'Deserted: upkeep unpaid');
            deserted.push(`${take} ${k}`);
          }
          notify('desertion', [], [p.id], 'Troops deserted', `You could not pay your army. ${deserted.join(', ')} left the banners.`, [h.id]);
          addEvent('normal', `Unpaid troops deserted ${p.username} of House ${h.name}.`);
        }
      }
      addEvent('important', `Round ${round} begins. Houses received capital income and paid army upkeep.`);
      return ok(`Round ${round} has begun. Capital income and army upkeep have been settled.`);
    }
    return fail('Use the election controls to leave the lobby or close the ballot.');
  });

  action(socket, 'reset-game', (player) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can reset the game.');
    resetWorld(true, true);
    return ok('New game ready. Everyone keeps their house; start when ready.');
  });
});

// Allies who march on the same capital in the same round fight together automatically.
function resolveDueAttacks() {
  const due = [...players.values()].map(p => p.w).filter(w => w && w.pendingAttack && w.pendingAttack.resolveRound <= round);
  const done = new Set();
  for (const attacker of due) {
    if (done.has(attacker.playerId)) continue;
    const partner = due.find(o => o !== attacker && o.id !== attacker.id && !done.has(o.playerId) && o.pendingAttack && o.pendingAttack.targetCapitalId === attacker.pendingAttack.targetCapitalId && areAllied(attacker.id, o.id)) || null;
    done.add(attacker.playerId);
    if (partner) done.add(partner.playerId);
    fightBattle(attacker, partner);
  }
}
function fightBattle(attacker, allyHouse) {
  {
    const order = attacker.pendingAttack;
    const target = findCapital(order.targetCapitalId);
    const ffOff = !gameSettings.friendlyFire && target && target.ownerHouseId && (target.ownerHouseId === attacker.id || areAllied(attacker.id, target.ownerHouseId));
    if (!target || (!target.ownerHouseId && !target.vacant) || target.ownerPlayerId === attacker.playerId || ffOff) {
      addEvent('battle', `House ${attacker.name} found no enemy holding at ${order.targetName}; the attack was spent.`);
      attacker.pendingAttack = null;
      if (allyHouse) allyHouse.pendingAttack = null;
      return;
    }
    const defender = findHouse(target.ownerHouseId);
    const defWallet = target.ownerPlayerId ? players.get(target.ownerPlayerId)?.w : null;
    if (defender && defender.id !== attacker.id && areAllied(attacker.id, defender.id) && !(allyHouse && allyHouse.id === defender.id)) {
      const pact = alliances.find(x => [x.houseA, x.houseB].includes(attacker.id) && [x.houseA, x.houseB].includes(defender.id));
      if (pact) { alliances.splice(alliances.indexOf(pact), 1); notify('alliance-broken', [attacker.id, defender.id], [], 'Allies at war', `House ${capWord(attacker.name)} marched on its ally House ${capWord(defender.name)}. The alliance is broken.`, [attacker.id, defender.id]); }
    }
    let defense = target.vacant ? -1 : target.defense + randomInt(0, 3);
    if ((defender?.id === 'stark' && target.id === 'winterfell') || (defender?.id === 'martell' && target.id === 'sunspear') || (defender?.id === 'arryn' && target.id === 'the-eyrie')) defense += 2;
    // Each troop contributes one strength; ships can support an attack, and dragons add five each plus a siege bonus.
    const allyOrder = allyHouse ? allyHouse.pendingAttack : null;
    const attackStrength = forceStrength(order.units) + (allyOrder ? forceStrength(allyOrder.units) : 0) + randomInt(0, 3);
    if (attackStrength >= defense && allyHouse) {
      const plunder = Math.min(defWallet?.money || 0, 6);
      if (defWallet) defWallet.money -= plunder;
      const share = Math.floor(plunder / 2);
      attacker.money += plunder - share; allyHouse.money += share;
      note(attacker, 'gold', plunder - share, `Plunder from ${target.name}`); note(allyHouse, 'gold', share, `Plunder from ${target.name}`);
      if (defWallet) note(defWallet, 'gold', -plunder, `Plundered at ${target.name}`);
      sackCity(target, [order.playerId, allyOrder?.playerId].filter(Boolean));
      target.ownerHouseId = null; target.ownerPlayerId = null; evictResidents(target);
      target.contested = { houseA: attacker.id, houseB: allyHouse.id };
      const claims = { [attacker.id]: null, [allyHouse.id]: null };
      const spoil = { id: randomUUID(), capitalId: target.id, houseA: attacker.id, houseB: allyHouse.id, claims, round, deadlineRound: round + 1, plunder, status: 'open', orderers: { [attacker.id]: order.playerId, [allyHouse.id]: allyOrder?.playerId } };
      if (houseIsBotOnly(allyHouse.id)) claims[allyHouse.id] = attacker.id;
      spoils.unshift(spoil);
      addEvent('battle', `Houses ${attacker.name} and ${allyHouse.name} stormed ${target.name} together (attack ${attackStrength} vs. defense ${defense}) and split ${plunder} gold of plunder. They must agree who will rule it, or fight for it.`);
      notify('battle-won', [attacker.id, allyHouse.id], [], `Victory at ${target.name}`, `Houses ${capWord(attacker.name)} and ${capWord(allyHouse.name)} took ${target.name}. Agree who will rule it, or fight for it.`, [attacker.id, allyHouse.id]);
      if (defender) notify('attacked', [defender.id], [], `${target.name} was attacked`, `Houses ${capWord(attacker.name)} and ${capWord(allyHouse.name)} attacked and took ${target.name}.`, [attacker.id, defender.id]);
      settleSpoils(false);
    } else if (attackStrength >= defense) {
      sackCity(target, [order.playerId]);
      target.ownerHouseId = attacker.id; target.ownerPlayerId = order.playerId; evictResidents(target);
      if (target.id === 'kings-landing') throneTaken(attacker.id, order.playerId);
      notify('battle-won', [attacker.id], [], `Victory at ${target.name}`, `House ${capWord(attacker.name)} captured ${target.name}.`, [attacker.id, defender?.id].filter(Boolean));
      if (defender) notify('attacked', [defender.id], [], `${target.name} was attacked`, `House ${capWord(attacker.name)} attacked and took ${target.name}.`, [attacker.id, defender.id]);
      addEvent('battle', target.vacant || defense < 0 ? `House ${attacker.name} marched into the empty ${target.name} unopposed.` : `House ${attacker.name} captured ${target.name} from House ${defender?.name || 'an unknown house'} (attack ${attackStrength} vs. defense ${defense}).`);
      checkVictory();
    } else {
      addEvent('battle', `House ${attacker.name} failed to capture ${target.name} (attack ${attackStrength} vs. defense ${defense}).`);
      const lost = [attacker.id, allyHouse?.id].filter(Boolean);
      notify('battle-lost', lost, [], `Defeat at ${target.name}`, `${lost.length > 1 ? 'Your armies' : 'Your army'} failed to take ${target.name}.`, [attacker.id, defender?.id].filter(Boolean));
      if (defender) notify('attacked', [defender.id], [], `${target.name} held`, `House ${capWord(attacker.name)} attacked ${target.name}, but your defenders held.`, [attacker.id, defender.id]);
    }
    attacker.pendingAttack = null;
    if (allyHouse) allyHouse.pendingAttack = null;
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Iron Throne multiplayer server listening on port ${PORT}`);
  console.log(`Allowed browser origins: ${[...allowedOrigins].join(', ') || '(none configured)'}`);
});
