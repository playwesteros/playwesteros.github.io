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
  { id: 'winterfell', x: 422, y: 648, name: 'Winterfell', region: 'The North', icon: '❄', defense: 5, originalHouseId: 'stark' },
  { id: 'casterly-rock', x: 159, y: 1371, name: 'Casterly Rock', region: 'The Westerlands', icon: '⛰', defense: 5, originalHouseId: 'lannister' },
  { id: 'storms-end', x: 676, y: 1556, name: 'Storm’s End', region: 'The Stormlands', icon: '⛈', defense: 5, originalHouseId: 'baratheon' },
  { id: 'dragonstone', x: 686, y: 1315, name: 'Dragonstone', region: 'The Crownlands', icon: '🐉', defense: 4, originalHouseId: 'targaryen' },
  { id: 'highgarden', x: 249, y: 1664, name: 'Highgarden', region: 'The Reach', icon: '🌹', defense: 4, originalHouseId: 'tyrell' },
  { id: 'pyke', x: 169, y: 1157, name: 'Pyke', region: 'The Iron Islands', icon: '⚓', defense: 4, originalHouseId: 'greyjoy' },
  { id: 'sunspear', x: 731, y: 1832, name: 'Sunspear', region: 'Dorne', icon: '☀', defense: 4, originalHouseId: 'martell' },
  { id: 'the-eyrie', x: 592, y: 1106, name: 'The Eyrie', region: 'The Vale', icon: '🦅', defense: 4, originalHouseId: 'arryn' },
  { id: 'kings-landing', x: 585, y: 1421, name: 'King’s Landing', region: 'The Crownlands', icon: '👑', defense: 6, originalHouseId: null }
];

// Travel: infantry and dragons cross the map in a straight line; ships must sail around the coast through open water.
// SEA is the traced coastline as an 8-unit grid (1 = open sea connected to the ocean), see shipRoute().
const TRAVEL_SPEED = { infantry: 300, navy: 1200, dragons: 700 };
const SEA = { w: 118, h: 216, cell: 8, y0: 287, bits: Buffer.from('/z8AAAAAAAAA8P///////w8AAAAAAAAA/L////////8AAPgDAAAA/+///////38AAP8AAADg//P//////x8A4D8AAAD8f/z//////x8A+AEAAID/H////////wcAfwAAAMB/zP///////wPgHwAAAPAf8v///////wP8DwAAAPwP+P///////8H//wEAAP8D/v////////j/fwAAgP+B////////////HwAAwP/A////////////AwAA8H/w//////////8/AAAA+B/+//////////8HAAAA/uf//////////38AAACA/////////////w8AAADA//////////8//wMAAAD4//////////+D/wEAAAD8///////////g/wAAAAD//////////7//HwAAAAD/////////////AwAAAAD8/P//////////AAAAAAAG//////////9/AAAAAADA//////////8PAAAAAADw///////7v/8BAAAAAAD8/////z/87z8AAAAAAAD//////wf88wcAAAAAAMD//////w//CQAAAAAAAPD//////4d/AAAAAAAAAPz//////8MPAAAAAAAAAP//////f+AAAAAAAAAAwP//////HxgAAAAAAAAA8P//////BwAAAAAAAAAA/v//////AwAAAAAAAACY////////AAAAAAAAAADv//////8fAAAAAAAAAMD7//////8BAAAAAAAAAPD+/////38AAAAAAAAAAPz//////38AAAAAAAAAgP///////x8AAAAAAAAA8P///////wEAAAAAAABg/v///////wAAAAAAAAD4////////PwAAAAAAAAD/////////BwAAAAAAAMD///////8HAAAAAAAAAPD///////8AAAAAAAAAAPj//////z8AAAAAAAAAAPz//////w8AAAAAAAAAAP///////wEAAAAAAAAAgP//////fwAAAAAAAAAA+P//////HwAAAAAAAAAA/P//////AwAAAAAAAAAA/v//////AAAAAAAAAACA//////8/AAAAAAAAAADA//////8PAAAAAAAAAADg//////8DAAAAAAAAAAD4//////8AAAAAAAAAAAD+/////38AAAAAAAAAAID//////88AAAAAAAAAAOD//////zsAAAAAAAAAIPD//////w8AAAAAAAAA+PD//////wcAAAAAAAAA//D//////wEAAAAAAADA/////////wAAAAAAAADw////////PwAAAAAAAAD+////////DwAAAAAAAID/////////AwAAAAAgAOD/////////AwAAAAAIAPj/////////AAEeAAACAP////////9/8PEPAIABwP///////////38AAPAA+P//////////yQAAADwA/v////////9/AAAAAI/7//////////8PAAAA4Of///////////8AAAAA/v//////////Pw8AAACA////////////DwcAAADg//7/////////gQAAAAD4v/////////8/AAAAAAD/P///9/////8PAAAAAMB////P//////8BAAAAAPj////8/////z8AAAAAAP7/D57//////w8AAAAAwP//AYD//////wcADAAA+P9jAHD//////wP8BwAA/n8AAG7/////////AwAA/xMAwOD/////////AQCA/wAAGPz+////////AADAAAAAgB//////////AAAAAAAA+IP/////////AAAAAABgD8b///////8/AAAAAAB4wP////////8PAAAAAAAD8P////////8HAAAAAAAA+P////////8DAAAAAAAA/P////////8AAAAAAAAA/////////z8AAAAAAADA///////v/wcAAAAAAAD4///////xfwAAAAAAAAD+////////BwAAAAAAAMD/////////wQcAAAAAAPj/////+ff/+AEAAAAA4P////8/b/j/fwAAAAAA+P/////PfN7/PwAAAAAAf//////j/fP/DwAAAADwAP7///8gP/z/AQAAAAAAgP///z/AD/9/AAAAAAAA8P///x+8k/8DAAAAAAAA///////H/38AAAAAAADg/////3/w/w8AAAAAAAD8/////wz+/wEAAAAAAID//////8/nIwAAAAAAAPj///////8AAAAAAAAAgP///////z8AAAAAAAAA8P///////w8AAAAAAAAAf////////wcAAAAAAADgz////////wEAAAAAAAD4+f//////PwAAAAAAAAAf/v//////DwAAAAAAAPyB/v//////AQAAAACA+T/w//////9/AAAAAADA/wP8//////8fAAAAAAAAAAD///////8DAAAAAAAAAPD///////8AAAAAAAAAAP///////zsAAAAAAAAA4P///////w4AAAAAAAAA/v//////3wMAAAAAAADAx///////ewAAAAAAAAD+////////BwAAAAAAAMCP//////9/AAAAAAAAAPj///////8PAAAAAAAAAP7///////8BAAAAAAAAgP/+/////z8AAAAAAAAA4L///////w8AAAAAAAAA/M////////gAAAAAAAAA//f/////Px8AAAAAAADw//n//////wcAAAAAAAD8f/7//////wEAAAAAAID/n///////fwAAAAAAAOD/8///////DwAAAAAAAPB//v//////AQAAAAAAAPyH////////AAAAAAAAAGfw//////8/AAAAAAAAAAD8//////8PAAAAAAAAAAD///////8BAAAAAAAAAOD//////38AAAAAAAAAAPj//////w8AAAAAAAAAAMD//////wMAAAAAAAAAAPD//////wAAAAAAAAAAAP7/////PwAAAAAAAAAAgP//////DwAAAAAAAAAA4P//////AwAAAAAAAAAA/P//////AAAAAAAAAACA9/////8/AAAAAAAAAAD4+f////8PAAAAAAAAAAA+/P////8DAAAAAAAAAIAP//////8BAAAAAAAAAODD//////8AAAAAAAAAAPjx/////z8AAAAAAAAAAP7+/////w8AAAAAAAAAwH///////w8AAAAAAAAA+P///////wcAAAAAAADw////////P38AAAAAAAD4////////+x8AAAAAAAD/////////PQcAAAAAAED8/////////QAAAAAAAAD++///////DwAAAAAAAIAR/P//////AQAAAAAAAACA////////AAAAAAAAAADw//////9/AAAAAAAAAAD+//////83AAAAAAAAAMD//////z8IAAAAAAAAAPz//////w8AAAAAAIAAAO///////wEAAAAAADAA4P3/////PwAAAAAA2B8BeP//////DwAAAAAA/v8P/v////9/AAAAAADA//+H//////8PAAAAAADw///z//////8DAAAAAAD8/+///////38AAAAAAID//////////x8AAAAAAOD//////////wcAAAAAAPj//////////wAAAAAAAP//////////PwAAAAAAwL//////////HwAAAAAA/P///+//////BwAAAAAA+v//f/n/////AwAAAAAAAP//T///////YAAAAAAAAP//QPn///8/HgAAAAAAAAIfAPj/////AwAAAAAAAAABAPz///9/AAAAAAAAAAAAAP////8HAAAAAAAAAAAA4P////8BAAAAAAAAAAAA/P////8AAAAAAAAAAAD8/////38AQAAAAAAAAMD//////x8AGAAAAAAAAPD//////w8AAwAAAAAAAP///////wfgAAAAAAAAwP///////gN8AAAAAAAA8P////+//4AfAAAAAAAA///////f//8HAAAABgDg///////n//8BAACA44P////////x/38AAMDh/////////3/4/x8Az////////////x///w/w/////////////+f/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////', 'base64') };
const seaAt = (i, j) => i >= 0 && j >= 0 && i < SEA.w && j < SEA.h && ((SEA.bits[(j * SEA.w + i) >> 3] >> ((j * SEA.w + i) & 7)) & 1) === 1;
function nearestSea(x, y) {
  const ci = Math.floor(x / SEA.cell), cj = Math.floor((y - SEA.y0) / SEA.cell);
  let best = null;
  for (let r = 0; r < 70 && !best; r++) {
    let bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !seaAt(ci + di, cj + dj)) continue;
      const d = Math.hypot((ci + di + 0.5) * SEA.cell - x, (cj + dj + 0.5) * SEA.cell + SEA.y0 - y);
      if (d < bd) { bd = d; best = { i: ci + di, j: cj + dj, d }; }
    }
  }
  return best;
}
const shipCache = new Map();
// Shortest sailing route between two cities: A* over open-sea cells (no cutting corners through land).
function shipRoute(from, to) {
  const key = `${from.id}>${to.id}`;
  if (shipCache.has(key)) return shipCache.get(key);
  const a = nearestSea(from.x, from.y), b = nearestSea(to.x, to.y);
  let result = null;
  if (a && b) {
    const W = SEA.w, idx = (i, j) => j * W + i, g = new Map([[idx(a.i, a.j), 0]]), prev = new Map(), open = [[0, a.i, a.j]], done = new Set();
    const h = (i, j) => Math.hypot(i - b.i, j - b.j) * SEA.cell;
    while (open.length) {
      open.sort((x, y) => x[0] - y[0]);
      const [, i, j] = open.shift(), k = idx(i, j);
      if (done.has(k)) continue; done.add(k);
      if (i === b.i && j === b.j) break;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (!seaAt(ni, nj) || (di && dj && (!seaAt(i + di, j) || !seaAt(i, j + dj)))) continue;
        const nk = idx(ni, nj), cost = g.get(k) + (di && dj ? 1.4142 : 1) * SEA.cell;
        if (cost < (g.has(nk) ? g.get(nk) : Infinity)) { g.set(nk, cost); prev.set(nk, k); open.push([cost + h(ni, nj), ni, nj]); }
      }
    }
    const end = idx(b.i, b.j);
    if (g.has(end)) {
      const pts = []; for (let k = end; k !== undefined; k = prev.get(k)) pts.push([(k % W + 0.5) * SEA.cell, (Math.floor(k / W) + 0.5) * SEA.cell + SEA.y0]);
      result = { sea: g.get(end), legs: a.d + b.d, points: pts.reverse() };
    }
  }
  shipCache.set(key, result);
  return result;
}
// Rounds a fleet needs: sailing at ship speed, plus any march overland between a city and the nearest coast.
function shipRounds(from, to) {
  const r = shipRoute(from, to);
  const t = r ? r.sea / TRAVEL_SPEED.navy + r.legs / TRAVEL_SPEED.infantry : Math.hypot(from.x - to.x, from.y - to.y) * 1.6 / TRAVEL_SPEED.navy;
  return Math.max(1, Math.ceil(t - 1e-9));
}
let shipTableCache = null;
function shipTable() {
  if (!shipTableCache) { shipTableCache = {}; for (const a of CAPITAL_DEFS) { shipTableCache[a.id] = {}; for (const b of CAPITAL_DEFS) if (a.id !== b.id) shipTableCache[a.id][b.id] = shipRounds(a, b); } }
  return shipTableCache;
}
function travelRounds(from, to, unit) {
  if (!from || !to) return 1;
  if (unit === 'navy') return shipRounds(from, to);
  const dist = Math.hypot(from.x - to.x, from.y - to.y);
  return Math.max(1, Math.ceil(dist / TRAVEL_SPEED[unit]));
}
// A force marches together, so it arrives with its slowest unit.
function attackTravel(from, to, units) {
  const times = ['infantry', 'navy', 'dragons'].filter(k => units[k] > 0).map(k => travelRounds(from, to, k));
  return Math.max(1, ...times);
}

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

// ---- Advanced host settings ----------------------------------------------
const POPUP_KINDS = ['alliance', 'alliance-broken', 'spy-caught', 'decree', 'crown', 'siege', 'sacked', 'city-fell', 'attacked', 'battle', 'desertion', 'round-start', 'traitor', 'king-hand'];
const ADVANCED_DEFAULTS = { alliancesEnabled: true, handEnabled: true, houseBuffs: true, disabledHouses: [], disabledPopups: [], roundSeconds: 0, readyMode: 'bypass' };
const buffsOn = () => gameSettings.houseBuffs !== false;
const handOn = () => gameSettings.handEnabled !== false;
const alliancesOn = () => gameSettings.alliancesEnabled !== false;
function houseCosts(id, buffs) {
  if (!buffs) return { infantryCost: 4, navyCost: 5 };
  return { infantryCost: ['tyrell', 'greyjoy', 'arryn'].includes(id) ? 5 : 4, navyCost: id === 'greyjoy' ? 4 : id === 'martell' ? 6 : 5 };
}
function refreshHouseCosts() { for (const h of houses || []) Object.assign(h, houseCosts(h.id, buffsOn())); }
function freshHouses() {
  return HOUSE_DEFS.map(def => ({
    ...def,
    ...houseCosts(def.id, true),
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
  gameSettings = { configured: false, maxPlayers: 10, gameType: 'CLASSIC', dragonCount: 1, dragonRounds: 5, friendlyFire: true, teamSize: 2, ...ADVANCED_DEFAULTS };
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
      p.ready = false;
      p.isHand = false;
      delete p.ai;
      p.eliminated = false;
      delete p.w; p.cityId = null;
      if (p.pendingName) { if (!nameTaken(p.pendingName, p.id)) p.username = p.pendingName; delete p.pendingName; }
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
let activeRoomCode = null;
// Round timer: when the host sets a time limit, each phase gets a deadline; when it passes the round moves on by itself.
const phaseTimers = new Map(); // roomCode -> { key, endsAt }
const RESOLUTION_SECONDS = 20;
function phaseSeconds() { return phase === 'RESOLUTION' ? Math.min(RESOLUTION_SECONDS, gameSettings.roundSeconds) : gameSettings.roundSeconds; }
function withWorld(roomCode, callback) {
  const room = gameRooms.get(roomCode);
  if (!room) return null;
  const previous = captureWorld();
  const previousCode = activeRoomCode;
  activateWorld(room);
  activeRoomCode = roomCode;
  try { return callback(); }
  finally {
    gameRooms.set(roomCode, captureWorld());
    activateWorld(previous);
    activeRoomCode = previousCode;
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
  return { id: p.id, username: p.username, connected: p.connected, left: Boolean(p.left), isBot: Boolean(p.isBot), houseId: p.houseId, isKing: p.id === kingPlayerId, isHand: p.id === handPlayerId, eliminated: Boolean(p.eliminated), muted: Boolean(p.muted) };
}
// Every player has their own purse and army (a "wallet" that reads house details through its prototype).
function makeWallet(p) {
  const house = findHouse(p.houseId);
  const w = Object.create(house);
  Object.assign(w, { playerId: p.id, money: 15 + (house.id === 'lannister' && buffsOn() ? 5 : 0), infantry: 3, navy: 1, navyBuilding: 0, dragons: house.id === 'targaryen' && buffsOn() ? 1 : 0, marches: [], hasAttackedThisRound: false, commandUsedRound: 0, lockedUntilRound: 0, spyReports: [], ledger: [] });
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
  if (p.left || p.eliminated || !c.ownerHouseId || c.contested || c.siege) return 0;
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
    p.w.money = 0; p.w.infantry = 0; p.w.navy = 0; p.w.dragons = 0; p.w.marches = [];
    p.eliminated = true; fallen.push(p);
    notify('city-fell', [], [p.id], `${c.name} was sacked`, `Your city fell. You are defeated${gold ? ` and your ${gold} gold goes to the victor` : ''}. You can still watch and speak at court.`, [p.houseId]);
  }
  if (fallen.length) addEvent('important', `${c.name} was sacked. ${fallen.map(p => p.username).join(', ')} ${fallen.length > 1 ? 'were' : 'was'} defeated.`);
  return fallen;
}
function evictResidents(c) { for (const p of players.values()) if (p.cityId === c.id && p.houseId !== c.ownerHouseId) p.cityId = null; }
function incomePerCapital(h) { return 15 + (h.id === 'tyrell' && buffsOn() ? 3 : 0); }
function armySize(h) { return h.infantry + h.navy + h.dragons; }
const SPY_MISSIONS = {
  wealth: { label: 'Wealth', successBase: 0.30, successPer: 0.045, dangerBase: 0.60, dangerPer: 0.03 },
  messages: { label: 'Messages', successBase: 0.20, successPer: 0.04, dangerBase: 0.40, dangerPer: 0.02 },
  war: { label: 'War', successBase: 0.35, successPer: 0.045, dangerBase: 0.75, dangerPer: 0.03 },
  dragon: { label: 'Dragons', successBase: 0.15, successPer: 0.04, dangerBase: 0.80, dangerPer: 0.03 }
};
function spyOdds(spend, targetId, mission) {
  const m = SPY_MISSIONS[mission] || SPY_MISSIONS.war;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return { success: clamp(m.successBase + m.successPer * (spend - 2) - (targetId === 'targaryen' && buffsOn() ? 0.15 : 0), 0.05, 0.95), caught: clamp(m.dangerBase - m.dangerPer * (spend - 2), 0.05, 0.9) };
}
function spyFindings(mission, target) {
  const pick = list => list[randomInt(0, list.length - 1)];
  const fuzz = n => Math.max(0, n + pick([-2, -1, 1, 2]));
  if (mission === 'wealth') {
    if (Math.random() < 0.5) return { kind: 'total', gold: houseSum(target.id, 'money') };
    let earned = 0, spent = 0;
    for (const w of houseWallets(target.id)) for (const e of (w.ledger || [])) {
      if (e.res !== 'gold' || e.round < Math.max(1, round - 1)) continue;
      if (e.delta > 0) earned += e.delta; else spent -= e.delta;
    }
    return { kind: 'recent', earned, spent };
  }
  if (mission === 'messages') {
    const options = [];
    const memberIds = new Set(houseMembers(target.id).map(p => p.id));
    const letters = [];
    for (const m of privateMessages) {
      if (memberIds.has(m.senderId) || (m.targets || []).some(t => memberIds.has(t.id))) letters.push({ from: m.senderName, fromHouseId: m.senderHouseId, to: (m.targets || []).map(t => t.name).join(', '), text: m.message });
    }
    if (letters.length) options.push({ kind: 'raven', letter: pick(letters) });
    const secret = alliances.filter(a => a.scope === 'secret' && [a.houseA, a.houseB].includes(target.id)).map(a => (a.houseA === target.id ? a.houseB : a.houseA));
    if (secret.length) options.push({ kind: 'alliance', houses: secret });
    return options.length ? pick(options) : { kind: 'none' };
  }
  if (mission === 'dragon') return { kind: 'dragon', hasDragon: houseMembers(target.id).some(p => dragonIds.includes(p.id)) };
  // war: an approximate troop count, or the army on the march with its approximate size (off by 1 or 2)
  const moving = houseWallets(target.id).find(w => (w.marches || []).some(m => !m.returning)), movingOrder = moving && moving.marches.find(m => !m.returning);
  if (moving && Math.random() < 0.5) {
    const cap = findCapital(movingOrder.targetCapitalId);
    return { kind: 'movement', movingOn: cap?.name || null, infantry: fuzz((movingOrder.units?.infantry) || 0), navy: fuzz((movingOrder.units?.navy) || 0), dragons: (movingOrder.units?.dragons) || 0 };
  }
  return { kind: 'count', infantry: fuzz(houseSum(target.id, 'infantry')), navy: fuzz(houseSum(target.id, 'navy')), dragons: houseSum(target.id, 'dragons'), marching: Boolean(moving) };
}
function capitalIncome(c) { const h = findHouse(c.ownerHouseId); return h ? incomePerCapital(h) + (c.id === 'casterly-rock' && buffsOn() ? 3 : 0) : 0; }
function currentHouseView(h) {
  if (!h) return null;
  const { money, infantry, navy, navyBuilding, dragons, infantryCost, navyCost, marches, hasAttackedThisRound, commandUsedRound, lockedUntilRound, spyReports, ledger, ...definition } = h;
  const members = [...players.values()].filter(p => p.houseId === h.id).map(p => ({ id: p.id, username: p.username, connected: p.connected, left: Boolean(p.left) }));
  if (!buffsOn()) { definition.buff = null; definition.nerf = null; }
  return { ...definition, players: members, capitalCount: capitals.filter(c => c.ownerHouseId === h.id).length, fallen: houseFallen(h) };
}
function makePrivateHouseView(h) {
  if (!h) return null;
  const me = h.playerId ? players.get(h.playerId) : null;
  const marchViews = (h.marches || []).map(m => ({ ...m, targetName: findCapital(m.targetCapitalId)?.name || m.targetName, units: { ...m.units } }));
  return {
    id: h.id, name: h.name, fallen: houseFallen(h), money: h.money || 0, infantry: h.infantry || 0, navy: h.navy || 0, navyBuilding: h.navyBuilding || 0, dragons: h.dragons || 0,
    infantryCost: h.infantryCost, navyCost: h.navyCost,
    capitalCount: capitals.filter(c => c.ownerHouseId === h.id).length, incomePerCapital: incomePerCapital(h), incomePerRound: me ? playerIncome(me) : 0, upkeepPerRound: armySize({ infantry: h.infantry || 0, navy: h.navy || 0, dragons: h.dragons || 0 }),
    cityId: me?.cityId || null,
    sieges: siegesFor(h),
    marches: marchViews,
    pendingAttack: marchViews.find(m => !m.returning) || null,
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
    ready: { ...readyInfo(), me: Boolean(me && me.ready) },
    phaseEndsAt: gameSettings.roundSeconds > 0 && !gameOver && phaseTimers.get(activeRoomCode)?.key === `${round}:${phase}` ? phaseTimers.get(activeRoomCode).endsAt : null,
    gameOver: gameOver ? { ...gameOver, winners: gameOver.winners } : null,
    dragonsLeft: isLastDragon() ? dragonIds.filter(id => !dragonDefeated(id)).length : null,
    dragon: me && dragonIds.includes(me.id) ? { fellow: dragonList().filter(d => d.id !== me.id) } : null,
    crownOffer: Boolean(me && capitals.some(c => c.vacant && c.offerTo === me.id)),
    throneVacant: capitals.some(c => c.vacant),
    isHost: Boolean(me && me.id === hostId), isKing: Boolean(me && me.id === kingPlayerId), isHand: Boolean(me && me.id === handPlayerId),
    me: me ? { id: me.id, username: me.username, pendingName: me.pendingName || null, houseId: me.houseId, lastSpyRound: me.lastSpyRound, lastDragonSpyRound: me.lastDragonSpyRound || 0, eliminated: Boolean(me.eliminated) } : null,
    myHouse: makePrivateHouseView(me?.w || myHouse),
    houses: houses.map(currentHouseView),
    players: [...players.values()].map(p => (me && me.id === kingPlayerId ? { ...playerPublic(p), traitor: Boolean(p.traitor) } : playerPublic(p))),
    notices: myHouse ? notices.filter(n => !(n.exceptPlayerIds || []).includes(me.id) && (n.playerIds.includes(me.id) || n.houseIds.includes(myHouse.id))).slice(0, 30).map(n => ({ id: n.id, round: n.round, kind: n.kind, title: n.title, text: n.text, banners: [...n.banners], battle: n.battle || null })) : [],
    decrees: myHouse ? taxLedger.filter(d => d.kingPlayerId === me.id || me.id === handPlayerId || d.recipients.some(r => r.houseId === myHouse.id)).slice(0, 20).map(d => {
      const issuer = d.kingPlayerId === me.id;
      return { id: d.id, round: d.round, kingName: d.kingName, kingHouseId: d.kingHouseId, message: d.message, gold: d.gold, infantry: d.infantry, navy: d.navy, isIssuer: issuer, myState: d.recipients.find(r => r.houseId === myHouse.id)?.state || null, recipients: me.id === handPlayerId ? d.recipients.map(r => ({ ...r })) : undefined };
    }) : [],
    shipTravel: shipTable(),
    capitals: capitals.map(({ siege, ...c }) => ({ ...c, siege: siegePublic({ siege }), income: capitalIncome(c), residents: residentsOf(c).length })),
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
const HANDLERS = {};
function action(socket, eventName, handler) {
  HANDLERS[eventName] = handler;
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
  // No extra notices here: everyone sees the single "new king" popup (the client announces the change of king itself).
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
  const adv = parseAdvanced(payload, gameSettings); if (adv.error) return adv;
  const base = { configured: true, maxPlayers, gameType, teamSize, dragonCount: ds.dragonCount, dragonRounds: ds.dragonRounds, friendlyFire: payload.friendlyFire !== false, ...adv };
  const room = housesProblem(base); if (room) return { error: room };
  return base;
}
// Optional rules, house list, popups and round timer. Missing fields keep their previous value.
function parseAdvanced(payload, prev = {}) {
  const get = (k) => (payload[k] === undefined ? (prev[k] ?? ADVANCED_DEFAULTS[k]) : payload[k]);
  const ids = houses.map(h => h.id);
  const disabledHouses = [...new Set((Array.isArray(get('disabledHouses')) ? get('disabledHouses') : []).map(String))].filter(id => ids.includes(id));
  const disabledPopups = [...new Set((Array.isArray(get('disabledPopups')) ? get('disabledPopups') : []).map(String))].filter(k => POPUP_KINDS.includes(k));
  const roundSeconds = Number(get('roundSeconds') || 0);
  if (roundSeconds !== 0 && (!Number.isInteger(roundSeconds) || roundSeconds < 30 || roundSeconds > 3600)) return { error: 'Choose a round time limit between 30 seconds and 60 minutes, or none.' };
  const readyMode = ['wait', 'bypass', 'off'].includes(get('readyMode')) ? get('readyMode') : 'bypass';
  return { alliancesEnabled: get('alliancesEnabled') !== false, handEnabled: get('handEnabled') !== false, houseBuffs: get('houseBuffs') !== false, disabledHouses, disabledPopups, roundSeconds, readyMode };
}
// Enough houses must stay in the game for the player limit.
function housesProblem(cfg) {
  const open = houses.filter(h => !(cfg.disabledHouses || []).includes(h.id) && !(cfg.gameType === 'LAST_DRAGON' && h.id === 'targaryen')).length;
  const seats = cfg.gameType === 'TEAMS' ? open * cfg.teamSize : open;
  if (open < 2) return 'Keep at least two houses in the game.';
  if (cfg.maxPlayers > seats) return `Only ${open} house${open === 1 ? ' is' : 's are'} left in the game, so at most ${seats} players fit. Lower the player limit or put a house back.`;
  return null;
}
// Existing players must fit the chosen mode.
function settingsConflict(next) {
  const active = [...players.values()].filter(p => !p.left);
  if (active.length > next.maxPlayers) return `The player limit cannot be lower than the ${active.length} players already joined.`;
  const by = {}; for (const p of active) if (p.houseId) by[p.houseId] = (by[p.houseId] || 0) + 1;
  if (next.gameType === 'TEAMS') { if (Object.values(by).some(n => n > next.teamSize)) return `A team already has more than ${next.teamSize} players.`; }
  else if (Object.values(by).some(n => n > 1)) return 'Two players share a house. Each player needs their own house in this mode.';
  const stuck = (next.disabledHouses || []).find(id => by[id]); if (stuck) return `Someone already chose House ${houseName(stuck)}. Ask them to pick another house before removing it from the game.`;
  if (next.gameType === 'LAST_DRAGON' && by.targaryen) return 'Someone already chose House Targaryen, which is not available in Last Dragon. Ask them to pick another house first.';
  return null;
}
// Returns an error message if `playerId` may not take house `h`, otherwise null.
function houseError(h, playerId) {
  if ((gameSettings.disabledHouses || []).includes(h.id)) return `House ${h.name} is not in this game.`;
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
function nameTaken(name, exceptId) { const n = String(name).toLowerCase(); return [...players.values()].some(p => !p.left && p.id !== exceptId && (p.username.toLowerCase() === n || (p.pendingName && p.pendingName.toLowerCase() === n))); }
const nameTakenMsg = name => `The name “${name}” is already used in this lobby. Choose a different one.`;
// Players who can press Ready: everyone in the game except the host (who decides when to move on).
function readyPlayers() { return [...players.values()].filter(p => !p.left && !p.isBot && !p.eliminated && p.houseId && p.connected && p.id !== hostId); }
function readyInfo() { const list = readyPlayers(); return { mode: gameSettings.readyMode || 'bypass', ready: list.filter(p => p.ready).length, total: list.length }; }
function clearReady() { for (const p of players.values()) p.ready = false; }
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
// Public popups (everyone) vs personal popups (named houses/players). `exceptIds` skips players who get a personal popup for the same event.
function notifyAll(kind, title, text, banners, exceptIds = []) { notify(kind, [], [...players.values()].filter(p => !p.left).map(p => p.id), title, text, banners, exceptIds); }
function notify(kind, houseIds, playerIds, title, text, banners, exceptIds = []) {
  const entry = { id: randomUUID(), round, kind, houseIds: [...new Set(houseIds)], playerIds, exceptPlayerIds: exceptIds, title, text: String(text).slice(0, kind.startsWith('round-') ? 500 : 260), banners };
  notices.unshift(entry);
  if (notices.length > 60) notices.length = 60;
  return entry;
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
      gameSettings = next; refreshHouseCosts();
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
      if (player?.kicked) return fail('The host removed you from this game.');
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
    gameSettings = next; refreshHouseCosts();
    addEvent('important', `The host set up a ${MODE_LABEL[next.gameType]} game for ${next.maxPlayers} players.`);
    return ok('Game setup saved. The hall is open.');
  });

  action(socket, 'edit-player-name', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    const name = String(payload.username || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 22) return fail('Name must be between 2 and 22 characters.');
    if (nameTaken(name, player.id)) return fail(nameTakenMsg(name));
    if (phase !== 'LOBBY') {
      if (name === player.username) { delete player.pendingName; return ok('Your name stays the same.'); }
      player.pendingName = name;
      return ok(`Your new name, ${name}, will take effect after this game ends.`);
    }
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
    const target = players.get(String(payload.playerId || ''));
    if (!target || (target.isBot && phase === 'LOBBY')) return fail('That player is no longer in the lobby.');
    if (target.id === player.id) return fail('You cannot remove yourself.');
    const sock = target.socketId ? io.sockets.sockets.get(target.socketId) : null;
    if (phase !== 'LOBBY') {
      // Mid-game removal: the player is defeated and cannot come back. If they wore the crown, the throne falls vacant.
      target.left = true; target.kicked = true; target.eliminated = true; target.connected = false; target.socketId = null;
      if (target.w) { target.w.marches = []; }
      if (target.id === kingPlayerId) {
        const throne = capitals.find(c => c.id === 'kings-landing');
        kingPlayerId = null; handPlayerId = null;
        if (throne) { throne.ownerHouseId = null; throne.ownerPlayerId = null; throne.vacant = true; throne.offerTo = null; throne.forfeitedBy = { name: target.username, houseId: target.houseId }; }
        notifyAll('crown', 'There is no king', `${target.username} was removed from the game. King’s Landing is open: the first army to reach it takes the throne without a fight.`, [target.houseId].filter(Boolean));
      } else if (target.id === handPlayerId) handPlayerId = null;
      if (sock) { sock.data.playerId = null; sock.data.gameCode = null; sock.leave(socket.data.gameCode); sock.emit('game-ended', { message: 'The host removed you from the game.' }); }
      addEvent('important', `${target.username} was removed from the game by the host.`);
      checkVictory();
      return ok(`${target.username} was removed.`);
    }
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

  action(socket, 'mute-player', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can mute players.');
    const target = players.get(String(payload.playerId || ''));
    if (!target || target.left) return fail('That player is not in the game.');
    if (target.id === player.id) return fail('You cannot mute yourself.');
    target.muted = payload.muted !== false;
    addEvent('normal', `${target.username} was ${target.muted ? 'muted' : 'unmuted'} by the host.`);
    return ok(`${target.username} is ${target.muted ? 'muted' : 'no longer muted'}.`);
  });

  // Host rules & options. Rules that shape the game (alliances, Hand, buffs, houses) can only change in the lobby;
  // popups and the round timer can change at any time.
  action(socket, 'set-advanced-settings', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can change game settings.');
    const lobby = phase === 'LOBBY';
    const merged = { ...payload };
    if (!lobby) for (const k of ['alliancesEnabled', 'handEnabled', 'houseBuffs', 'disabledHouses']) delete merged[k];
    const adv = parseAdvanced(merged, gameSettings); if (adv.error) return fail(adv.error);
    const next = { ...gameSettings, ...adv };
    if (lobby) {
      const problem = housesProblem(next); if (problem) return fail(problem);
      const conflict = settingsConflict(next); if (conflict) return fail(conflict);
    }
    gameSettings = next; refreshHouseCosts();
    addEvent('important', 'The host updated the game settings.');
    return ok('Game settings saved.');
  });

  action(socket, 'start-game', player => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the lobby host can begin the game.');
    refreshHouseCosts();
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
    if (!handOn()) {
      handPlayerId = null;
      phase = 'ACTION';
      round = 1;
      for (const h of houses) h.hasAttackedThisRound = false;
      addEvent('important', `${king?.username || 'A player'} is the king. This game has no Hand of the King.`);
      addEvent('important', 'Round 1 begins. The game is underway.');
      return ok('Round 1 begins. This game has no Hand of the King.');
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
    if (!handOn()) return fail('This game has no Hand of the King.');
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
    if (!handOn()) return fail('This game has no Hand of the King.');
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
    if (!Number.isInteger(amount) || amount < 1) return fail('Choose a whole number of units, at least 1.');
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
    if (unit === 'dragons') return fail('Dragons cannot be disbanded.');
    if (!['infantry', 'navy'].includes(unit)) return fail('Choose a unit type to disband.');
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
    const isDragonHunt = payload.mission === 'dragon';
    if (isDragonHunt && !isLastDragon()) return fail('Dragon hunts only happen in Last Dragon games.');
    if (isDragonHunt ? player.lastDragonSpyRound === round : player.lastSpyRound === round) return fail(isDragonHunt ? 'You have already hunted for dragons this round.' : 'You have already sent spies this round.');
    const target = findHouse(String(payload.targetHouseId || ''));
    if (!target || target.id === h.id) return fail('Choose another house as your target.');
    if (!houseMembers(target.id).length) return fail('That house has no players in this game.');
    const spend = Number(payload.spend ?? 8);
    if (!Number.isInteger(spend) || spend < 2 || spend > 20) return fail('Spend between 2 and 20 gold on a spy mission.');
    const spendCost = spend;
    if (h.money < spendCost) return fail(`You chose to spend ${spend} gold, but your house only has ${h.money}.`);
    h.money -= spendCost;
    note(h, 'gold', -spendCost, `Spy mission against House ${target.name}`);
    if (isDragonHunt) player.lastDragonSpyRound = round; else player.lastSpyRound = round;
    const mission = SPY_MISSIONS[payload.mission] ? payload.mission : 'war';
    const odds = spyOdds(spend, target.id, mission);
    const success = Math.random() < odds.success;
    const caught = !success && Math.random() < odds.caught;
    const report = { id: randomUUID(), targetHouseId: target.id, targetName: target.name, round, mission, success, caught, spent: spend, ...(success ? { findings: spyFindings(mission, target) } : {}) };
    h.spyReports.unshift(report);
    if (h.spyReports.length > 15) h.spyReports.length = 15;
    addEvent('normal', caught ? `Spies were caught in House ${target.name}'s halls.` : `House ${h.name} sent spies toward House ${target.name}.`);
    if (caught) { notify('spy-caught', [target.id], [], 'Spies caught', `Agents of House ${capWord(h.name)} were caught spying on your house.`, [h.id, target.id]); botOnSpyCaught(h.id, target.id, player); }
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
    // One popup for everyone; the Hand's crown dialog handles the offer itself.
    notifyAll('crown', 'The crown is forfeited', offerTo ? `${player.username} forfeited the crown and returned to ${home.name}. The Hand must choose whether to take the throne.` : `${player.username} forfeited the crown and returned to ${home.name}. King’s Landing is open: the first army to reach it takes the throne without a fight.`, [player.houseId]);
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
    botOnGift(to, player, gold, infantry, navy);
    return ok(`Gift sent to ${to.username}.`);
  });

  action(socket, 'plan-attack', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    const h = check;
    if (phase !== 'ACTION') return fail('Attacks can only be ordered during the action phase.');
    if (round < 2) return fail('Attacks unlock after Round 1.');
    const target = findCapital(String(payload.targetCapitalId || ''));
    if (!target || target.contested || (!target.ownerHouseId && !target.vacant)) return fail('Choose a city held by someone else.');
    if (target.ownerPlayerId === player.id) return fail('That city is already yours.');
    const sameHouse = target.ownerHouseId === h.id, allyTarget = !sameHouse && areAllied(h.id, target.ownerHouseId);
    const isRelief = Boolean(target.siege) && (sameHouse || allyTarget);
    if (!isRelief && sameHouse && !gameSettings.friendlyFire) return fail('Friendly fire is off: you cannot attack a city held by your own house.');
    if (!isRelief && allyTarget && !gameSettings.friendlyFire) return fail(`Friendly fire is off: House ${houseName(target.ownerHouseId)} is your ally.`);
    const units = { infantry: Number(payload.infantry), navy: Number(payload.navy), dragons: Number(payload.dragons) };
    if (!isRelief && target.id === 'winterfell' && units.navy > 0 && buffsOn()) return fail('Winterfell cannot be attacked by ships. Send land forces only.');
    if (Object.values(units).some(n => !Number.isInteger(n) || n < 0)) return fail('Committed forces must be whole numbers of zero or greater.');
    if (units.infantry + units.navy + units.dragons < 1) return fail('Commit at least one unit to the attack.');
    if (units.infantry > h.infantry || units.navy > h.navy || units.dragons > h.dragons) return fail('You do not have enough uncommitted forces.');
    h.infantry -= units.infantry;
    h.navy -= units.navy;
    h.dragons -= units.dragons;
    for (const k of ['infantry', 'navy', 'dragons']) note(h, k, -units[k], isRelief ? `Sent to relieve ${target.name}` : `Sent to war on ${target.name}`);
    const origin = findCapital(player.cityId) || homeCityOf(player) || target;
    const march = { id: randomUUID(), targetCapitalId: target.id, targetName: target.name, orderedRound: round, resolveRound: round + attackTravel(origin, target, units), units, playerId: player.id, relief: isRelief, fromX: origin.x, fromY: origin.y, toX: target.x, toY: target.y, homeX: origin.x, homeY: origin.y, returning: false };
    (h.marches ||= []).push(march);
    h.hasAttackedThisRound = true;
    addEvent('normal', isRelief ? `House ${h.name} sent an army to relieve a besieged city.` : `House ${h.name} secretly committed an attack against a capital.`);
    if (isRelief) return ok(`Relief army sent. It reaches ${target.name} after Round ${march.resolveRound} court.`);
    return ok(`Attack order placed. Your forces arrive after Round ${march.resolveRound} court.`);
  });

  action(socket, 'cancel-march', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    const h = check;
    if (phase !== 'ACTION') return fail('Armies can only be recalled during the action phase.');
    const m = (h.marches || []).find(x => x.id === String(payload.marchId || ''));
    if (!m) return fail('That army is no longer on the march.');
    if (m.returning) return fail('That army is already marching home.');
    const elapsed = Math.max(0, round - m.orderedRound);
    if (elapsed <= 0) {
      h.marches.splice(h.marches.indexOf(m), 1);
      returnArmy(armyEntry(m.playerId, h.id, m.units), `Recalled from ${m.targetName}`);
      addEvent('normal', `House ${h.name} recalled an army before it left.`);
      return ok('The order was cancelled. Your soldiers never left.');
    }
    const at = marchPos(m, round);
    Object.assign(m, { returning: true, fromX: at.x, fromY: at.y, toX: m.homeX, toY: m.homeY, orderedRound: round, resolveRound: round + elapsed });
    addEvent('normal', `House ${h.name} recalled an army from the road to ${m.targetName}.`);
    return ok(`Your army turned back. It reaches home after Round ${m.resolveRound} court.`);
  });

  action(socket, 'withdraw-army', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (phase !== 'ACTION') return fail('Armies can only be withdrawn during the action phase.');
    const c = findCapital(String(payload.capitalId || ''));
    if (!c || !c.siege) return fail('There is no siege there.');
    let found = false;
    for (const key of ['attackers', 'relief']) {
      const list = c.siege[key], e = list.find(x => x.playerId === player.id);
      if (!e) continue;
      found = true; returnArmy(e, `Army withdrawn from ${c.name}`); list.splice(list.indexOf(e), 1);
    }
    if (!found) return fail('Your house has no army at that siege.');
    if (!c.siege.attackers.length) {
      for (const e of c.siege.relief) returnArmy(e, `Relief army returned from ${c.name}`);
      c.siege = null;
      addEvent('battle', `The siege of ${c.name} was lifted.`);
    }
    return ok('Your army has marched home.');
  });

  action(socket, 'offer-alliance', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (!alliancesOn()) return fail('Alliances are disabled in this game.');
    if (!canDiplomacy()) return fail('Alliance offers can be sent during the action and court phases.');
    const target = findHouse(String(payload.targetHouseId || ''));
    const scope = payload.scope === 'secret' ? 'secret' : 'public';
    if (!target || target.id === check.id) return fail('Choose another house.');
    if (!houseMembers(target.id).length) return fail(`No player leads House ${target.name} in this game.`);
    if (areAllied(check.id, target.id)) return fail('Your houses already have an alliance.');
    if (allianceOffers.some(o => o.fromHouseId === check.id && o.toHouseId === target.id)) return fail('Your house already has an outstanding offer to that house.');
    if (allianceOffers.some(o => o.fromHouseId === target.id && o.toHouseId === check.id)) return fail(`House ${target.name} already offered you an alliance. Accept it in the Relations menu.`);
    allianceOffers.unshift({ id: randomUUID(), fromHouseId: check.id, toHouseId: target.id, scope, round });
    addEvent('normal', scope === 'public' ? `House ${check.name} publicly offered an alliance to House ${target.name}.` : `House ${check.name} sent a secret alliance offer.`);
    return ok('Alliance offer sent.');
  });

  action(socket, 'respond-alliance', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (!alliancesOn()) return fail('Alliances are disabled in this game.');
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
    botOnBetrayed(check.id, other);
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
    if (target.traitor) { botOnTraitor(target, player); const kh = findHouse(player.houseId); notify('traitor', [], [target.id], 'Branded a traitor', `King ${player.username} has named you a traitor to the crown.`, kh ? [kh.id] : []); }
    return ok(target.traitor ? `${target.username} is now labelled a traitor.` : `${target.username} has been pardoned.`);
  });

  action(socket, 'send-chat', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (player.muted) return fail('The host has muted you.');
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

  action(socket, 'advance-phase', (player, payload = {}) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can advance the game.');
    if (gameOver) return fail('The game is over. Return to the lobby to play again.');
    const ri = readyInfo();
    if (ri.mode === 'wait' && ri.ready < ri.total) return fail(`Waiting for everyone to be ready (${ri.ready}/${ri.total}).`);
    if (ri.mode === 'bypass' && ri.ready < ri.total && !payload.force) return fail(`Only ${ri.ready} of ${ri.total} players are ready.`);
    return advancePhase();
  });

  action(socket, 'toggle-ready', player => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (gameOver || !['ACTION', 'COURT', 'RESOLUTION'].includes(phase)) return fail('There is nothing to be ready for right now.');
    if ((gameSettings.readyMode || 'bypass') === 'off') return fail('Ready buttons are turned off in this game.');
    if (!readyPlayers().includes(player)) return fail('You do not need to press ready.');
    player.ready = !player.ready;
    return ok(player.ready ? 'You are ready.' : 'You are no longer ready.');
  });

  action(socket, 'reset-game', (player) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can reset the game.');
    resetWorld(true, true);
    return ok('New game ready. Everyone keeps their house; start when ready.');
  });
});

// Moves the round on: action -> court -> resolution -> next round. Used by the host's button and the round timer.
function advancePhase() { clearReady(); return advancePhaseStep(); }
function advancePhaseStep() {
  if (phase === 'ACTION') {
    phase = 'COURT';
    addEvent('important', `Round ${round} action phase ended. Court is now in session.`);
    return ok('Court is now in session.');
  }
  if (phase === 'COURT' || phase === 'RESOLUTION') {
    if (phase === 'COURT') {
      resolveDueAttacks();
      settleSpoils(true);
      addEvent('important', `Round ${round} court has concluded.`);
      checkVictory(true);
      if (gameOver) { phase = 'RESOLUTION'; return ok('The realm has been decided.'); }
    }
    return startNextRound();
  }
  return fail('Use the election controls to leave the lobby or close the ballot.');
}
// Court ends and the next round begins in one step: income, upkeep, finished ships. Each player gets one start-of-round report.
function startNextRound() {
  round += 1;
  phase = 'ACTION';
  for (const p of players.values()) {
    const h = p.w;
    if (!h || p.left) continue;
    h.hasAttackedThisRound = false;
    const lines = [];
    let bad = false;
    const startGold = h.money;
    if (h.navyBuilding) { const n = h.navyBuilding; h.navy += n; note(h, 'navy', n, 'Ships finished building'); h.navyBuilding = 0; lines.push(`${n} ${n === 1 ? 'ship' : 'ships'} finished building`); }
    if (p.eliminated) continue;
    const income = playerIncome(p);
    h.money += income;
    note(h, 'gold', income, 'City income');
    lines.unshift(findCapital(p.cityId)?.siege ? `Your city is under siege and pays no income` : `+${income} gold from your cities`);
    // Army upkeep: 1 gold per unit, taken automatically. Unpaid troops desert.
    const due = armySize(h);
    const paid = Math.min(due, h.money);
    h.money -= paid;
    note(h, 'gold', -paid, `Army upkeep (${due} units)`);
    if (due) lines.splice(1, 0, `\u2212${paid} gold for army upkeep (${due} units)`);
    let short = due - paid;
    if (short > 0) {
      const deserted = [];
      for (const k of ['infantry', 'navy', 'dragons']) {
        const take = Math.min(h[k], short);
        if (!take) continue;
        h[k] -= take; short -= take;
        note(h, k, -take, 'Deserted: upkeep unpaid');
        deserted.push(`${take} ${k === 'navy' ? 'ships' : k}`);
      }
      lines.push(`Deserted, upkeep unpaid: ${deserted.join(', ')}`);
      bad = true;
      addEvent('normal', `Unpaid troops deserted ${p.username} of House ${h.name}.`);
    }
    const net = h.money - startGold;
    lines.push(`Treasury: ${h.money} gold (${net >= 0 ? '+' : '\u2212'}${Math.abs(net)} this round)`);
    notify(bad ? 'round-bad' : 'round-start', [], [p.id], `Round ${round} begins`, lines.join('\n'), [h.id]);
  }
  addEvent('important', `Round ${round} begins. Houses received capital income and paid army upkeep.`);
  return ok(`Round ${round} has begun. Capital income and army upkeep have been settled.`);
}
// ---- Sieges ---------------------------------------------------------------
// An attack arrives and lays siege. Every court, each unit on both sides rolls a die (dragons add +3). Each side's dice are lined up
// from highest to lowest and compared in pairs: the higher roll wins and the loser's unit is lost; ties go to the defenders. Dice with
// no opponent are discarded. The defenders are the city's garrison, the owner's home army and any relief armies. The siege goes on
// until one side has no units left; while it lasts the city pays no income.
const UNIT_KEYS = ['infantry', 'navy', 'dragons'];
const emptyUnits = () => ({ infantry: 0, navy: 0, dragons: 0 });
const unitTotal = u => (u.infantry || 0) + (u.navy || 0) + (u.dragons || 0);
const rollDie = unit => randomInt(1, 6) + (unit === 'dragons' ? 3 : 0);
function garrisonFor(target, defender) {
  let g = target.defense;
  if (buffsOn() && ((defender?.id === 'stark' && target.id === 'winterfell') || (defender?.id === 'martell' && target.id === 'sunspear') || (defender?.id === 'arryn' && target.id === 'the-eyrie'))) g += 2;
  return g;
}
function armyEntry(playerId, houseId, units) { return { playerId, houseId, units: { ...emptyUnits(), ...units } }; }
function addArmy(list, entry) {
  const found = list.find(e => e.playerId === entry.playerId);
  if (!found) { list.push(armyEntry(entry.playerId, entry.houseId, entry.units)); return; }
  for (const k of UNIT_KEYS) found.units[k] += entry.units[k] || 0;
}
function returnArmy(entry, why = 'Army returned home') {
  const p = players.get(entry.playerId), w = p && p.w;
  if (!w || p.eliminated) return;
  for (const k of UNIT_KEYS) { const n = entry.units[k] || 0; if (n > 0) { w[k] += n; note(w, k, n, why); } entry.units[k] = 0; }
}
function siegePublic(c) {
  const s = c.siege; if (!s) return null;
  return { attackerHouseIds: [...new Set(s.attackers.map(e => e.houseId))], reliefHouseIds: [...new Set(s.relief.map(e => e.houseId))], battles: s.battles, garrison: s.garrison, startRound: s.startRound };
}
function siegesFor(h) {
  const out = [];
  for (const c of capitals) {
    if (!c.siege) continue;
    for (const [role, list] of [['attacker', c.siege.attackers], ['relief', c.siege.relief]]) {
      const e = list.find(x => x.playerId === h.playerId);
      if (e) out.push({ capitalId: c.id, capitalName: c.name, role, units: { ...e.units } });
    }
  }
  return out;
}
// Where a marching army is at time t (in rounds), moving in a straight line between its start and end points.
function marchPos(m, t) {
  const f = clampN((t - m.orderedRound) / Math.max(1, m.resolveRound - m.orderedRound), 0, 1);
  return { x: m.fromX + (m.toX - m.fromX) * f, y: m.fromY + (m.toY - m.fromY) * f };
}
// Enemy armies that cross paths on the road fight where they stand. Nobody defends, so tied dice are simply discarded.
const MEET_RADIUS = 34;
function resolveFieldBattles() {
  const all = [];
  for (const p of players.values()) if (p.w) for (const m of (p.w.marches || [])) if (!m.returning && !m.relief) all.push({ m, w: p.w });
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const A = all[i], B = all[j];
    if (unitTotal(A.m.units) < 1 || unitTotal(B.m.units) < 1) continue;
    if (A.w.id === B.w.id || areAllied(A.w.id, B.w.id) || A.m.targetCapitalId === B.m.targetCapitalId) continue;
    let met = null;
    const t0 = Math.max(round - 1, A.m.orderedRound, B.m.orderedRound);
    if (t0 >= round) continue;
    for (let k = 0; k <= 50; k++) {
      const t = t0 + (round - t0) * k / 50, pa = marchPos(A.m, t), pb = marchPos(B.m, t);
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) <= MEET_RADIUS) { met = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }; break; }
    }
    if (met) fightOnTheRoad(A, B);
  }
  for (const p of players.values()) if (p.w) p.w.marches = (p.w.marches || []).filter(m => unitTotal(m.units) > 0);
}
function fightOnTheRoad(A, B) {
  const ids = new Set([A.w.id, B.w.id]);
  let exchange = 0;
  addEvent('battle', `The armies of House ${A.w.name} and House ${B.w.name} met on the road.`);
  while (unitTotal(A.m.units) > 0 && unitTotal(B.m.units) > 0 && exchange < 40) {
    exchange += 1;
    const dice = (m, w) => { const d = []; for (const k of UNIT_KEYS) for (let i = 0; i < m.units[k]; i++) d.push({ v: rollDie(k), unit: k, houseId: w.id }); return d.sort((x, y) => y.v - x.v); };
    const da = dice(A.m, A.w), db = dice(B.m, B.w), pairs = Math.min(da.length, db.length);
    let aLost = 0, bLost = 0, ties = 0;
    for (let i = 0; i < pairs; i++) {
      if (da[i].v > db[i].v) { db[i].lost = true; bLost++; B.m.units[db[i].unit] -= 1; }
      else if (db[i].v > da[i].v) { da[i].lost = true; aLost++; A.m.units[da[i].unit] -= 1; }
      else { da[i].tied = db[i].tied = true; ties++; }
    }
    const done = unitTotal(A.m.units) < 1 || unitTotal(B.m.units) < 1;
    const mapDie = d => ({ v: d.v, unit: d.unit, houseId: d.houseId, lost: Boolean(d.lost), tied: Boolean(d.tied) });
    const battle = { id: randomUUID(), field: true, capitalId: null, capitalName: 'the road', battleNo: exchange, round, attackers: da.map(mapDie), defenders: db.map(mapDie), pairs, attLost: aLost, defLost: bLost, ties, result: done ? 'ended' : 'continues' };
    const n2 = notify('battle-report', [...ids], [], 'Armies clash on the road', `House ${capWord(A.w.name)} lost ${aLost}, House ${capWord(B.w.name)} lost ${bLost}.`, [A.w.id, B.w.id]);
    n2.battle = battle;
    addEvent('battle', `Field battle, exchange ${exchange}: House ${A.w.name} lost ${aLost}, House ${B.w.name} lost ${bLost}${ties ? `, ${ties} tied ${ties === 1 ? 'pair' : 'pairs'} discarded` : ''}.`);
    if (events[0]) events[0].battle = battle;
    events.filter(e => e.battle).slice(12).forEach(e => { delete e.battle; });
  }
  for (const [X, Y] of [[A, B], [B, A]]) {
    if (unitTotal(X.m.units) < 1) notify('battle-lost', [X.w.id], [], 'Army destroyed on the road', `Your army marching on ${X.m.targetName} was destroyed by House ${capWord(Y.w.name)}.`, [X.w.id, Y.w.id]);
    else notify('battle-won', [X.w.id], [], 'Victory on the road', `Your army defeated House ${capWord(Y.w.name)}'s on the way to ${X.m.targetName} and marches on.`, [X.w.id, Y.w.id]);
  }
  for (const h of [A.w, B.w]) for (const b of botsOf(h.id === A.w.id ? B.w.id : A.w.id)) botAi(b).attackedBy[h.id] = round;
}
function resolveDueAttacks() {
  resolveFieldBattles();
  const due = [];
  for (const p of players.values()) {
    const w = p.w; if (!w) continue;
    for (const m of [...(w.marches || [])]) if (m.resolveRound <= round) { w.marches.splice(w.marches.indexOf(m), 1); due.push({ w, m }); }
  }
  for (const { w, m } of due) {
    if (m.returning) { returnArmy(armyEntry(m.playerId, w.id, m.units), 'Army returned home'); continue; }
    arriveArmy(w, m);
  }
  for (const c of capitals) if (c.siege) fightSiegeRound(c);
}
function arriveArmy(w, order) {
  const target = findCapital(order.targetCapitalId);
  const entry = armyEntry(order.playerId, w.id, order.units);
  if (order.relief) {
    const ok2 = target?.siege && target.ownerHouseId && target.ownerPlayerId !== order.playerId && (target.ownerHouseId === w.id || areAllied(w.id, target.ownerHouseId));
    if (!ok2) { returnArmy(entry); addEvent('normal', `House ${w.name}'s relief army found no siege to lift at ${order.targetName} and marched home.`); return; }
    addArmy(target.siege.relief, entry);
    addEvent('battle', `House ${w.name} sent an army to relieve ${target.name}.`);
    notify('notice', [target.ownerHouseId, w.id], [], 'Relief has arrived', `House ${capWord(w.name)}'s army joined the defence of ${target.name}.`, [w.id, target.ownerHouseId]);
    return;
  }
  const ffOff = !gameSettings.friendlyFire && target && target.ownerHouseId && (target.ownerHouseId === w.id || areAllied(w.id, target.ownerHouseId));
  if (!target || (!target.ownerHouseId && !target.vacant) || target.ownerPlayerId === order.playerId || ffOff) {
    addEvent('battle', `House ${w.name} found no enemy holding at ${order.targetName}; the army marched home.`);
    returnArmy(entry);
    return;
  }
  if (target.vacant) { captureCity(target, [entry], 'unopposed'); return; }
  const defender = findHouse(target.ownerHouseId);
  if (defender && defender.id !== w.id && areAllied(w.id, defender.id)) {
    const pact = alliances.find(x => [x.houseA, x.houseB].includes(w.id) && [x.houseA, x.houseB].includes(defender.id));
    if (pact) { alliances.splice(alliances.indexOf(pact), 1); notify('alliance-broken', [w.id, defender.id], [], 'Allies at war', `House ${capWord(w.name)} marched on its ally House ${capWord(defender.name)}. The alliance is broken.`, [w.id, defender.id]); }
  }
  if (defender && defender.id !== w.id) botOnAttacked(w.id, defender.id);
  if (!target.siege) {
    target.siege = { id: randomUUID(), startRound: round, battles: 0, attackers: [], relief: [], garrison: garrisonFor(target, defender) };
    addEvent('important', `${target.name} is under siege by House ${w.name}.`);
    if (target.id === 'kings-landing') notifyAll('siege', 'King’s Landing is under siege', `House ${capWord(w.name)} has laid siege to King’s Landing.`, [w.id]);
    else if (defender) notify('attacked', [defender.id], [], `${target.name} is under siege`, `House ${capWord(w.name)} has laid siege to ${target.name}. It pays no income until the siege ends.`, [w.id, defender.id]);
  }
  addArmy(target.siege.attackers, entry);
}
function buildDice(c) {
  const s = c.siege, defender = findHouse(c.ownerHouseId);
  const defWallet = c.ownerPlayerId ? players.get(c.ownerPlayerId)?.w : null;
  const att = [], def = [];
  for (const e of s.attackers) for (const k of UNIT_KEYS) for (let i = 0; i < e.units[k]; i++) att.push({ v: rollDie(k), unit: k, houseId: e.houseId, ref: e });
  for (let i = 0; i < s.garrison; i++) def.push({ v: rollDie('infantry'), unit: 'garrison', houseId: c.ownerHouseId, order: 0 });
  for (const e of s.relief) for (const k of UNIT_KEYS) for (let i = 0; i < e.units[k]; i++) def.push({ v: rollDie(k), unit: k, houseId: e.houseId, ref: e, order: 1 });
  if (defWallet) for (const k of UNIT_KEYS) for (let i = 0; i < (defWallet[k] || 0); i++) def.push({ v: rollDie(k), unit: k, houseId: c.ownerHouseId, wallet: defWallet, order: 2 });
  att.sort((a, b) => b.v - a.v);
  // Among equal rolls the garrison faces the strongest attackers first, then relief, then the owner's own army.
  def.sort((a, b) => b.v - a.v || a.order - b.order);
  return { att, def, defender, defWallet };
}
function fightSiegeRound(c) {
  const s = c.siege; s.battles += 1;
  const { att, def, defender, defWallet } = buildDice(c);
  const pairs = Math.min(att.length, def.length);
  let attLost = 0, defLost = 0, garrisonLost = 0;
  const defKilled = {};
  for (let i = 0; i < pairs; i++) {
    if (def[i].v >= att[i].v) { att[i].lost = true; attLost++; att[i].ref.units[att[i].unit] -= 1; }
    else {
      def[i].lost = true; defLost++;
      const d = def[i];
      if (d.unit === 'garrison') { s.garrison -= 1; garrisonLost++; }
      else if (d.ref) d.ref.units[d.unit] -= 1;
      else if (d.wallet) { d.wallet[d.unit] -= 1; defKilled[d.unit] = (defKilled[d.unit] || 0) + 1; }
    }
  }
  if (defWallet) for (const [k, n] of Object.entries(defKilled)) note(defWallet, k, -n, `Lost defending ${c.name}`);
  s.attackers = s.attackers.filter(e => unitTotal(e.units) > 0);
  s.relief = s.relief.filter(e => unitTotal(e.units) > 0);
  const attLeft = s.attackers.reduce((n, e) => n + unitTotal(e.units), 0);
  const defLeft = s.garrison + s.relief.reduce((n, e) => n + unitTotal(e.units), 0) + (defWallet ? unitTotal(defWallet) : 0);
  const result = attLeft === 0 ? 'broken' : defLeft === 0 ? 'fell' : 'continues';
  const ids = [...new Set([...att.map(d => d.houseId), ...def.map(d => d.houseId)])];
  const mapDie = d => ({ v: d.v, unit: d.unit, houseId: d.houseId, lost: Boolean(d.lost) });
  const battle = { id: randomUUID(), capitalId: c.id, capitalName: c.name, battleNo: s.battles, round, attackers: att.map(mapDie), defenders: def.map(mapDie), pairs, attLost, defLost, result };
  const involved = [...new Set([...ids, ...s.attackers.map(e => e.houseId), ...houses.filter(x => houseMembers(x.id).length).map(x => x.id)])]; // the whole table watches the dice
  const note2 = notify('battle-report', involved, [], `Battle at ${c.name}`, `Attackers lost ${attLost}, defenders lost ${defLost}.`, [...new Set(att.map(d => d.houseId))].slice(0, 1).concat(c.ownerHouseId ? [c.ownerHouseId] : []));
  note2.battle = battle;
  addEvent('battle', `Siege of ${c.name}, battle ${s.battles}: attackers lost ${attLost}, defenders lost ${defLost}.`);
  if (events[0]) events[0].battle = battle; // kept so anyone can replay the dice from the battle log
  events.filter(e => e.battle).slice(12).forEach(e => { delete e.battle; });
  if (result === 'continues') return;
  const entries = s.attackers;
  const reliefEntries = s.relief;
  if (result === 'broken') {
    addEvent('battle', `The siege of ${c.name} was broken. House ${defender?.name || 'its defenders'} held.`);
    const houseIds = [...new Set(att.map(d => d.houseId))];
    notify('battle-lost', houseIds, [], `Defeat at ${c.name}`, `${houseIds.length > 1 ? 'Your armies' : 'Your army'} failed to take ${c.name}.`, [...houseIds, defender?.id].filter(Boolean));
    if (defender) notify('attacked', [defender.id], [], `${c.name} held`, `The siege of ${c.name} was broken. Your defenders held.`, [...houseIds, defender.id]);
    for (const e of reliefEntries) returnArmy(e, `Relief army returned from ${c.name}`);
    c.siege = null;
    return;
  }
  captureCity(c, entries, `after ${s.battles} ${s.battles === 1 ? 'battle' : 'battles'}`);
  for (const e of reliefEntries) returnArmy(e, `Relief army returned from ${c.name}`);
}
// The attackers have broken the defence. One winner takes the city, or two allied winners split the plunder and settle who rules it.
function captureCity(target, entries, how) {
  const noticesBefore = new Set(notices.map(n => n.id)), wasOver = Boolean(gameOver);
  const defender = findHouse(target.ownerHouseId);
  const defWallet = target.ownerPlayerId ? players.get(target.ownerPlayerId)?.w : null;
  const isThrone = target.id === 'kings-landing', wasVacantThrone = Boolean(target.vacant);
  const sorted = [...entries].sort((x, y) => unitTotal(y.units) - unitTotal(x.units));
  const a = sorted[0];
  const b = sorted.slice(1).find(e => e.houseId !== a.houseId && areAllied(a.houseId, e.houseId)) || null;
  const attacker = players.get(a.playerId).w;
  const allyHouse = b ? players.get(b.playerId).w : null;
  if (allyHouse) {
    const plunder = Math.min(defWallet?.money || 0, 6);
    if (defWallet) defWallet.money -= plunder;
    const share = Math.floor(plunder / 2);
    attacker.money += plunder - share; allyHouse.money += share;
    note(attacker, 'gold', plunder - share, `Plunder from ${target.name}`); note(allyHouse, 'gold', share, `Plunder from ${target.name}`);
    if (defWallet) note(defWallet, 'gold', -plunder, `Plundered at ${target.name}`);
    const fallenIds = sackCity(target, [a.playerId, b.playerId]).map(p => p.id);
    target.ownerHouseId = null; target.ownerPlayerId = null; evictResidents(target);
    target.contested = { houseA: attacker.id, houseB: allyHouse.id };
    const claims = { [attacker.id]: null, [allyHouse.id]: null };
    const spoil = { id: randomUUID(), capitalId: target.id, houseA: attacker.id, houseB: allyHouse.id, claims, round, deadlineRound: round + 1, plunder, status: 'open', orderers: { [attacker.id]: a.playerId, [allyHouse.id]: b.playerId } };
    if (houseIsBotOnly(allyHouse.id)) claims[allyHouse.id] = attacker.id;
    spoils.unshift(spoil);
    addEvent('battle', `Houses ${attacker.name} and ${allyHouse.name} stormed ${target.name} together (${how}) and split ${plunder} gold of plunder. They must agree who will rule it, or fight for it.`);
    if (isThrone) notifyAll('sacked', 'King’s Landing has been sacked', `Houses ${capWord(attacker.name)} and ${capWord(allyHouse.name)} stormed King’s Landing. They must agree who will rule it, or fight for it.`, [attacker.id, allyHouse.id], fallenIds);
    else {
      notify('battle-won', [attacker.id, allyHouse.id], [], `Victory at ${target.name}`, `Houses ${capWord(attacker.name)} and ${capWord(allyHouse.name)} took ${target.name}. Agree who will rule it, or fight for it.`, [attacker.id, allyHouse.id]);
      if (defender) notify('attacked', [defender.id], [], `${target.name} was attacked`, `Houses ${capWord(attacker.name)} and ${capWord(allyHouse.name)} attacked and took ${target.name}.`, [attacker.id, defender.id], fallenIds);
    }
    target.siege = null;
    for (const e of entries) returnArmy(e, `Army returned from ${target.name}`);
    settleSpoils(false);
    return;
  }
  const fallenIds = sackCity(target, [a.playerId]).map(p => p.id);
  target.ownerHouseId = attacker.id; target.ownerPlayerId = a.playerId; evictResidents(target);
  target.siege = null;
  if (isThrone) {
    // Siege popup -> sacked popup -> the new king popup, and nothing else.
    if (!wasVacantThrone) notifyAll('sacked', 'King’s Landing has been sacked', `House ${capWord(attacker.name)} stormed King’s Landing and took the Iron Throne.`, [attacker.id], fallenIds);
    throneTaken(attacker.id, a.playerId);
  } else {
    notify('battle-won', [attacker.id], [], `Victory at ${target.name}`, `House ${capWord(attacker.name)} captured ${target.name}.`, [attacker.id, defender?.id].filter(Boolean));
    if (defender) notify('attacked', [defender.id], [], `${target.name} was attacked`, `House ${capWord(attacker.name)} attacked and took ${target.name}.`, [attacker.id, defender.id], fallenIds);
  }
  addEvent('battle', how === 'unopposed' ? `House ${attacker.name} marched into the empty ${target.name} unopposed.` : `House ${attacker.name} captured ${target.name} from House ${defender?.name || 'an unknown house'} (${how}).`);
  for (const e of entries) returnArmy(e, `Army returned from ${target.name}`);
  checkVictory();
  // The move that ends the game: only the siege popup, the last battle and then the victory/defeat screen.
  if (gameOver && !wasOver) notices = notices.filter(n => noticesBefore.has(n.id) || n.kind === 'siege' || n.kind === 'battle-report');
}

// ---- Bot players ----------------------------------------------------------
// Bots play through the same action handlers as people (HANDLERS), on a slow timer so the table can follow them.
const HOUSE_WORDS = { stark: 'Winter is coming.', lannister: 'A Lannister always pays his debts.', baratheon: 'Ours is the Fury.', targaryen: 'Fire and Blood.', tyrell: 'Growing Strong.', greyjoy: 'We Do Not Sow.', martell: 'Unbowed, Unbent, Unbroken.', arryn: 'As High as Honor.' };
const pickOne = list => list[randomInt(0, list.length - 1)];
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const HN = id => `House ${capWord(houseName(id))}`;
function botAi(bot) {
  const fresh = () => ({
    aggr: 0.3 + Math.random() * 0.6, diplo: 0.3 + Math.random() * 0.6, honesty: 0.3 + Math.random() * 0.65, greed: 0.2 + Math.random() * 0.6,
    due: {}, turnFor: 0, turnAt: 0, turnDone: false, dipRound: 0,
    trust: {}, grudge: {}, stance: {}, score: {}, buffer: {}, peace: {}, peaceLie: {}, pledges: [], relief: [], owe: [], todo: [],
    intel: [], est: {}, threats: {}, seenReports: {}, seenSieges: {}, owned: null, plan: { goal: 'hold', focus: null, round: 0 },
    asked: {}, stanceRound: 0, lastRound: 0, crownGrudge: 0, lies: 0, caughtBy: {}, spiedOn: {}
  });
  if (!bot.ai) bot.ai = fresh();
  if (!bot.ai.caughtBy) bot.ai.caughtBy = {};
  if (!bot.ai.spiedOn) bot.ai.spiedOn = {};
  const ai = bot.ai;
  if (ai.lastRound > round) { const keep = { aggr: ai.aggr, diplo: ai.diplo, honesty: ai.honesty, greed: ai.greed }; Object.assign(ai, fresh(), keep); }
  ai.lastRound = round;
  return ai;
}
function botDo(bot, name, payload) {
  try { const r = HANDLERS[name] ? HANDLERS[name](bot, payload, null) : null; return Boolean(r && r.ok !== false); }
  catch (error) { console.error(`Bot action ${name} failed:`, error); return false; }
}
// True once a randomised "thinking" delay has passed for this item; after it returns true it is spent for good.
function botReady(bot, key, min = 2500, max = 8000) {
  const ai = botAi(bot), now = Date.now();
  if (!(key in ai.due)) { ai.due[key] = now + randomInt(min, max); return false; }
  if (now < ai.due[key]) return false;
  ai.due[key] = Infinity;
  return true;
}
const botLeads = bot => houseMembers(bot.houseId).filter(p => p.isBot && !p.eliminated)[0]?.id === bot.id;
const botLater = (bot, fn, min = 2500, max = 8000) => botAi(bot).todo.push({ at: Date.now() + randomInt(min, max), fn });
function botSay(bot, text, toPlayer) {
  if (toPlayer) return botDo(bot, 'send-chat', { scope: 'secret', targetPlayerIds: [toPlayer.id], message: text });
  return botDo(bot, 'send-chat', { scope: 'public', message: text });
}
// Say something to a whole house: privately to its people, or publicly when nobody is there.
function botSayHouse(bot, houseId, text) {
  const people = houseMembers(houseId).filter(p => !p.eliminated);
  if (!people.length) return botSay(bot, text);
  return botDo(bot, 'send-chat', { scope: 'secret', targetPlayerIds: people.map(p => p.id), message: text });
}
// A bot knows a house is attacking it when that house besieges or takes its city, or its spies saw the army marching on it.
const botHostile = (bot, houseId) => Boolean(houseId) && round - ((botAi(bot).attackedBy || {})[houseId] ?? -99) <= 4;
const botsOf = houseId => houseMembers(houseId).filter(p => p.isBot && !p.eliminated && p.w);
function botTrust(bot, houseId, d) {
  const ai = botAi(bot); if (!houseId || houseId === bot.houseId) return;
  ai.trust[houseId] = clampN((ai.trust[houseId] || 0) + d, -100, 100);
  if (d < 0) ai.grudge[houseId] = clampN((ai.grudge[houseId] || 0) - d * 0.6, 0, 100);
}

// ---- Live targets ---------------------------------------------------------
// A city can only be attacked when somebody who is still playing holds it (or it is the empty throne).
function capitalLive(c) {
  if (!c || c.contested) return false;
  if (c.vacant) return c.id === 'kings-landing';
  if (!c.ownerHouseId || !c.ownerPlayerId) return false;
  const op = players.get(c.ownerPlayerId);
  if (!op || op.left || op.eliminated || !op.w) return false;
  if ((gameSettings.disabledHouses || []).includes(c.ownerHouseId)) return false;
  const oh = findHouse(c.ownerHouseId);
  return Boolean(oh && !houseFallen(oh) && houseMembers(c.ownerHouseId).length);
}

// ---- Dice odds ------------------------------------------------------------
// Monte-Carlo of the siege rules: sorted dice paired off, ties to the defender, dragons +3, fight until one side is out.
function simSiege(att, defN, trials = 30) {
  let wins = 0;
  for (let t = 0; t < trials; t++) {
    let a = [...Array(att.infantry + att.navy).fill(0), ...Array(att.dragons).fill(3)], d = defN;
    for (let r = 0; r < 14 && a.length && d > 0; r++) {
      const A = a.map(b => ({ v: randomInt(1, 6) + b, b })).sort((x, y) => y.v - x.v);
      const D = Array.from({ length: d }, () => randomInt(1, 6)).sort((x, y) => y - x);
      const pairs = Math.min(A.length, D.length), lost = new Set();
      let lostD = 0;
      for (let i = 0; i < pairs; i++) { if (D[i] >= A[i].v) lost.add(i); else lostD++; }
      a = A.filter((_, i) => !lost.has(i)).map(x => x.b); d -= lostD;
    }
    if (d <= 0 && a.length) wins++;
  }
  return wins / trials;
}
function botPower(bot, hid) {
  const ai = botAi(bot);
  if (hid === bot.houseId) return armySize(bot.w) + 0.4 * playerIncome(bot);
  const caps = capitals.filter(c => c.ownerHouseId === hid).length, e = ai.est[hid];
  if (e && round - e.round <= 3) return e.infantry + e.navy + e.dragons * 4 + caps * 1.5;
  return 3 + round * 0.9 + caps * 2;
}
function botDefenders(bot, c) {
  const ai = botAi(bot), e = c.ownerHouseId ? ai.est[c.ownerHouseId] : null;
  let home = c.vacant ? 0 : (e && round - e.round <= 3 ? e.infantry + e.navy + e.dragons * 2 : clampN(Math.round(3 + round * 0.9), 3, 25));
  if (c.ownerHouseId && alliances.some(a => [a.houseA, a.houseB].includes(c.ownerHouseId))) home += 1;
  const garrison = c.vacant ? 0 : garrisonFor(c, findHouse(c.ownerHouseId));
  return Math.ceil((garrison + home) * 1.1);
}

// ---- Understanding what people ask ---------------------------------------
const plainText = s => String(s || '').toLowerCase().replace(/[’']/g, '');
function botParse(text, bot) {
  const t = plainText(text)
    .replace(/\bim\b/g, 'i am').replace(/\bill\b/g, 'i will').replace(/\bgonna\b/g, 'going to').replace(/\bwanna\b/g, 'want to')
    .replace(/\bu\b/g, 'you').replace(/\bur\b/g, 'your').replace(/\bdont\b/g, 'do not').replace(/\bwont\b/g, 'will not').replace(/\bcant\b/g, 'can not')
    .replace(/\bive\b/g, 'i have').replace(/\bwe ll\b/g, 'we will');
  const out = { raw: t, threats: {}, houseIds: [], capIds: [], amount: null, offerAmount: null };
  const hs = s => houses.filter(x => s.includes(x.name.toLowerCase()) || new RegExp(`\\b${x.id}\\b`).test(s)).map(x => x.id);
  const cs = s => capitals.filter(c => s.includes(plainText(c.name))).map(c => c.id);
  out.houseIds = hs(t); out.capIds = cs(t);
  const myName = bot.w ? houseName(bot.houseId).toLowerCase() : '';
  const mineCities = capitals.filter(c => c.ownerHouseId === bot.houseId).map(c => plainText(c.name));
  const toMe = s => /\b(you|your|yours|yourself)\b/.test(s) || (myName && s.includes(myName)) || mineCities.some(n => s.includes(n)) || s.includes(plainText(bot.username));
  out.conditional = /\b(if you|unless you|or else|otherwise)\b/.test(t);
  // Split into clauses so "I will send you gold, but you must send me troops" is read as two different things.
  const clauses = t.split(/[.!?;,]+|\b(?:but|so|then|otherwise|or else|or|and|because|since|unless|if)\b(?= (?:you|i|we|your|my|the|a)\b)/).map(c => c.trim()).filter(Boolean);
  const GIVE = '(?:give|send|lend|spare|pay|gift|donate|bring|hand|offer|loan)';
  for (const c of clauses) {
    const nums = (c.match(/\d+/g) || []).map(Number).filter(n => n > 0 && n < 1000);
    const cHouses = hs(c), cCaps = cs(c);
    const firstPerson = /\b(i|we)\b/.test(c);
    const futureFrame = /\b(i|we) (?:will|shall|am going to|are going to|am about to|are about to|plan to|intend to|am planning to|have decided to|must|would|can|could|might)\b|\bi am (?:sending|giving|paying|marching|attacking|moving|preparing|going)\b|\bwe are (?:sending|marching|attacking|moving)\b/.test(c);
    const negFirst = /\b(i|we) (?:will not|do not|would never|am not going to|are not going to|promise not to|have no intention of|never will)\b/.test(c);
    // Offers: the speaker is giving to the bot ("i will send you 5 gold", "i sent you troops", "here is a gift")
    const offerRe = new RegExp(`\\b(?:i|we)\\b[^]*?\\b(?:${GIVE}|sent|gave|paid|giving|sending|paying)\\b[^]*?\\byou\\b|\\bhere (?:is|are)\\b|\\btake this\\b|\\ba gift for you\\b|\\bon me\\b`);
    const youGive = new RegExp(`\\b(?:${GIVE}) (?:me|us)\\b|\\byou (?:should|must|need to|have to|will|can|could|would|better) ${GIVE}\\b|\\b(?:can|could|would|will) you\\b[^]*?\\b${GIVE}\\b|\\bneed you to\\b|\\bi (?:need|want|require)\\b`);
    const isOffer = offerRe.test(c) && !youGive.test(c) && !/\b(i|we)\b[^]*?\bme\b/.test(c);
    if (isOffer) { out.offer = true; out.offerAmount = out.offerAmount || nums[0] || null; if (/\b(troops?|soldiers?|men|infantry|ships?|navy|fleet)\b/.test(c)) out.offerTroops = true; if (/\b(soon|shortly|later|next round|tomorrow|in a (?:round|bit|moment|while))\b/.test(c) && !nums.length) { out.promise = true; out.soon = true; } continue; }
    // Money talk that is about a promise, a delay, an excuse or a refusal (usually the answer to a tax or a request)
    if (/\b(tax|taxes|tribute|decree|levy|dues|due|owe|owed|debt)\b/.test(c)) out.taxWord = true;
    if (negFirst && /\b(pay|give|send|tribute|tax|kneel|bow|obey|surrender)\b/.test(c)) out.refusePay = true;
    else if (/\b(i|we) (?:refuse|will never|would never)\b/.test(c) && /\b(pay|give|send|tribute|tax)\b/.test(c)) out.refusePay = true;
    if (!negFirst && !isOffer && /\b(i|we)\b/.test(c) && /\b(will|shall|am going to|am about to|can|could|should|promise to|plan to|intend to|am sending|am paying)\b/.test(c) && /\b(pay|send|give|deliver|bring|settle|repay|cover|transfer|gather|get it|have it)\b/.test(c) && !/\b(attack|march|invade|conquer|strike)\b/.test(c)) { out.promise = true; if (/\b(soon|shortly|later|next round|tomorrow|in a (?:round|bit|moment|while)|when i can|once i|after|by )/.test(c)) out.soon = true; }
    if (/\b(more time|some time|need time|give me (?:a )?(?:time|round|day|moment|bit)|allow me|wait|patience|be patient|not yet|hold on|can not (?:pay )?(?:yet|right now|now))\b/.test(c)) out.delay = true;
    if (/\b(can not|cannot|do not have|have no|have not got|am broke|no gold|out of gold|too poor|can not afford|too much)\b/.test(c) && /\b(afford|pay|gold|coins?|money|treasury|tax|tribute)\b/.test(c)) out.unable = true;
    // Caught spies
    if (/\b(caught|captured|seized|discovered|exposed|hanged|arrested|intercepted|killed|found)\b[^]*?\b(spy|spies|agent|agents|scout|scouts|informers?)\b|\b(spy|spies|agents?|scouts?)\b[^]*?\b(caught|captured|seized|hanged|arrested|found out|dead|killed)\b|\bcaught you (?:spying|snooping)\b|\byou (?:spied|have been spying)\b/.test(c)) { out.caught = true; if (nums[0] && /gold|coin/.test(c) === false) { /* number not about gold */ } }
    // Threats (aimed at the bot), unless the speaker is saying they will NOT do it
    const hasAttackVerb = /\b(attack|invade|destroy|crush|besiege|siege|conquer|assault|raze|burn|take|kill|crash|end|smash|come for|march on|march against|go to war|declare war|wage war|strike|hit)\b/.test(c);
    if (negFirst && /\b(attack|invade|harm|hurt|betray|strike|touch|move against)\b/.test(c)) out.assure = true;
    else {
      if (hasAttackVerb && (firstPerson || /\b(going to|will|shall)\b/.test(c)) && toMe(c) && !/\byou (?:should|must|can|could) (?:attack|take|invade)\b/.test(c) && !/\bwith me\b/.test(c)) out.threats.attack = true;
      if (/\btraitor\b/.test(c) && /\b(label|brand|mark|name|call|declare|proclaim|make|name you|have you named)\b/.test(c) && /\b(i|we|king|crown|will)\b/.test(c) && !/\b(you are|you re|youre) (?:a )?traitor\b/.test(c)) out.threats.traitor = true;
      if (/\b(break|end|cancel|dissolve|leave|abandon|renounce)\b[^]*?\b(alliance|pact|treaty|friendship|our deal)\b/.test(c) && (firstPerson || /\bwill\b/.test(c))) out.threats.break = true;
      if (/\b(tell|expose|reveal|spread|announce|inform|report)\b[^]*?\b(everyone|all|realm|king|secrets?|table|court|others|them all)\b/.test(c) && (firstPerson || /\bwill\b/.test(c))) out.threats.expose = true;
      if (/\b(you will pay|you will regret|you will die|beware|or else|you will be sorry|bend the knee|your head|burn you|you are done|you are finished)\b/.test(c)) out.threats.generic = true;
    }
    // Declarations: "i will attack lannister" (the speaker announcing something, not asking the bot to do anything)
    if (futureFrame && hasAttackVerb && !toMe(c) && (cHouses.length || cCaps.length) && !negFirst) { out.declare = { houseIds: cHouses.filter(x => x !== bot.houseId), capIds: cCaps }; }
    // Requests
    const imperative = /^(?:please |just |now |kindly )?(?:attack|strike|invade|conquer|crush|assault|besiege|take|join|help|send|give|lend|spare|support|follow|tell|share)\b/.test(c);
    const youShould = /\b(you (?:should|must|need to|have to|will|better|can|could|would)|can you|could you|would you|will you|please|lets|let us|join me|with me|help me)\b/.test(c);
    const requestFrame = imperative || youShould || /\bi (?:need|want|require|ask)\b|\bgive me\b|\bsend me\b/.test(c) || /\bme\b/.test(c) && new RegExp(`\\b${GIVE}\\b`).test(c);
    if (requestFrame && !isOffer) {
      if (/\b(gold|coins?|money|funds?|silver|tribute|loan|purse|dragons?)\b/.test(c) && (new RegExp(`\\b${GIVE}\\b|\\bneed\\b|\\bwant\\b|\\bloan\\b|\\bpay\\b`)).test(c)) { out.money = true; out.amount = out.amount || nums[0] || null; }
      if (/\b(troops?|soldiers?|men|infantry|army|ships?|navy|fleet|reinforcements?|swords)\b/.test(c) && /\b(give|send|lend|spare|need|want|reinforce|loan|donate)\b/.test(c) && !/\b(send|march)\b[^]*?\b(to|against|on) (?!me|us)[a-z]/.test(c)) { out.troops = true; out.amount = out.amount || nums[0] || null; }
      if (/\b(attack|strike|invade|conquer|crush|assault|besiege|siege|go after|move against|join me against|take)\b/.test(c) && (cHouses.length || cCaps.length || /\b(attack|invade|conquer|assault|strike)\b/.test(c)) && !toMe(c)) { out.attack = true; }
      if (/\b(help|aid|assist|defend|protect|save|rescue|relieve|reinforce|back me|stand with me|come to my)\b/.test(c)) out.help = true;
    }
    if (/\b(ships?|navy|fleet)\b/.test(c)) out.ships = true;
    if (/\b(peace|truce|ceasefire|stand down|spare me|leave me alone|non-?aggression|hold off|do not attack|do not invade|stop attacking)\b/.test(c) && !firstPerson) out.peace = true;
    if (/\b(intel|intelligence|spy report|spies|scouts?|what did you (learn|see|find|hear)|any news|what do you know|rumou?rs?|did you spy|what have you heard)\b/.test(c) && !out.caught) out.intel = true;
    if (/\b(alli(ance|ed|es)|ally|pact)\b/.test(c) && !out.threats.break && !out.assure) out.ally = true;
    if (/\b(follow me|follow my lead|side with me|stand with me|obey|kneel|swear|support me|back me)\b/.test(c)) out.follow = true;
    if (/\b(you are|you re|youre|you have been|such a) (?:a |an |the )?(traitor|liar|snake|backstabber|oathbreaker|cheat)\b|\byou (?:betrayed|lied|cheated|backstabbed)\b/.test(c)) out.accuse = true;
    if (/\b(thanks|thank you|grateful|sorry|apolog|forgive|my thanks)\b/.test(c)) out.kind = true;
  }
  out.payNag = /\b(pay up|pay me|pay now|pay the|pay your|settle up|settle it|where is (?:it|my|the)|still waiting|i am waiting|what about (?:it|my|the))\b/.test(t);
  if (out.caught) out.intel = false;
  // Two-part demands: "give me 5 gold or i will attack you" / "if you do not give me 5 gold i will attack you"
  const threatKinds = Object.keys(out.threats);
  out.demand = Boolean(out.money || out.troops || out.follow || (out.attack && !out.declare));
  out.ultimatum = threatKinds.length > 0 && (out.demand || out.caught && /\bgive|send|pay|or\b/.test(t));
  return out;
}

// ---- Deciding ------------------------------------------------------------
// A score above zero means "yes". It mixes trust, alliance, stance and the king's crown with a randomised buffer.
function botWillingness(bot, sender, kind) {
  const ai = botAi(bot), h = bot.w, sh = sender.houseId;
  const allied = Boolean(sh && areAllied(bot.houseId, sh));
  const eff = (ai.trust[sh] || 0) + (allied ? 20 : 0);
  const stance = ai.stance[sh] || 'neutral';
  let s = eff / 70 + (allied ? 0.2 : 0) + (stance === 'follow' ? 0.3 : stance === 'betray' ? -0.6 : 0)
    + (sender.id === kingPlayerId ? 0.2 : 0) - (ai.grudge[sh] || 0) / 90 - (sender.traitor ? 0.1 : 0);
  if (kind === 'money') s -= ai.greed * 0.5 + (h.money < 12 ? 0.35 : 0);
  if (kind === 'troops') s -= ai.greed * 0.3 + (armySize(h) < 6 ? 0.5 : 0);
  if (kind === 'attack') s += ai.aggr * 0.25;
  if (kind === 'peace') s += ai.diplo * 0.25;
  if (kind === 'help') s += 0.1;
  if (botHostile(bot, sh)) s -= 1.5;
  s += (Math.random() - 0.5) * 0.5;
  return s;
}
function botGiveGold(bot, sender, wanted, why) {
  const ai = botAi(bot), h = bot.w, allied = areAllied(bot.houseId, sender.houseId);
  const cap = Math.floor(h.money * (allied ? 0.4 : 0.25));
  if (cap < 1) return null;
  const amt = clampN(wanted || Math.max(2, Math.round(h.money * 0.15)), 1, cap);
  if (phase === 'ACTION') return botDo(bot, 'send-gift', { toPlayerId: sender.id, gold: amt, infantry: 0, navy: 0, message: why || '' }) ? { amt, now: true } : null;
  ai.owe.push({ toPlayerId: sender.id, gold: amt, infantry: 0, navy: 0, message: why || '' });
  return { amt, now: false };
}
function botGiveTroops(bot, sender, wanted, ships) {
  const ai = botAi(bot), h = bot.w, allied = areAllied(bot.houseId, sender.houseId);
  const spareInf = Math.max(0, h.infantry - 3), spareNavy = Math.max(0, h.navy - 1);
  const inf = Math.floor(spareInf * (allied ? 0.5 : 0.3)), nav = ships ? Math.floor(spareNavy * 0.5) : 0;
  const give = { infantry: wanted ? Math.min(wanted, inf) : Math.max(inf ? 1 : 0, Math.ceil(inf * 0.6)), navy: ships ? Math.min(wanted || nav, nav) : 0 };
  if (give.infantry + give.navy < 1) return null;
  if (phase === 'ACTION') return botDo(bot, 'send-gift', { toPlayerId: sender.id, gold: 0, infantry: give.infantry, navy: give.navy, message: 'Reinforcements.' }) ? { ...give, now: true } : null;
  ai.owe.push({ toPlayerId: sender.id, gold: 0, infantry: give.infantry, navy: give.navy, message: 'Reinforcements.' });
  return { ...give, now: false };
}
function botPickTargetCity(bot, houseId) {
  return capitals.filter(c => c.ownerHouseId === houseId && capitalLive(c)).sort((a, b) => a.defense - b.defense)[0] || null;
}

// Somebody tells a bot they caught its spies. Guilty bots admit, deny or defy; innocent ones deny.
function botCaughtReply(bot, sender, it) {
  const ai = botAi(bot), sh = sender.houseId, honest = Math.random() < ai.honesty;
  const guilty = round - (ai.caughtBy[sh] ?? -99) <= 6;
  if (!guilty) {
    return pickOne([`My spies? I sent none against ${HN(sh)}. Whoever you caught, they did not wear my colours.`, 'Prove it. I have no spies in your halls.', `A fine accusation, ${sender.username}. Do you have a name, or only a rumour?`]);
  }
  botTrust(bot, sh, -2);
  if (honest && ai.diplo > 0.45) { botTrust(bot, sh, 3); return pickOne([`Aye, they were mine. Every house watches its neighbours, ${HN(sh)}. Let us not make war of it.`, 'You caught them fairly. I will not insult you with a denial. It will not happen again.']); }
  if (ai.aggr > 0.65) { ai.grudge[sh] = (ai.grudge[sh] || 0) + 5; return pickOne(['And if they were mine? You should guard your halls better.', 'Spies are the price of a careless house. Do not blame me for your doors.']); }
  ai.lies++;
  return pickOne(['Not my spies. Someone is trying to set us against each other.', 'I do not know what you speak of. Perhaps another house wishes you to blame me.']);
}
// A threat with no demand attached: a bot answers according to which threat it was and who made it.
function botThreatReply(bot, sender, it) {
  const ai = botAi(bot), sh = sender.houseId, th = it.threats;
  const strong = botPower(bot, sh) > botPower(bot, bot.houseId) * 1.4;
  const lines = [];
  if (th.attack || th.generic) {
    botTrust(bot, sh, -12);
    lines.push(strong ? pickOne(['Your words are heard. There is no need for this to end in blood.', 'Let us not be hasty. I would rather deal than fight.']) : pickOne([`Threats are wind, ${HN(sh)}. My army is steel.`, `Come, then. My banners are many and my patience is short. ${HOUSE_WORDS[bot.houseId] || ''}`]));
  }
  if (th.traitor) {
    if (sender.id === kingPlayerId) { botTrust(bot, sh, -6); ai.crownGrudge = round; lines.push(ai.aggr > 0.5 ? 'Brand me a traitor, then, and see how loyal the lords remain to a king who does it.' : 'I have done nothing to deserve that label. Do not do this, my king.'); }
    else { botTrust(bot, sh, -3); lines.push(`You have no authority to name traitors, ${sender.username}. Only the king may.`); }
  }
  if (th.break) { botTrust(bot, sh, -2); lines.push(areAllied(bot.houseId, sh) ? pickOne(['Break it, then, if you must. But you will regret losing a friend.', 'I thought our word meant something. Think carefully before you cast it away.']) : 'We have no alliance to break.'); }
  if (th.expose) { botTrust(bot, sh, -3); lines.push(pickOne(['Tell them what you like. I have nothing to hide.', 'Spread your rumours. I will spread mine, and see whom the lords believe.'])); }
  return lines.join(' ');
}
// "Give me X or I attack you": weigh fear against pride, then comply, stall, or defy.
function botUltimatum(bot, sender, it) {
  const ai = botAi(bot), h = bot.w, sh = sender.houseId, th = it.threats;
  let fear = 0;
  const ratio = botPower(bot, sh) / Math.max(3, botPower(bot, bot.houseId));
  fear += clampN((ratio - 0.8) * 0.9, -0.4, 0.9);
  if (th.attack || th.generic) fear += 0.1;
  if (th.traitor) fear += sender.id === kingPlayerId ? 0.35 : 0;
  if (th.break) fear += areAllied(bot.houseId, sh) ? 0.15 : 0;
  if (th.expose) fear += 0.1;
  if (it.caught && round - (ai.caughtBy[sh] ?? -99) <= 6) fear += 0.3;
  const score = fear - ai.aggr * 0.55 + ai.diplo * 0.25 + (Math.random() - 0.5) * 0.4 - (ai.grudge[sh] || 0) / 120 + (ai.trust[sh] || 0) / 250;
  const asked = it.money ? 'gold' : it.troops ? 'troops' : 'obedience';
  if (score > 0.15) {
    botTrust(bot, sh, -6);
    if (it.money) {
      const want = it.amount || Math.max(2, Math.round(h.money * 0.15));
      const give = Math.min(want, Math.floor(h.money * 0.7));
      if (give >= 1) {
        const sent = phase === 'ACTION' ? botDo(bot, 'send-gift', { toPlayerId: sender.id, gold: give, infantry: 0, navy: 0, message: 'Under protest.' }) : false;
        if (!sent) ai.owe.push({ toPlayerId: sender.id, gold: give, infantry: 0, navy: 0, message: 'Under protest.' });
        return `Very well. ${give} gold${sent ? ' is yours' : ' will reach you when the armies gather'}. Take it and leave me be. I will not forget being coerced.`;
      }
      return 'I would pay if I had it. My coffers are empty. Do not attack a house with nothing to take.';
    }
    if (it.troops) {
      const g = botGiveTroops(bot, sender, it.amount, it.ships);
      return g ? `You leave me no choice. ${g.infantry} soldiers are yours${g.now ? '' : ' soon'}. Do not ask twice.` : 'I have no men to spare, and you know it.';
    }
    return 'I yield. For now. Do not mistake it for loyalty.';
  }
  if (score > -0.2) {
    botTrust(bot, sh, -8);
    return pickOne([`Threats and demands, ${HN(sh)}? Come to the table and ask properly, and we may reach terms.`, `I will not be bullied into ${asked}. Make me a real offer and I will listen.`, 'Give me a few days to think on it. And lower your voice while you ask.']);
  }
  botTrust(bot, sh, -15);
  ai.grudge[sh] = (ai.grudge[sh] || 0) + 12;
  ai.stance[sh] = 'betray';
  ai.attackedBy[sh] = round - 2;
  return pickOne([`Not a coin, ${HN(sh)}. If you want a war, you will have one.`, `You demand ${asked} from me with a threat? Then my answer is steel. ${HOUSE_WORDS[bot.houseId] || ''}`, 'Do your worst. I have buried bigger threats than you.']);
}
// Somebody announces what they will do to a third party: react according to how that third party relates to the bot.
function botDeclareReply(bot, sender, it) {
  const ai = botAi(bot), sh = sender.houseId, d = it.declare;
  const target = d.houseIds[0] || (d.capIds[0] && findCapital(d.capIds[0])?.ownerHouseId) || null;
  if (target === bot.houseId) return botThreatReply(bot, sender, { threats: { attack: true } });
  if (!target) return pickOne(['Noted. I will watch how that goes.', 'Bold. I wish you luck.']);
  if (areAllied(bot.houseId, target)) { botTrust(bot, sh, -5); return `${HN(target)} is my ally. Think twice before you move against them.`; }
  if (botHostile(bot, target) || ai.stance[target] === 'betray' || (ai.grudge[target] || 0) > 20) {
    botTrust(bot, sh, 2);
    const cap = d.capIds[0] ? findCapital(d.capIds[0]) : botPickTargetCity(bot, target);
    if (cap && capitalLive(cap) && Math.random() < 0.4) ai.pledges.push({ capitalId: cap.id, forHouse: sh, round, expires: round + 3 });
    return pickOne([`${HN(target)} has earned it. If you march, I may march with you.`, `Good. ${HN(target)} has been a thorn in my side too.`]);
  }
  return pickOne([`${HN(target)}, is it? I will be watching how that goes.`, 'A bold move. Do you want my help, or only my silence?', 'That is your business. Do not expect me to take sides yet.']);
}

// ---- Context: what the conversation is about -------------------------------
const demandText = d => [d.gold && `${d.gold} gold`, d.infantry && `${d.infantry} soldiers`, d.navy && `${d.navy} ships`].filter(Boolean).join(' and ') || 'the tribute';
// A decree this bot (as king) sent to the speaker's house that has not been paid yet.
const botDecreeTo = (bot, sender) => taxLedger.find(x => x.kingPlayerId === bot.id && x.recipients.some(r => r.houseId === sender.houseId && r.state === 'pending')) || null;
// A decree the speaker (as king) sent to this bot's house that is still unpaid.
const botDecreeFrom = (bot, sender) => taxLedger.find(x => x.kingPlayerId === sender.id && x.recipients.some(r => r.houseId === bot.houseId && r.state === 'pending')) || null;
const REMINDER_ROUNDS = 2;
function botTaxTalk(bot, sender, it, kd) {
  const ai = botAi(bot), sh = sender.houseId, demand = demandText(kd), nm = sender.username;
  ai.expect = ai.expect || {};
  if (it.refusePay) {
    botTrust(bot, sh, -8); ai.grudge[sh] = (ai.grudge[sh] || 0) + 6; ai.crownGrudge = ai.crownGrudge || 0;
    return ai.aggr > 0.5 ? pickOne([`Then you refuse the crown. Remember that I asked, ${nm}, when the lords hear of it.`, `Refuse, then. The crown has a long memory and a longer reach.`]) : pickOne([`Refuse the crown if you must, but I will not forget it.`, `That is a pity. I had hoped House ${capWord(houseName(sh))} was loyal.`]);
  }
  if (it.unable) {
    ai.expect[sender.id] = { decreeId: kd.id, due: round + 2, nudged: false };
    return pickOne([`Then pay what you can, ${nm}, and the rest within a round or two. The ${demand} is still owed.`, `A poor treasury is no excuse for long. Send what you have and settle the rest soon.`]);
  }
  if (it.delay && !it.promise) {
    const ok = Math.random() < 0.35 + ai.diplo * 0.4 + (ai.trust[sh] || 0) / 200 - ai.aggr * 0.3;
    if (ok) { ai.expect[sender.id] = { decreeId: kd.id, due: round + 2, nudged: false }; return pickOne([`Very well. I will wait until Round ${round + 2} for the ${demand}. No longer.`, `A round or two, then. The crown is patient, but not endlessly.`]); }
    return pickOne([`The crown does not wait on excuses, ${nm}. Pay it this round.`, `No more time. The ${demand} is due now.`]);
  }
  ai.expect[sender.id] = { decreeId: kd.id, due: round + (it.soon ? 1 : 2), nudged: false };
  botTrust(bot, sh, 1);
  return pickOne([`Good. The ${demand} is the crown's due, ${nm}. I will expect it by Round ${ai.expect[sender.id].due}.`, `Then I will hold you to it. The ${demand}, by Round ${ai.expect[sender.id].due}.`, `Soon is acceptable, ${nm}, as long as it is not never.`]);
}
// The king says "pay me" or mentions the tax: it is about the decree this bot has not paid yet.
function botDecreeNudge(bot, sender, d) {
  const ai = botAi(bot), h = bot.w, demand = demandText(d);
  ai.decreeStatus = ai.decreeStatus || {};
  const st = ai.decreeStatus[d.id];
  const afford = h.money >= d.gold && h.infantry >= d.infantry && h.navy >= d.navy;
  if (afford && (st === 'later' || !st) && Math.random() < 0.55 + ai.diplo * 0.3 - (ai.crownGrudge ? 0.3 : 0)) {
    if (botDo(bot, 'respond-decree', { decreeId: d.id })) { botTrust(bot, sender.houseId, 1); ai.decreeStatus[d.id] = 'paid'; return pickOne([`You are right to remind me. The ${demand} is sent.`, `Paid, your grace. ${demand}, as the crown asked.`]); }
  }
  if (!st) { botHandleDecree(bot, d); return ''; }
  if (st === 'later') return pickOne([`I have not forgotten the tax, ${sender.username}. You will have your ${demand} soon.`, 'It is coming, my king. Patience.']);
  if (st === 'poor') return pickOne([`I told you my treasury is thin. The ${demand} will come when it can.`, 'I have little to give. Ask less, and I will pay.']);
  return pickOne([`My answer has not changed, ${sender.username}.`, 'I have said what I will say about the tax.']);
}
const ACK_WORDS = new Set(('ok okay alright all right very well fine sounds good great nice cool understood got it noted thanks thank you thx ty cheers youre your welcome are no problem np worries of course will do agreed deal indeed excellent perfect wonderful splendid as wish so be that is fair enough i see makes sense yes yeah yep sure then we farewell goodbye bye see later gg lol haha hmm hm my lord king lady friend works for me glad happy hear to a pleasure much appreciated appreciate kind generous done luck take care nope nah and the lot really truly sincerely many').split(' '));
const ACK_STRONG = new Set('ok okay alright fine good great nice cool understood noted thanks thank thx ty cheers welcome problem np worries course agreed deal indeed excellent perfect wonderful splendid wish fair sense yes yeah yep sure farewell goodbye bye gg lol haha hmm hm glad happy appreciated appreciate well done nope nah'.split(' '));
// Messages that are themselves a reply ("ok", "very well", "your welcome") need no answer, except a thank-you after the bot helped.
function botNeedsReply(bot, sender, text) {
  const t = plainText(text).replace(/[^a-z\s]/g, ' ').trim(), w = t.split(/\s+/).filter(Boolean);
  if (!w.length || w.length > 9 || /\?/.test(text) || /\d/.test(text)) return true;
  if (!w.every(x => ACK_WORDS.has(x)) || !w.some(x => ACK_STRONG.has(x))) return true;
  const ai = botAi(bot), last = ai.lastAsk && ai.lastAsk[sender.id];
  if (last && round - last.round <= 1 && /^(yes|yeah|yep|sure|no|nope|nah|maybe|ok|okay)\b/.test(t)) return true; // an answer to a question it asked
  if (/\b(thanks?|thank|thx|ty|appreciate|appreciated|cheers)\b/.test(t) && round - ((ai.lastHelp || {})[sender.id] ?? -99) <= 1) return chance(0.6);
  return chance(0.03);
}
// It could not make sense of the message: say so, and use whatever it did pick up.
function botConfused(bot, text, sender) {
  const it = botParse(text, bot), t = plainText(text);
  if (it.houseIds.length) return pickOne([`You mention House ${capWord(houseName(it.houseIds[0]))}, but I do not follow what you want me to do about it.`, `I caught the name ${HN(it.houseIds[0])}, but not what you are asking. Say it plainly.`]);
  if (t.split(/\s+/).length > 28) return 'That is a great deal to take in at once. What is it you want from me?';
  return botVoice(bot, sender, pickOne(['I am sorry, I do not understand. What do you mean?', 'I cannot tell what you are asking of me. Say it plainly.', 'I do not follow. Could you put that another way?', 'You have lost me. What exactly do you want?']));
}
// The meat of the conversation: understand the request, decide, act, and say something that fits. Returns the reply text.
function botConverse(bot, sender, text) {
  const ai = botAi(bot), h = bot.w, sh = sender.houseId, words = HOUSE_WORDS[bot.houseId] || '';
  const it = botParse(text, bot), parts = [];
  if (!sh || !sender.w) return botReply(bot, text, sender);
  if (botHostile(bot, sh)) {
    if (it.peace) return pickOne([`Peace? Pull your army back from my walls first, then we will talk.`, 'You want peace while your soldiers march on my cities? Withdraw them and ask again.']);
    if (it.ally || it.follow) return pickOne(['An alliance, from the house that is attacking me? Do not insult me.', 'You march on my lands and ask for my loyalty? You will get none.']);
    if (it.money || it.troops || it.help || it.attack) return pickOne(['After what you have done to my lands, you ask me for favours? No.', 'Not a coin, not a soldier. You are at war with me.']);
    if (it.kind) return 'Pretty words. Your army says otherwise.';
    return pickOne([`Your army is at my gates and you want to chat? Withdraw it, ${sender.username}.`, 'We have nothing to discuss while you attack me.', 'You are my enemy. Speak to my soldiers.']);
  }
  // Context first: the king nagging about the tax, or the speaker answering the bot's own tax demand.
  const dFrom = botDecreeFrom(bot, sender), dTo = botDecreeTo(bot, sender);
  if (dFrom && !it.offer && !it.promise && !it.threats.attack && (it.taxWord || it.money || it.payNag) && !it.amount) return botDecreeNudge(bot, sender, dFrom);
  if (dTo && (it.promise || it.delay || it.unable || it.refusePay)) return botTaxTalk(bot, sender, it, dTo);
  ai.lastHelp = ai.lastHelp || {}; ai.ctx = ai.ctx || {};
  const allied = areAllied(bot.houseId, sh), stance = ai.stance[sh] || 'neutral';
  const lying = () => Math.random() < (1 - ai.honesty) * 0.4 + (stance === 'betray' ? 0.35 : 0);
  let acted = false;
  const hasThreat = Object.keys(it.threats).length > 0;
  if (it.promise || it.delay || it.unable || it.refusePay) {
    acted = true;
    const fresh = ai.ctx[sender.id] && round - ai.ctx[sender.id].round <= 2;
    if (it.refusePay) parts.push(pickOne(['I understand. Then we will not count on you.', 'As you wish. I will remember it.']));
    else if (fresh) { botTrust(bot, sh, 1); parts.push(pickOne([`Good. I will hold you to it, ${sender.username}.`, 'Very well. I will wait for it, but not for long.'])); }
    else parts.push(pickOne([`Pay what, ${sender.username}? I am not aware that you owe me anything. Tell me what you mean.`, 'I do not know what you are promising. Is this about a treaty, or about something else?']));
  }
  if (it.offer && !it.promise) {
    acted = true; botTrust(bot, sh, 3 + Math.min(5, it.offerAmount || 0));
    parts.push(pickOne([`My thanks, ${HN(sh)}. I will remember it.`, 'A generous offer. I will not forget it.', 'That is welcome. I shall repay it in kind.']));
  }
  if (it.assure) {
    acted = true;
    parts.push(stance === 'betray' && Math.random() < 0.6 ? 'Words are cheap, my lord. Show me with deeds.' : pickOne(['Then we understand each other.', 'Good. I have no wish to fight you either.']));
  }
  if (it.caught) {
    acted = true;
    parts.push(botCaughtReply(bot, sender, it));
  }
  if (it.ultimatum) {
    acted = true;
    parts.push(botUltimatum(bot, sender, it));
  } else if (hasThreat) {
    acted = true;
    parts.push(botThreatReply(bot, sender, it));
  }
  if (it.declare && !hasThreat) {
    acted = true;
    parts.push(botDeclareReply(bot, sender, it));
  }
  if (it.accuse) {
    acted = true;
    const guilty = Object.values(ai.stance).includes('betray') && ai.stance[sh] === 'betray';
    parts.push(guilty && Math.random() < 0.7 ? pickOne(['A traitor? I have only ever acted in my own house’s interest.', 'You have no proof of that, my lord.']) : pickOne(['Careful with such words. They travel faster than ravens.', 'I have kept every oath I have made.']));
  }
  if (it.money && !it.ultimatum) {
    acted = true;
    const s = botWillingness(bot, sender, 'money');
    if (s > 0.25) {
      if (lying()) { ai.lies++; parts.push(pickOne([`Gold? It is on its way, ${HN(sh)}.`, 'You shall have it once my coffers are counted.'])); }
      else {
        const g = botGiveGold(bot, sender, it.amount, `Sent to House ${capWord(houseName(sh))}.`);
        if (g) ai.lastHelp[sender.id] = round;
        parts.push(g ? (g.now ? `I have sent you ${g.amt} gold. Spend it well.` : `You shall have ${g.amt} gold when the armies gather. Ask me then if it does not arrive.`) : 'My coffers are bare, I am afraid.');
      }
    } else parts.push(lying() ? 'My coffers are bare, I am afraid.' : pickOne([`Gold is not wheat to be scattered, ${HN(sh)}. Earn it.`, 'Not this time. Ask me when I am richer, or when we are closer.']));
  }
  if (it.troops && !it.ultimatum) {
    acted = true;
    const s = botWillingness(bot, sender, 'troops');
    if (s > 0.3 && !lying()) {
      const g = botGiveTroops(bot, sender, it.amount, it.ships);
      if (g) ai.lastHelp[sender.id] = round;
      parts.push(g ? (g.now ? `I send you ${g.infantry} soldiers${g.navy ? ` and ${g.navy} ships` : ''}.` : `${g.infantry} soldiers will reach you when the armies gather.`) : 'I have none to spare. My own walls need them.');
    } else parts.push(pickOne(['I cannot spare men. My own borders are thin.', 'My soldiers stay with me.', 'Ask me again when we have fought a common enemy.']));
  }
  if (it.attack && !it.declare && !it.ultimatum) {
    acted = true;
    const targets = [...it.capIds.map(findCapital), ...it.houseIds.map(id => botPickTargetCity(bot, id))].filter(c => c && c.ownerHouseId !== bot.houseId && capitalLive(c));
    const tc = targets[0];
    if (!tc && (it.houseIds.length || it.capIds.length)) parts.push('That city cannot be attacked right now.');
    else {
      const friendly = tc && tc.ownerHouseId && areAllied(bot.houseId, tc.ownerHouseId);
      const s = botWillingness(bot, sender, 'attack') - (friendly ? 0.8 : 0) - (tc && tc.ownerHouseId === sh ? 2 : 0);
      if (s > 0.2) {
        if (lying()) { ai.lies++; parts.push(`I will strike ${tc ? tc.name : 'them'} with you.`); }
        else {
          if (tc) ai.pledges.push({ capitalId: tc.id, forHouse: sh, round, expires: round + 3 });
          ai.lastHelp[sender.id] = round;
          parts.push(tc ? `Agreed. My banners will march on ${tc.name}.` : 'Agreed. I will pick a target and strike it.');
        }
      } else parts.push(friendly ? `${HN(tc.ownerHouseId)} is a friend of mine. Choose another target.` : pickOne(['Not now. I have my own plans.', 'The odds do not favour it.']));
    }
  }
  if (it.help) {
    acted = true;
    const s = botWillingness(bot, sender, 'help');
    const besieged = capitals.find(c => c.siege && c.ownerHouseId === sh);
    if (s > 0.15) {
      if (lying()) { ai.lies++; parts.push('Hold on. My army is on its way.'); }
      else if (besieged) { ai.lastHelp[sender.id] = round; ai.relief.push({ capitalId: besieged.id, forHouse: sh, round, expires: round + 3 }); parts.push(`I will relieve ${besieged.name}.`); }
      else {
        ai.peace[sh] = round + 4;
        const g = botGiveGold(bot, sender, null, 'Help.');
        parts.push(g ? `I will watch your borders. Here is ${g.amt} gold${g.now ? '' : ' soon'} to help.` : 'I will watch your borders and I will not move against you.');
      }
    } else parts.push(pickOne(['I wish I could. My hands are full.', 'Ask a closer friend.']));
  }
  if (it.peace && !it.ally) {
    acted = true;
    const s = botWillingness(bot, sender, 'peace');
    if (s > 0) {
      ai.peace[sh] = round + 2 + randomInt(0, 3); ai.lastHelp[sender.id] = round;
      if (lying() && !allied) { ai.peaceLie[sh] = true; ai.lies++; }
      parts.push(pickOne([`Peace, then. I will not move against ${HN(sh)}.`, 'A truce suits me, for now.']));
    } else parts.push(pickOne(['No promises.', 'Peace is earned.']));
  }
  if (it.intel) {
    acted = true;
    parts.push(botIntelFor(bot, sender));
  }
  if (it.follow) {
    acted = true;
    if (stance === 'follow' || (stance === 'neutral' && Math.random() < 0.4) || lying()) {
      if (stance !== 'follow' && lying()) ai.lies++;
      parts.push(pickOne([`I stand with ${HN(sh)}.`, 'You have my sword. For now.']));
    } else parts.push(pickOne(['I follow no one.', `${HN(bot.houseId)} bows to no other house.`]));
  }
  if (it.kind) {
    acted = true; botTrust(bot, sh, 4);
    parts.push(pickOne(['Noted.', 'Kind words cost nothing. I will remember them.']));
  }
  if (!acted) return botReply(bot, text, sender);
  let out = parts.join(' ');
  if (chance(0.25) && !/\?/.test(out)) out += ' ' + botAsk(bot, sender, pickOne(['trade', 'plans', 'worry', 'ally']));
  return out;
}
// What a bot tells somebody who asks what it has learned. It tells friends the truth, and others what suits it.
function botIntelFor(bot, sender) {
  const ai = botAi(bot), sh = sender.houseId;
  const items = ai.intel.filter(i => round - i.round <= 3 && i.aboutHouseId !== sh);
  if (!items.length) return pickOne(['I have heard nothing worth repeating.', 'My ravens have been quiet.']);
  const stance = ai.stance[sh] || 'neutral', allied = areAllied(bot.houseId, sh);
  const item = items.sort((a, b) => b.value - a.value)[0];
  const lie = Math.random() < (1 - ai.honesty) * 0.5 + (stance === 'betray' ? 0.4 : stance === 'neutral' && !allied ? 0.2 : 0);
  if (!allied && stance !== 'follow' && Math.random() < 0.5) return 'My scouts’ words are not for sale.';
  if (lie) { ai.lies++; return botFalseClaim(bot, item, sh); }
  return item.text;
}
// A believable lie that favours the bot: mislead about its own plans, inflate a rival, or point the ally at somebody else.
function botFalseClaim(bot, item, toHouseId) {
  const rival = houses.filter(x => x.id !== bot.houseId && x.id !== toHouseId && houseMembers(x.id).length && !houseFallen(x));
  if (item.kind === 'movement' || item.kind === 'count') {
    const r = rival.length ? pickOne(rival) : null;
    if (r && Math.random() < 0.5) return `My scouts say ${HN(r.id)} is gathering a large host and looks hungrily at your lands.`;
    return `${HN(item.aboutHouseId)} has about ${randomInt(2, 4)} more soldiers than I could count last round. Be careful.`;
  }
  if (item.kind === 'alliance') return 'I found no secret pacts at all. The realm is quiet.';
  return 'All is quiet. Nothing to report.';
}

// ---- What spies bring back ------------------------------------------------
function botReadReports(bot) {
  const ai = botAi(bot), h = bot.w, fresh = [];
  for (const r of h.spyReports || []) {
    if (ai.seenReports[r.id]) continue;
    ai.seenReports[r.id] = true;
    if (r.caught) { botTrust(bot, r.targetHouseId, 0); continue; }
    if (!r.success || !r.findings) continue;
    const f = r.findings, tid = r.targetHouseId, tn = HN(tid);
    let item = null;
    if (f.kind === 'count') {
      ai.est[tid] = { infantry: f.infantry, navy: f.navy, dragons: f.dragons, round: r.round };
      const total = f.infantry + f.navy + f.dragons * 3;
      item = { kind: 'count', aboutHouseId: tid, round: r.round, value: total > botPower(bot, bot.houseId) * 1.2 ? 4 : 1, text: `${tn} keeps roughly ${f.infantry} soldiers, ${f.navy} ships and ${f.dragons} dragons${f.marching ? ', and part of it is on the march' : ''}.` };
    } else if (f.kind === 'movement') {
      const cap = capitals.find(c => c.name === f.movingOn);
      ai.est[tid] = { infantry: f.infantry, navy: f.navy, dragons: f.dragons, round: r.round };
      const mine = cap && cap.ownerHouseId === bot.houseId, friend = cap && cap.ownerHouseId && areAllied(bot.houseId, cap.ownerHouseId);
      if (cap && mine) { ai.threats[cap.id] = round; ai.attackedBy = ai.attackedBy || {}; ai.attackedBy[tid] = round; botTrust(bot, tid, -15); }
      item = { kind: 'movement', aboutHouseId: tid, capitalId: cap?.id, round: r.round, value: mine ? 9 : friend ? 7 : 3, ownerHouseId: cap?.ownerHouseId, text: `${tn} has an army of about ${f.infantry} soldiers, ${f.navy} ships and ${f.dragons} dragons marching on ${f.movingOn || 'a city'}.` };
    } else if (f.kind === 'alliance') {
      const names = (f.houses || []).map(HN).join(' and ');
      const vsFriend = (f.houses || []).some(x => areAllied(bot.houseId, x));
      item = { kind: 'alliance', aboutHouseId: tid, round: r.round, value: vsFriend ? 6 : 3, text: `${tn} has a secret pact with ${names}.` };
    } else if (f.kind === 'raven' && f.letter) {
      const mentions = plainText(f.letter.text).includes(houseName(bot.houseId).toLowerCase());
      if (mentions) botTrust(bot, tid, -6);
      item = { kind: 'raven', aboutHouseId: tid, round: r.round, value: mentions ? 6 : 2, text: `I intercepted a raven from ${f.letter.from}: “${String(f.letter.text).slice(0, 120)}”` };
    } else if (f.kind === 'dragon') {
      item = { kind: 'dragon', aboutHouseId: tid, round: r.round, value: f.hasDragon ? 6 : 1, text: f.hasDragon ? `${tn} shelters a dragon.` : `${tn} has no dragon.` };
    } else if (f.kind === 'total' || f.kind === 'recent') {
      item = { kind: 'wealth', aboutHouseId: tid, round: r.round, value: 1, text: f.kind === 'total' ? `${tn} holds about ${f.gold} gold.` : `${tn} earned ${f.earned} and spent ${f.spent} gold lately.` };
    }
    if (item) { ai.intel.push(item); fresh.push(item); }
  }
  if (ai.intel.length > 30) ai.intel.splice(0, ai.intel.length - 30);
  return fresh;
}
// A bot that learns something valuable tells its friends, unless it has a reason to keep quiet or mislead.
function botShareIntel(bot, items) {
  const ai = botAi(bot);
  for (const item of items.filter(i => i.value >= 4)) {
    for (const a of alliances.filter(x => [x.houseA, x.houseB].includes(bot.houseId))) {
      const friend = a.houseA === bot.houseId ? a.houseB : a.houseA;
      if (friend === item.aboutHouseId) continue;
      const stance = ai.stance[friend] || 'neutral';
      const lieChance = (1 - ai.honesty) * 0.5 + (stance === 'betray' ? 0.45 : stance === 'neutral' ? 0.12 : 0) - (ai.trust[friend] || 0) / 400;
      if (Math.random() < lieChance) {
        ai.lies++;
        if (Math.random() < 0.4) continue; // keep quiet
        const false1 = botFalseClaim(bot, item, friend);
        botLater(bot, () => botSayHouse(bot, friend, false1));
        continue;
      }
      if (item.kind === 'movement' && item.ownerHouseId === friend) botLater(bot, () => botSayHouse(bot, friend, `Warning: ${item.text} Prepare your defences.`));
      else botLater(bot, () => botSayHouse(bot, friend, `My spies learned something for you: ${item.text}`));
      for (const other of botsOf(friend)) botReceiveIntel(other, bot.houseId, item);
    }
  }
}
function botReceiveIntel(bot, fromHouseId, item) {
  const ai = botAi(bot), w = clampN(0.5 + ((ai.trust[fromHouseId] || 0) + (areAllied(bot.houseId, fromHouseId) ? 20 : 0)) / 100, 0.15, 0.95);
  const mine = ai.est[item.aboutHouseId];
  if (item.kind === 'count' && mine && round - mine.round <= 2) {
    const sum = o => o.infantry + o.navy + o.dragons * 3;
    const m = item.text.match(/(\d+) soldiers, (\d+) ships and (\d+) dragons/);
    if (m && Math.abs(sum(mine) - (Number(m[1]) + Number(m[2]) + Number(m[3]) * 3)) > 6) { botTrust(bot, fromHouseId, -10); return; } // caught in a lie
  }
  if (Math.random() > w) return;
  if (item.kind === 'movement' && item.capitalId) {
    const cap = findCapital(item.capitalId);
    if (cap && cap.ownerHouseId && (cap.ownerHouseId === bot.houseId || areAllied(bot.houseId, cap.ownerHouseId))) ai.threats[cap.id] = round;
  }
  if (item.kind === 'count') { const m = item.text.match(/(\d+) soldiers, (\d+) ships and (\d+) dragons/); if (m) ai.est[item.aboutHouseId] = { infantry: +m[1], navy: +m[2], dragons: +m[3], round }; }
  ai.intel.push({ ...item, round, value: Math.max(1, item.value - 2) });
}

// ---- Stance and plan ------------------------------------------------------
// Every round each bot weighs, for every other house, whether following them or turning on them pays better.
// A random buffer per house keeps it from flipping on a hair, and it only changes once the score clears that buffer.
function botEvalStances(bot) {
  const ai = botAi(bot); ai.stanceRound = round;
  const me = botPower(bot, bot.houseId), kingHouse = players.get(kingPlayerId)?.houseId;
  for (const x of houses) {
    if (x.id === bot.houseId || !houseMembers(x.id).length || houseFallen(x)) continue;
    const allied = areAllied(bot.houseId, x.id);
    if (ai.buffer[x.id] === undefined) ai.buffer[x.id] = 0.15 + Math.random() * 0.25;
    const w = ai.buffer[x.id], pw = botPower(bot, x.id);
    let s = ((ai.trust[x.id] || 0) + (allied ? 20 : 0)) / 70 - (ai.grudge[x.id] || 0) / 80 - ai.aggr * 0.35 + ai.diplo * 0.25
      + (pw > me * 1.3 ? 0.3 : pw < me * 0.6 ? -0.35 : 0) + (kingHouse === x.id ? 0.15 - (ai.crownGrudge ? 0.4 : 0) : 0) + (Math.random() - 0.5) * 0.5;
    if (!allied) s -= 0.1;
    const prev = ai.stance[x.id] || 'neutral', lowBar = allied ? w : w + 0.15;
    let st = s > w ? 'follow' : s < -lowBar ? 'betray' : 'neutral';
    if (prev === 'follow' && s > -w * 0.3) st = 'follow';
    if (prev === 'betray' && s < w * 0.3) st = 'betray';
    if (botHostile(bot, x.id)) st = 'betray';
    ai.stance[x.id] = st; ai.score[x.id] = s;
  }
  // time heals a little
  for (const k of Object.keys(ai.grudge)) ai.grudge[k] = Math.max(0, ai.grudge[k] - 3);
  for (const a of alliances.filter(x => [x.houseA, x.houseB].includes(bot.houseId))) { const f = a.houseA === bot.houseId ? a.houseB : a.houseA; ai.trust[f] = clampN((ai.trust[f] || 0) + 1, -100, 100); }
}
function botMakePlan(bot) {
  const ai = botAi(bot), h = bot.w, income = playerIncome(bot);
  let goal = 'hold', focus = null;
  const mineBesieged = capitals.some(c => c.ownerHouseId === bot.houseId && (c.siege || (ai.threats[c.id] || 0) >= round - 1));
  const friendCity = capitals.find(c => c.siege && c.ownerHouseId && c.ownerHouseId !== bot.houseId && areAllied(bot.houseId, c.ownerHouseId) && ai.stance[c.ownerHouseId] === 'follow');
  const betrayTarget = houses.find(x => areAllied(bot.houseId, x.id) && ai.stance[x.id] === 'betray' && !houseFallen(x));
  if (mineBesieged) goal = 'defend';
  else if (friendCity) { goal = 'support'; focus = friendCity.id; }
  else if (betrayTarget && round >= 3) { goal = 'betray'; focus = betrayTarget.id; }
  else if (armySize(h) < Math.max(4, income * 0.7)) goal = 'build';
  else if (round >= 3 && Math.random() < 0.35 + ai.aggr * 0.55) goal = 'conquer';
  ai.plan = { goal, focus, round };
  return ai.plan;
}
const PLAN_BIAS = {
  build: { spend: 0.95, spy: 0.3, attack: 0.5, reserve: 0.3 },
  conquer: { spend: 0.85, spy: 0.7, attack: 1.4, reserve: 0.25 },
  defend: { spend: 0.8, spy: 0.6, attack: 0.3, reserve: 0.6 },
  betray: { spend: 0.85, spy: 0.9, attack: 1.3, reserve: 0.25 },
  support: { spend: 0.7, spy: 0.4, attack: 0.6, reserve: 0.3 },
  hold: { spend: 0.5, spy: 0.35, attack: 0.8, reserve: 0.4 }
};

// ---- Reactions to what other people do to a bot -------------------------
function botOnSpyCaught(spyHouseId, targetHouseId, spyPlayer) {
  if (spyPlayer && spyPlayer.isBot) botAi(spyPlayer).caughtBy[targetHouseId] = round;
  for (const b of botsOf(targetHouseId)) {
    const ai = botAi(b);
    botTrust(b, spyHouseId, -22);
    botLater(b, () => {
      const lines = ai.aggr > 0.6
        ? [`Your spies were caught in my halls, ${HN(spyHouseId)}. The next one will hang, and so will you.`, 'I know it was you. Remember that.']
        : [`Your agents were caught in my halls, ${HN(spyHouseId)}. A gift of gold might soften my temper.`, 'I will not forget this insult. Explain yourself.'];
      botSayHouse(b, spyHouseId, pickOne(lines));
    }, 3000, 9000);
  }
}
function botOnTraitor(target, king) {
  if (target.isBot && target.w) {
    const ai = botAi(target);
    botTrust(target, king.houseId, -30); ai.crownGrudge = round;
    botLater(target, () => botSayHouse(target, king.houseId, ai.aggr > 0.5 ? 'A traitor? The crown has forgotten who holds its borders. Remember this.' : 'I have served the crown faithfully. Withdraw this label, my king, and we shall speak.'), 3000, 8000);
  }
  for (const b of botsOf(target.houseId)) if (b.id !== target.id) botTrust(b, king.houseId, -12);
}
// An army has reached a bot's city: that house is now an enemy, however friendly it was before.
function botOnAttacked(attackerHouseId, defenderHouseId) {
  for (const b of botsOf(defenderHouseId)) {
    const ai = botAi(b); ai.attackedBy = ai.attackedBy || {};
    ai.attackedBy[attackerHouseId] = round; ai.stance[attackerHouseId] = 'betray';
    botTrust(b, attackerHouseId, -40);
  }
}
function botOnBetrayed(breakerHouseId, otherHouseId) {
  for (const b of botsOf(otherHouseId)) {
    botTrust(b, breakerHouseId, -35);
    botLater(b, () => botSayHouse(b, breakerHouseId, pickOne([`You broke our alliance, ${HN(breakerHouseId)}. Oathbreakers do not prosper.`, 'So that is how it is. Remember who offered you friendship.'])), 3000, 8000);
  }
}
function botOnGift(to, from, gold, infantry, navy) {
  if (!to.isBot || !to.w || !from.houseId) return;
  const worth = gold * 2 + (infantry + navy) * 3;
  if (worth > 0) { botTrust(to, from.houseId, Math.min(25, worth)); const ai = botAi(to); ai.grudge[from.houseId] = Math.max(0, (ai.grudge[from.houseId] || 0) - worth); }
}
// Run each tick: noticing sieges and lost cities, and doing queued speech and promises.
function botWatch(bot) {
  const ai = botAi(bot);
  const now = Date.now();
  ai.todo = ai.todo.filter(t => { if (now < t.at) return true; try { t.fn(); } catch (e) { console.error('Bot task failed:', e); } return false; });
  ai.attackedBy = ai.attackedBy || {};
  for (const c of capitals) {
    if (c.siege && c.ownerHouseId === bot.houseId) for (const e of c.siege.attackers) ai.attackedBy[e.houseId] = round;
  }
  for (const c of capitals) {
    if (!c.siege) continue;
    const key = `${c.id}:${c.siege.id || c.siege.startRound}`;
    if (ai.seenSieges[key]) continue;
    ai.seenSieges[key] = true;
    const attackers = [...new Set(c.siege.attackers.map(e => e.houseId))];
    if (c.ownerHouseId === bot.houseId) {
      ai.threats[c.id] = round;
      for (const a of attackers) botTrust(bot, a, -40);
      for (const f of alliances.filter(x => [x.houseA, x.houseB].includes(bot.houseId))) {
        const ally = f.houseA === bot.houseId ? f.houseB : f.houseA;
        if (attackers.includes(ally)) continue;
        const bots = botsOf(ally);
        botLater(bot, () => {
          botSayHouse(bot, ally, `${attackers.map(HN).join(' and ')} is besieging ${c.name}. Help me, ${HN(bot.houseId)} will remember who answered.`);
          for (const b of bots) botAi(b).relief.push({ capitalId: c.id, forHouse: bot.houseId, round, expires: round + 3, ifWilling: true });
        }, 2000, 6000);
      }
    } else if (c.ownerHouseId && areAllied(bot.houseId, c.ownerHouseId)) {
      for (const a of attackers) botTrust(bot, a, -10);
    }
  }
  // Cities lost since the last look
  const owned = capitals.filter(c => c.ownerHouseId === bot.houseId).map(c => c.id);
  if (ai.owned) for (const id of ai.owned) if (!owned.includes(id)) { const c = findCapital(id); if (c && c.ownerHouseId) { ai.attackedBy[c.ownerHouseId] = round; botTrust(bot, c.ownerHouseId, -45); if (c.id === 'kings-landing') ai.crownGrudge = round; } }
  ai.owned = owned;
  ai.pledges = ai.pledges.filter(p => p.expires >= round);
  ai.relief = ai.relief.filter(p => p.expires >= round);
}

// ---- Choosing an attack ---------------------------------------------------
function botAttackPlan(bot) {
  const h = bot.w, ai = botAi(bot), bias = PLAN_BIAS[ai.plan.goal] || PLAN_BIAS.hold;
  const reserve = { inf: Math.ceil(h.infantry * bias.reserve), navy: Math.ceil(h.navy * bias.reserve) };
  const thr = 0.6 + (1 - ai.aggr) * 0.2;
  const from = findCapital(bot.cityId) || homeCityOf(bot);
  let best = null;
  for (const c of capitals) {
    if (!capitalLive(c) || c.ownerPlayerId === bot.id || c.ownerHouseId === bot.houseId) continue;
    const hid = c.ownerHouseId, pledge = ai.pledges.find(p => p.capitalId === c.id);
    const allied = hid && areAllied(bot.houseId, hid);
    const betraying = allied && ai.stance[hid] === 'betray' && (ai.plan.goal === 'betray' || ai.plan.focus === hid || Math.random() < 0.3);
    if (allied && !betraying) continue;
    if (hid && !allied && (ai.stance[hid] === 'follow') && !pledge) continue;
    if (hid && (ai.peace[hid] || 0) >= round && !ai.peaceLie[hid] && !pledge) continue;
    if (c.siege && c.siege.attackers.some(e => e.houseId === bot.houseId)) continue;
    const defN = botDefenders(bot, c);
    const noNavy = c.id === 'winterfell' && buffsOn();
    const cap = { infantry: Math.max(0, h.infantry - reserve.inf), navy: noNavy ? 0 : Math.max(0, h.navy - reserve.navy), dragons: ai.plan.goal === 'defend' && c.id !== 'kings-landing' ? 0 : h.dragons };
    const total = cap.infantry + cap.navy + cap.dragons;
    if (total < 1) continue;
    const u = { infantry: 0, navy: 0, dragons: 0 }; let prob = 0, n = 0, found = false;
    const start = Math.max(1, Math.floor(defN * 0.7));
    for (const k of ['dragons', 'infantry', 'navy']) while (u[k] < cap[k] && n < total) {
      u[k]++; n++;
      if (n < start) continue;
      prob = simSiege(u, defN, 24);
      if (prob >= thr) { found = true; break; }
    }
    if (!found) continue;
    const travel = attackTravel(from, c, u);
    const score = (c.id === 'kings-landing' ? 10 : 0) + (c.vacant ? 9 : 0) + (hid ? 3 : 0) + (pledge ? 5 : 0) + (betraying ? 4 : 0)
      + (hid ? (ai.grudge[hid] || 0) / 15 : 0) + (hid && ai.stance[hid] === 'betray' ? 2 : 0) + (ai.threats[c.id] ? 0 : 0) + prob * 3
      - travel * 1.3 - n * 0.2 + Math.random();
    if (!best || score > best.score) best = { c, units: { ...u }, score, prob, betrayHouse: betraying ? hid : null, pledge };
  }
  if (!best) return null;
  if (!best.c.vacant && !best.pledge && Math.random() > Math.min(0.9, (0.08 + ai.aggr * 0.27) * bias.attack * 1.4)) return null;
  return best;
}

// How a bot answers a demand from the king: it pays, says it will pay later, says it cannot afford it, or defies the crown.
function botHandleDecree(bot, d) {
  const ai = botAi(bot), h = bot.w, king = players.get(d.kingPlayerId);
  const demand = [d.gold && `${d.gold} gold`, d.infantry && `${d.infantry} soldiers`, d.navy && `${d.navy} ships`].filter(Boolean).join(' and ');
  if (!demand) return false;
  ai.decreeStatus = ai.decreeStatus || {};
  const afford = h.money >= d.gold && h.infantry >= d.infantry && h.navy >= d.navy;
  const friend = areAllied(bot.houseId, d.kingHouseId);
  const kh = d.kingHouseId;
  const willing = 0.3 + ai.diplo * 0.3 + (friend ? 0.25 : 0) + (ai.trust[kh] || 0) / 200 - (ai.grudge[kh] || 0) / 150 - (d.gold > h.money * 0.5 ? 0.25 : 0) - (ai.crownGrudge ? 0.3 : 0);
  const tell = text => king && botSay(bot, text, king);
  const roll = Math.random();
  if (afford && roll < willing) {
    const ok1 = botDo(bot, 'respond-decree', { decreeId: d.id });
    if (ok1 && chance(0.6)) tell(pickOne([`Your decree is answered, ${king.username}: ${demand} sent.`, `${demand}, as the crown commands. I trust it is put to good use.`, `Paid. Do not say House ${capWord(h.name)} is disloyal.`]));
    if (ok1) { botTrust(bot, kh, 1); ai.decreeStatus[d.id] = 'paid'; }
    return ok1;
  }
  if (!afford) {
    ai.decreeStatus[d.id] = 'poor';
    const have = `${h.money} gold${d.infantry ? `, ${h.infantry} soldiers` : ''}${d.navy ? `, ${h.navy} ships` : ''}`;
    if (chance(0.45) && ai.honesty > 0.35) { ai.decreeStatus[d.id] = 'later'; ai.payLater = ai.payLater || []; ai.payLater.push({ decreeId: d.id, round: round + 1 }); tell(pickOne([`I cannot afford ${demand} right now, I only have ${have}. Give me a round or two and I will pay what I owe.`, `The treasury cannot bear ${demand} this round. I will pay later, you have my word.`])); }
    else tell(pickOne([`${demand} is more than I have. I only hold ${have}. Ask for less and I might oblige.`, `I would pay, but I simply cannot afford ${demand}.`, `The crown asks for ${demand} from a house with ${have}. That is not a tax, that is a siege.`]));
    return true;
  }
  // Could pay, but is unwilling: put it off, plead poverty (a lie), or defy.
  const r2 = Math.random();
  if (r2 < 0.35 && ai.honesty > 0.3) {
    ai.decreeStatus[d.id] = 'later';
    ai.payLater = ai.payLater || []; ai.payLater.push({ decreeId: d.id, round: round + 1 });
    tell(pickOne([`I will pay, ${king?.username}, but not this round. My army needs feeding first.`, `Soon. ${demand} will reach you once my coffers recover.`, 'Patience, my king. You will have your due.']));
  } else if (r2 < 0.55 && ai.honesty < 0.7) {
    ai.decreeStatus[d.id] = 'poor';
    ai.lies++; tell(pickOne([`I do not have ${demand} to spare, I am afraid. The treasury is bare.`, 'You ask for more than I can give. My lands are poor this season.']));
  } else {
    ai.decreeStatus[d.id] = 'defied';
    botTrust(bot, kh, -10); ai.crownGrudge = round;
    const line = ai.aggr > 0.6 ? pickOne([`No. House ${capWord(h.name)} pays no tribute to ${king ? 'King ' + king.username : 'the crown'}.`, `Come and take it, ${king?.username || 'your grace'}.`]) : pickOne([`I respectfully decline. ${demand} is too much to ask of a free house.`, 'I will not pay this. Ask me nicely and we can talk.']);
    if (chance(0.4)) botSay(bot, `${line} ${chance(0.5) ? 'Let the whole table hear it.' : ''}`.trim()); else tell(line);
  }
  return true;
}

// ---- A bot's turn --------------------------------------------------------
function botAskAllies(bot, plan, target) {
  const ai = botAi(bot), h = bot.w;
  for (const a of alliances.filter(x => [x.houseA, x.houseB].includes(bot.houseId))) {
    const friend = a.houseA === bot.houseId ? a.houseB : a.houseA;
    if (ai.asked[friend] === round || (ai.stance[friend] || 'neutral') === 'betray' || Math.random() > 0.55) continue;
    ai.asked[friend] = round;
    const besieged = capitals.find(c => c.siege && c.ownerHouseId === bot.houseId);
    let ask = null, line = '';
    if (besieged) { ask = { help: true }; line = `${besieged.name} is under siege. Help me, friend.`; }
    else if (h.money < 6 && ['build', 'conquer', 'betray'].includes(plan.goal)) { ask = { money: true, amount: randomInt(3, 8) }; line = `Friend, I am short of coin. Can you send me ${ask.amount} gold?`; }
    else if (target && plan.goal === 'conquer') { ask = { attack: true, capIds: [target.id], houseIds: [] }; line = `Join me against ${target.ownerHouseId ? HN(target.ownerHouseId) : 'the throne'}: attack ${target.name} with me.`; }
    else if (plan.goal === 'build' && Math.random() < 0.3) { ask = { troops: true, amount: randomInt(2, 4) }; line = 'Friend, send me some troops. I will not forget it.'; }
    if (!ask) continue;
    const people = houseMembers(friend).filter(p => !p.eliminated);
    const humans = people.filter(p => !p.isBot);
    if (humans.length) { botSay(bot, line, humans[0]); ai.ctx = ai.ctx || {}; ai.ctx[humans[0].id] = { kind: 'ask', ask, round }; }
    for (const other of botsOf(friend)) {
      botLater(other, () => {
        const reply = botConverseStructured(other, bot, ask, line);
        if (reply) botSay(other, reply, bot);
      }, 3000, 9000);
    }
  }
}
// Bots talk to each other with the same logic, using the structured form of the request.
function botConverseStructured(responder, asker, ask, line) {
  return botConverse(responder, asker, line);
}
function botTurn(bot) {
  const h = bot.w, ai = botAi(bot);
  if (ai.stanceRound !== round) { botEvalStances(bot); botMakePlan(bot); }
  const plan = ai.plan, bias = PLAN_BIAS[plan.goal] || PLAN_BIAS.hold;
  // Promises made earlier
  const owe = ai.owe.splice(0);
  for (const o of owe) { const to = players.get(o.toPlayerId); if (to && !to.left && !to.eliminated) { const gold = Math.min(o.gold, h.money), inf = Math.min(o.infantry, h.infantry), nav = Math.min(o.navy, h.navy); if (gold + inf + nav > 0) botDo(bot, 'send-gift', { toPlayerId: o.toPlayerId, gold, infantry: inf, navy: nav, message: o.message || '' }); } }
  // Players who promised to pay the crown's decree: remind them once the time is up, then hold it against them.
  for (const [pid, e] of Object.entries(ai.expect || {})) {
    const d = taxLedger.find(x => x.id === e.decreeId), to = players.get(pid);
    const pending = d && to && d.recipients.some(r => r.houseId === to.houseId && r.state === 'pending');
    if (!pending) { delete ai.expect[pid]; continue; }
    if (round > e.due && !e.nudged) { e.nudged = true; botSay(bot, pickOne([`${to.username}, the ${demandText(d)} was promised by Round ${e.due}. I am still waiting.`, `Your word was "soon", ${to.username}. Soon has come and gone.`]), to); }
    else if (round > e.due + 1) { botTrust(bot, to.houseId, -8); ai.grudge[to.houseId] = (ai.grudge[to.houseId] || 0) + 6; botSay(bot, 'You gave your word and broke it. The crown will remember.', to); delete ai.expect[pid]; }
  }
  // Decrees it promised to pay later
  if (ai.payLater?.length) {
    ai.payLater = ai.payLater.filter(pl => {
      if (round < pl.round) return true;
      const d = taxLedger.find(x => x.id === pl.decreeId), r = d && d.recipients.find(x => x.houseId === bot.houseId && x.state === 'pending');
      if (!r) return false;
      if (h.money >= d.gold && h.infantry >= d.infantry && h.navy >= d.navy) { if (botDo(bot, 'respond-decree', { decreeId: d.id })) { const king = players.get(d.kingPlayerId); if (king && chance(0.6)) botSay(bot, pickOne(['As promised, the crown has its due.', 'I said I would pay. It is sent.']), king); } return false; }
      pl.round = round + 1; return (pl.tries = (pl.tries || 0) + 1) < 3;
    });
  }
  // Spies: scout, then read and share what came back.
  if (bot.lastSpyRound !== round && h.money >= 8 && Math.random() < bias.spy) {
    const pool = houses.filter(x => x.id !== bot.houseId && houseMembers(x.id).length && !houseFallen(x));
    const weight = x => 1 + (ai.stance[x.id] === 'betray' ? 3 : 0) + (ai.grudge[x.id] || 0) / 20 + (ai.est[x.id] && round - ai.est[x.id].round <= 2 ? 0 : 1.5) + (areAllied(bot.houseId, x.id) ? -0.5 : 0) + (plan.focus === x.id ? 3 : 0);
    let pick = null, total = pool.reduce((n, x) => n + Math.max(0.2, weight(x)), 0), roll = Math.random() * total;
    for (const x of pool) { roll -= Math.max(0.2, weight(x)); if (roll <= 0) { pick = x; break; } }
    if (pick) {
      const r = Math.random();
      const mission = (ai.grudge[pick.id] || 0) > 25 && r < 0.3 ? 'messages' : r < 0.12 ? 'wealth' : 'war';
      ai.spiedOn[pick.id] = round;
      botDo(bot, 'spy', { targetHouseId: pick.id, mission, spend: clampN(Math.round(h.money * (0.15 + ai.greed * 0.1)), 2, 20) });
    }
  }
  const fresh = botReadReports(bot);
  if (fresh.length) botShareIntel(bot, fresh);
  // Recruit with what the treasury can spare, keeping the army no larger than income can feed.
  const income = playerIncome(bot);
  const roomForTroops = Math.floor(income * 1.1) + 3 - armySize(h);
  const spendable = h.money - Math.max(0, armySize(h) - 8);
  if (roomForTroops > 0 && spendable >= h.infantryCost) {
    const n = Math.min(roomForTroops, Math.floor(spendable * bias.spend / h.infantryCost));
    if (n >= 1) botDo(bot, 'purchase', { unit: 'infantry', amount: n });
  }
  if (h.navy < 4 && Math.random() < 0.25 && h.money >= h.navyCost * 2 && armySize(h) + 2 <= Math.floor(income * 1.1) + 3) botDo(bot, 'purchase', { unit: 'navy', amount: randomInt(1, 2) });
  // Relief first: a besieged city of its own, or of a friend it promised to help.
  let target = null;
  if (round >= 2 && !(h.marches || []).some(m => !m.returning) && !h.hasAttackedThisRound) {
    const wanted = [...ai.relief.map(r => ({ ...r })), ...capitals.filter(c => c.siege && c.ownerHouseId === bot.houseId).map(c => ({ capitalId: c.id, forHouse: bot.houseId }))];
    for (const r of wanted) {
      const c = findCapital(r.capitalId);
      if (!c || !c.siege || !capitalLive(c) || (c.ownerHouseId !== bot.houseId && !areAllied(bot.houseId, c.ownerHouseId))) continue;
      if (r.ifWilling && (botWillingness(bot, { houseId: c.ownerHouseId, id: '' }, 'help') < 0.1)) continue;
      const own = c.ownerHouseId === bot.houseId, share = own ? 0.6 : 0.4;
      const inf = Math.floor(h.infantry * share), nav = c.id === 'winterfell' ? 0 : Math.floor(h.navy * share * 0.5);
      if (inf + nav < 1) continue;
      if (botDo(bot, 'plan-attack', { targetCapitalId: c.id, infantry: inf, navy: nav, dragons: own ? h.dragons : 0 })) { target = c; break; }
    }
  }
  // Attack, and take the throne when it can be taken. Betraying a friend means breaking the alliance first.
  if (!target && round >= 3 && !(h.marches || []).some(m => !m.returning) && !h.hasAttackedThisRound) {
    const attack = botAttackPlan(bot);
    if (attack) {
      if (attack.betrayHouse) {
        const al = alliances.find(a => [a.houseA, a.houseB].includes(bot.houseId) && [a.houseA, a.houseB].includes(attack.betrayHouse));
        if (al) botDo(bot, 'break-alliance', { allianceId: al.id });
      }
      if (botDo(bot, 'plan-attack', { targetCapitalId: attack.c.id, ...attack.units })) { target = attack.c; ai.pledges = ai.pledges.filter(p => p.capitalId !== attack.c.id); }
    }
  }
  // The king brands the houses it holds a grudge against, and pardons the repentant.
  if (bot.id === kingPlayerId && Math.random() < 0.5) {
    for (const p of players.values()) {
      if (p.id === bot.id || p.left || p.eliminated || !p.houseId || p.isBot && areAllied(bot.houseId, p.houseId)) continue;
      const g = ai.grudge[p.houseId] || 0;
      if (!p.traitor && g >= 45) { botDo(bot, 'mark-traitor', { playerId: p.id, traitor: true }); break; }
      if (p.traitor && g < 15 && (ai.trust[p.houseId] || 0) > 10) { botDo(bot, 'mark-traitor', { playerId: p.id, traitor: false }); break; }
    }
  }
  // Seek friends: offer an alliance and a word to its leader.
  const mine = alliances.filter(a => [a.houseA, a.houseB].includes(bot.houseId)).length;
  if (ai.dipRound !== round && mine < 3 && Math.random() < ai.diplo * 0.75) {
    ai.dipRound = round;
    const options = houses.filter(x => x.id !== bot.houseId && houseMembers(x.id).length && !houseFallen(x) && !areAllied(bot.houseId, x.id) && x.id !== target?.ownerHouseId
      && (ai.stance[x.id] || 'neutral') !== 'betray' && (ai.grudge[x.id] || 0) < 40 && !botHostile(bot, x.id)
      && !allianceOffers.some(o => (o.fromHouseId === bot.houseId && o.toHouseId === x.id) || (o.fromHouseId === x.id && o.toHouseId === bot.houseId)));
    if (options.length) {
      const pick = pickOne(options);
      if (botDo(bot, 'offer-alliance', { targetHouseId: pick.id, scope: Math.random() < 0.3 ? 'secret' : 'public' })) {
        const to = houseMembers(pick.id).find(p => !p.isBot);
        if (to) botSay(bot, pickOne([`House ${capWord(bot.w.name)} offers you an alliance. Together we would be hard to break. ${HOUSE_WORDS[bot.houseId] || ''}`, `Let us not waste strength on each other, House ${capWord(pick.name)}. Accept my alliance.`]), to);
      }
    }
  } else if (Math.random() < 0.2) {
    const others = houses.filter(x => x.id !== bot.houseId && houseMembers(x.id).length && !houseFallen(x));
    const king = players.get(kingPlayerId);
    botSay(bot, pickOne([
      h.money < 8 ? 'Is anyone else running short of gold, or is it just me?' : 'My treasury is in decent shape this round. Do not get any ideas.',
      others.length ? `Has anyone heard anything from House ${capWord(pickOne(others).name)} lately?` : 'It is getting quiet out there.',
      king && king.houseId !== bot.houseId ? `Whoever advises King ${king.username} should tell him to watch his back.` : 'The crown is heavy, but somebody has to carry it.',
      armySize(h) > 12 ? 'I have more soldiers than I know what to do with. Anyone want to make use of them?' : 'Soldiers are not cheap. Anyone else feeling it?',
      'Alliances are only as good as the people in them. Choose wisely.',
      chance(0.1) && HOUSE_WORDS[bot.houseId] ? HOUSE_WORDS[bot.houseId] : 'Something tells me this round will not be quiet.'
    ]));
  }
  // Now and then, start a conversation with a person: a question about their plans, their friends or the king.
  if (Math.random() < 0.2 + ai.diplo * 0.25) {
    const humans = [...players.values()].filter(p => !p.isBot && !p.left && !p.eliminated && p.houseId && p.houseId !== bot.houseId && !botHostile(bot, p.houseId));
    const target = humans.length ? pickOne(humans) : null;
    ai.askedHuman = ai.askedHuman || {};
    if (target && (ai.askedHuman[target.id] || 0) < round - 1) {
      ai.askedHuman[target.id] = round;
      const topic = (ai.grudge[target.houseId] || 0) > 30 ? 'trade' : areAllied(bot.houseId, target.houseId) ? pickOne(['plans', 'worry', 'king']) : pickOne(['ally', 'worry', 'plans', 'king']);
      const topicFixed = topic === 'king' && target.id === kingPlayerId ? 'worry' : topic;
      const openers = { plans: 'Quiet round so far.', worry: 'The table is getting tense.', king: 'Have you seen the way the crown behaves lately?', ally: 'I have been thinking about who to trust.', trade: 'Let us speak plainly.' };
      botSay(bot, `${openers[topicFixed]} ${botAsk(bot, target, topicFixed)}`, target);
    }
  }
  // Ask friends for what the plan needs.
  botAskAllies(bot, plan, target || null);
}
function botTick() {
  if (gameOver || !canDiplomacy()) return false;
  const bots = [...players.values()].filter(p => p.isBot && !p.left && !p.eliminated && p.w && p.houseId && !houseFallen(findHouse(p.houseId)));
  let acted = false;
  const now = Date.now();
  for (const bot of bots) {
    const ai = botAi(bot), h = bot.w, lead = botLeads(bot);
    const done = v => { if (v) acted = true; };
    botWatch(bot);
    // The crown is offered to this bot.
    const throne = capitals.find(c => c.id === 'kings-landing');
    if (throne?.vacant && throne.offerTo === bot.id && botReady(bot, `crown${round}`)) done(botDo(bot, 'crown-choice', { accept: Math.random() < 0.55 + ai.aggr * 0.4 }));
    // King: name a Hand when there is none, and charge taxes.
    if (bot.id === kingPlayerId) {
      const hand = handPlayerId ? players.get(handPlayerId) : null;
      if (handOn() && (!hand || hand.left || hand.eliminated) && botReady(bot, `hand${round}:${handPlayerId || ''}`, 3000, 9000)) {
        const pool = [...players.values()].filter(p => p.id !== bot.id && !p.left && !p.eliminated && p.houseId);
        const friends = pool.filter(p => areAllied(bot.houseId, p.houseId));
        if (pool.length) done(botDo(bot, 'replace-hand', { playerId: pickOne(friends.length ? friends : pool).id }));
      }
      if (h.commandUsedRound !== round && botReady(bot, `decree${round}`, 5000, 14000) && Math.random() < 0.7) {
        done(botDo(bot, 'issue-decree', { gold: randomInt(3, 8), infantry: 0, navy: 0, message: pickOne(['The crown requires its due.', 'Tribute for the Iron Throne.', 'Pay your taxes, loyal lords.']) }));
      }
    }
    // Answer alliance offers and treaties for a house with only bots.
    if (lead && houseIsBotOnly(bot.houseId)) {
      for (const o of allianceOffers.filter(x => x.toHouseId === bot.houseId)) {
        if (!botReady(bot, `ao${o.id}`)) continue;
        const marching = (h.marches || []).some(m => !m.returning && findCapital(m.targetCapitalId)?.ownerHouseId === o.fromHouseId);
        const crowded = alliances.filter(a => [a.houseA, a.houseB].includes(bot.houseId)).length >= 3;
        const fromHouse = o.fromHouseId, bias = ((ai.trust[fromHouse] || 0) / 200) - ((ai.grudge[fromHouse] || 0) / 150) - (ai.stance[fromHouse] === 'betray' ? 0.3 : 0);
        done(botDo(bot, 'respond-alliance', { offerId: o.id, accept: !marching && !botHostile(bot, fromHouse) && Math.random() < (crowded ? 0.2 : 0.4 + ai.diplo * 0.45) + bias }));
      }
      for (const t of treaties.filter(x => x.status === 'pending' && x.toHouseId === bot.houseId)) {
        if (botReady(bot, `tr${t.id}`)) done(botDo(bot, 'respond-treaty', { treatyId: t.id, accept: Math.random() < 0.9 && !botHostile(bot, t.fromHouseId) }));
      }
    }
    // Answer royal decrees: pay, promise to pay later, plead poverty, or refuse outright.
    for (const d of taxLedger) {
      const r = d.recipients.find(x => x.houseId === bot.houseId && x.state === 'pending');
      if (!r || d.kingPlayerId === bot.id || botAi(bot).decreeStatus?.[d.id] || !botReady(bot, `dec${d.id}`, 3000, 10000)) continue;
      done(botHandleDecree(bot, d));
    }
    // Settle disputed spoils in its own favour.
    for (const s of spoils) {
      if (s.status !== 'open' || ![s.houseA, s.houseB].includes(bot.houseId) || s.claims[bot.houseId]) continue;
      if (lead && botReady(bot, `sp${s.id}`)) done(botDo(bot, 'claim-spoils', { spoilId: s.id, claimHouseId: bot.houseId }));
    }
    // Reply to private messages, and to public ones that name it.
    const sees = privateMessages.filter(m => m.senderId !== bot.id && (m.targets || []).some(t => t.id === bot.id) && m.round >= round - 1);
    const named = m => m.message.toLowerCase().includes(bot.username.toLowerCase()) || (lead && houseIsBotOnly(bot.houseId) && m.message.toLowerCase().includes(`house ${h.name.toLowerCase()}`));
    // It answers anything addressed to it, and joins in on about half of other public talk (one bot per message).
    const pub = publicMessages.filter(m => m.senderId !== bot.id && m.round >= round - 1 && players.get(m.senderId) && !players.get(m.senderId).isBot
      && (named(m) || (!botAnswered.has(m.id) && (ai.joined?.[m.id] ?? (ai.joined = ai.joined || {}, ai.joined[m.id] = Math.random() < 0.5)))));
    for (const m of [...sees, ...pub]) {
      const sender = players.get(m.senderId);
      if (!sender || sender.isBot || !botReady(bot, `msg${m.id}`, 3000, 9000)) continue;
      if (m.scope !== 'secret' && !named(m)) { if (botAnswered.has(m.id)) continue; botAnswered.add(m.id); }
      if (!botNeedsReply(bot, sender, m.message)) { done(true); break; }
      const text = botConverse(bot, sender, m.message);
      if (!text) { done(true); break; }
      const sent = botSay(bot, text, m.scope === 'secret' ? sender : null);
      if (sent && !botHostile(bot, sender.houseId) && /alli|ally|pact|join|together/.test(m.message.toLowerCase()) && sender.houseId && sender.houseId !== bot.houseId && !areAllied(bot.houseId, sender.houseId)
        && !allianceOffers.some(o => (o.fromHouseId === bot.houseId && o.toHouseId === sender.houseId) || (o.fromHouseId === sender.houseId && o.toHouseId === bot.houseId))
        && Math.random() < 0.3 + ai.diplo * 0.5 + (ai.trust[sender.houseId] || 0) / 200 - (ai.grudge[sender.houseId] || 0) / 150) {
        botDo(bot, 'offer-alliance', { targetHouseId: sender.houseId, scope: m.scope === 'secret' ? 'secret' : 'public' });
      }
      done(sent);
      break;
    }
    // Once per round, take a turn during the action phase.
    if (phase === 'ACTION') {
      if (ai.turnFor !== round) { ai.turnFor = round; ai.turnAt = now + randomInt(4000, 16000); ai.turnDone = false; }
      if (!ai.turnDone && now >= ai.turnAt) { ai.turnDone = true; botTurn(bot); acted = true; }
    }
  }
  return acted;
}

// ---- Talking like a person -----------------------------------------------
const botAnswered = new Set();
const chance = p => Math.random() < p;
// A short remark about how the bot feels toward the speaker, used to colour replies.
function botTone(bot, sender) {
  const ai = botAi(bot), sh = sender?.houseId, t = (ai.trust[sh] || 0) + (areAllied(bot.houseId, sh) ? 20 : 0), g = ai.grudge[sh] || 0;
  return botHostile(bot, sh) || g > 35 ? 'cold' : t > 30 ? 'warm' : 'plain';
}
const QUESTIONS = {
  plans: ['What are you planning for the next round?', 'Where do you mean to strike next?', 'Are you building up or getting ready to march?'],
  worry: ['Who worries you most right now?', 'Which house do you think is the real danger?', 'Who do you trust at this table?'],
  king: ['What do you make of the king?', 'Are you with the crown or against it?'],
  ally: ['Would you stand with me if it came to war?', 'Have you made any pacts I should know about?', 'Who are your friends at this table?'],
  trade: ['What would you give me in return?', 'What do you need from me?', 'Is there something you want?']
};
function botAsk(bot, sender, topic) {
  if (topic === 'king' && sender.id === kingPlayerId) topic = 'worry'; // never ask the king what he thinks of the king
  const ai = botAi(bot), q = pickOne(QUESTIONS[topic] || QUESTIONS.plans);
  ai.lastAsk = ai.lastAsk || {}; ai.lastAsk[sender.id] = { topic, round };
  return q;
}
function botVoice(bot, sender, core) {
  const tone = botTone(bot, sender);
  if (tone === 'cold') return pickOne(['', '', 'Hm. ']) + core;
  if (tone === 'warm' && chance(0.4)) return pickOne(['Friend, ', 'My friend, ', `Well, ${sender.username}, `]) + core.charAt(0).toLowerCase() + core.slice(1);
  return core;
}
// Free-form talk: greetings, questions about its plans, how it is doing, insults, answers to its own questions.
function botReply(bot, text, sender) {
  const t = plainText(text), ai = botAi(bot), h = bot.w, words = HOUSE_WORDS[bot.houseId] || '';
  const sh = sender?.houseId, allied = sh && areAllied(bot.houseId, sh);
  const goal = ai.plan?.goal || 'hold';
  let reply = null, ask = null;
  // The answer to something it asked
  const last = ai.lastAsk && sender && ai.lastAsk[sender.id];
  if (last && round - last.round <= 1 && !/\?/.test(text.trim().slice(-1))) {
    delete ai.lastAsk[sender.id];
    const hs = houses.filter(x => t.includes(x.name.toLowerCase())).map(x => x.id).filter(x => x !== bot.houseId);
    if (sh) botTrust(bot, sh, 2);
    if (hs.length && (last.topic === 'plans' || last.topic === 'worry')) {
      const target = hs[0];
      ai.intel.push({ kind: 'hearsay', aboutHouseId: target, round, value: 2, text: `${sender.username} says House ${capWord(houseName(target))} is the one to watch.` });
      if (areAllied(bot.houseId, target)) reply = pickOne([`${HN(target)} is my friend, so I'll be careful what I make of that.`, `I'd be surprised. ${HN(target)} has dealt straight with me.`]);
      else reply = pickOne([`${HN(target)}, hm. That fits what I've been hearing.`, `Interesting. I'll keep an eye on ${HN(target)}.`, `I had my doubts about ${HN(target)} too.`]);
    } else if (last.topic === 'king') {
      reply = /\b(good|great|fine|loyal|fair|support|like)\b/.test(t) ? pickOne(['A kind view. I am not so sure myself.', 'Loyalty is easy while the crown is paying.']) : pickOne(['Some of us share that opinion.', 'Careful, the walls have ears.']);
    } else reply = pickOne(['Fair enough.', 'I see. Thank you for being straight with me.', 'Good to know.', 'Hm, noted.']);
    return botVoice(bot, sender, reply) + (chance(0.25) ? ' ' + botAsk(bot, sender, pickOne(['plans', 'worry', 'trade'])) : '');
  }
  if (/\b(thank|thanks|thx|ty|appreciate|cheers)\b/.test(t) && !/\b(not|no)\b/.test(t)) {
    reply = pickOne(['You are welcome.', 'Think nothing of it.', 'Glad to help. Remember it when I need a favour.']);
  } else if (/\b(hi|hello|hey|greetings|good (day|morning|evening)|well met|my lord|my lady)\b/.test(t)) {
    reply = pickOne(['Hello. What brings you to me?', 'Well met. What can I do for you?', 'Greetings. I was starting to wonder who would speak first.', `Hello, ${sender?.username || 'friend'}. Anything on your mind?`]);
    if (chance(0.35)) ask = 'plans';
  } else if (/\b(how are you|hows it going|how is it going|whats up|how are things|how are you doing)\b/.test(t)) {
    reply = pickOne([`Can't complain. ${h.money > 25 ? 'The treasury is healthy' : h.money < 8 ? 'Gold is tight' : 'Gold is steady'} and I have ${armySize(h)} units under arms.`, `Busy. ${goal === 'build' ? 'Mostly building up my forces.' : goal === 'defend' ? 'Keeping a close eye on my borders.' : goal === 'conquer' ? 'Looking for an opening.' : 'Waiting to see who blinks first.'}`, 'Well enough. And you?']);
    if (chance(0.4)) ask = 'plans';
  } else if (/\b(what.*(your plan|you planning|you doing|you up to|next move)|your plans?|where.*strike|who.*attack(ing)?)\b/.test(t)) {
    const honest = chance(ai.honesty * (allied ? 1 : 0.55));
    const truth = goal === 'build' ? 'Mostly building up. I want a bigger army before I take any risks.' : goal === 'conquer' ? 'I am looking for a soft target. I will not say which.' : goal === 'defend' ? 'Defence. Someone has their eye on my lands.' : goal === 'betray' ? 'Keeping my options open.' : goal === 'support' ? 'Helping a friend who is in trouble.' : 'Watching and waiting.';
    reply = honest ? truth : pickOne(['Nothing special. Staying quiet this round.', 'Just building up, like everyone.']);
    if (!honest) ai.lies++;
    if (chance(0.6)) ask = 'plans';
  } else if (/\b(why|how come|explain)\b/.test(t)) {
    reply = pickOne(['Because it suits my house. Surely you would do the same.', 'There are reasons. Not all of them are for sharing.', 'Fair question. Short answer: trust has to be earned.']);
    if (chance(0.4)) ask = 'trade';
  } else if (/\b(king|crown|throne|hand|rule[rs]?)\b/.test(t)) {
    const kp = players.get(kingPlayerId), isMe = kp && kp.houseId === bot.houseId;
    const toKing = sender && sender.id === kingPlayerId;
    reply = toKing ? pickOne(['You wear the crown, your grace, you tell me how it sits.', 'It is your crown, king. I only hope it is worn wisely.', 'Ask yourself, your grace. You know the realm better than I.']) : isMe ? pickOne(['The crown is heavy, but I am used to the weight.', 'Ruling is mostly paperwork and enemies.']) : pickOne([`${kp ? `King ${kp.username}` : 'Whoever sits there'} holds it for now. For now.`, 'Many want it. Few survive it.', 'A crown is only as safe as the armies behind it.']);
    ask = toKing ? (chance(0.5) ? 'worry' : null) : chance(0.5) ? 'king' : null;
  } else if (/\b(idiot|stupid|fool|coward|weak|pathetic|useless|shut up|hate you|worthless)\b/.test(t)) {
    if (sh) botTrust(bot, sh, -4);
    reply = pickOne(['Insults are what people say when they have run out of armies.', 'Careful. I have a long memory.', 'That was unnecessary.']);
  } else if (/\b(trust|promise|swear|word|honest)\b/.test(t)) {
    reply = (allied || (ai.trust[sh] || 0) > 10) ? pickOne(['I have kept my word so far. I mean to keep it.', 'We will see how the next few rounds go.']) : pickOne(['Trust is earned in rounds, not in messages.', 'Words are cheap. Show me.']);
    if (chance(0.4)) ask = 'trade';
  } else if (/^(yes|yeah|yep|sure|ok|okay|alright|fine|agreed|deal|no|nope|nah|maybe)\b/.test(t)) {
    reply = /^(no|nope|nah)/.test(t) ? pickOne(['Then that is that.', 'Pity. The offer may not stand.']) : pickOne(['Good. Then we understand each other.', 'Then it is settled.', 'Very well.']);
  } else {
    return botConfused(bot, text, sender);
  }
  let out = botVoice(bot, sender, reply);
  if (ask && !/\?/.test(out)) out += ' ' + botAsk(bot, sender, ask);
  return out;
}

setInterval(() => {
  for (const code of [...gameRooms.keys()]) {
    const room = gameRooms.get(code);
    if (!room || !room.players || ![...room.players.values()].some(p => p.isBot)) continue;
    try { withWorld(code, () => { if (botTick()) broadcastState(code); }); } catch (error) { console.error('Bot tick failed:', error); }
  }
}, 2500);

setInterval(() => {
  for (const code of [...gameRooms.keys()]) {
    const room = gameRooms.get(code);
    if (!room?.gameSettings?.roundSeconds) { phaseTimers.delete(code); continue; }
    try {
      withWorld(code, () => {
        if (gameOver || !['ACTION', 'COURT', 'RESOLUTION'].includes(phase)) { phaseTimers.delete(code); return; }
        const key = `${round}:${phase}`, now = Date.now();
        const timer = phaseTimers.get(code);
        if (!timer || timer.key !== key) { phaseTimers.set(code, { key, endsAt: now + phaseSeconds() * 1000 }); broadcastState(code); return; }
        if (now >= timer.endsAt) { advancePhase(); broadcastState(code); }
      });
    } catch (error) { console.error('Round timer failed:', error); }
  }
}, 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Iron Throne multiplayer server listening on port ${PORT}`);
  console.log(`Allowed browser origins: ${[...allowedOrigins].join(', ') || '(none configured)'}`);
});
