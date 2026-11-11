(() => {
  'use strict';

  const SERVER_URL = window.GOT_CONFIG?.serverUrl || 'http://localhost:3000';
  const tokenKey = 'ironThroneClientToken';
  const usernameKey = 'ironThroneUsername';
  const savedNameKey = 'ironThroneSavedName';
  const savedPlayerName = () => { try { return localStorage.getItem(savedNameKey) || ''; } catch (e) { return ''; } };
  let enteredName = savedPlayerName();
  const roomCodeKey = 'warOfWesterosGamePin';
  // House chosen on the throne screen before logging in. Claimed automatically right after login.
  const pickedHouseKey = 'ironThronePickedHouse';
  let pickedHouse = null;
  let preparingHost = false;
  let showHostSetup = false;
  let changingLobbyHouse = false;
  let nameDismissed = false;
  let lobbyCanChangeHouse = false;
  let gameCode = '';
  let savedCode = localStorage.getItem(roomCodeKey)?.toUpperCase() || '';
  try { pickedHouse = JSON.parse(localStorage.getItem(pickedHouseKey) || 'null'); } catch { pickedHouse = null; }
  const hashHouse = /^#house=([a-z\-]{2,40})$/i.exec(location.hash);
  if (hashHouse) {
    const key = decodeURIComponent(hashHouse[1]).toLowerCase();
    pickedHouse = { key, name: `House ${key.charAt(0).toUpperCase()}${key.slice(1)}` };
    localStorage.setItem(pickedHouseKey, JSON.stringify(pickedHouse));
    history.replaceState(null, '', location.pathname + location.search);
  }
  let clientToken = localStorage.getItem(tokenKey);
  if (!clientToken) {
    const makePart = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
    clientToken = `${makePart()}-${makePart()}`;
    localStorage.setItem(tokenKey, clientToken);
  }

  const $ = id => document.getElementById(id);
  function setThronePage(mode) {
    const frame = $('throneFrame');
    if (frame) frame.src = mode === 'entry' ? './throne-photo.html?mode=entry&v=19' : './throne-photo.html?v=19';
  }
  function transitionThrone(mode) {
    const frame = $('throneFrame');
    if (frame?.contentWindow) frame.contentWindow.postMessage({ type: 'iron-throne:set-mode', mode }, location.origin === 'null' ? '*' : location.origin);
  }
  setThronePage(gameCode ? 'house' : 'entry');
  const isRealPhone = () => Boolean(navigator.userAgentData?.mobile || /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent) || (window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 900));
  const isMobileDevice = () => Boolean(window.PHONE_FRAME || isRealPhone());
  const syncMobileLayout = () => { document.body.classList.toggle('mobile-device', isMobileDevice()); document.body.classList.toggle('real-phone', isRealPhone()); };
  syncMobileLayout();
  window.addEventListener('resize', syncMobileLayout, { passive: true });
  window.addEventListener('orientationchange', syncMobileLayout, { passive: true });

  // iPhone: if the page ever ends up zoomed (e.g. after the keyboard closes), snap it back to fit the screen.
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  function resetMobileZoom() {
    if (!viewportMeta || !isMobileDevice()) return;
    const original = viewportMeta.content;
    viewportMeta.content = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no';
    setTimeout(() => { viewportMeta.content = original; }, 80);
  }
  window.resetMobileZoom = resetMobileZoom;
  document.addEventListener('focusout', () => setTimeout(resetMobileZoom, 60));
  window.addEventListener('pageshow', resetMobileZoom);
  window.addEventListener('load', () => setTimeout(resetMobileZoom, 100));

  // Mobile: block pinch zoom, and keep the browser's own bars hidden (full screen).
  // Tapping empty space brings the bars back; they hide again a few seconds later.
  // (Not available on iPhone Safari; installing to the Home Screen gives the same bar-free view there.)
  document.addEventListener('gesturestart', event => event.preventDefault());
  const fsRoot = document.documentElement;
  const fsRequest = fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen;
  const fsExit = document.exitFullscreen || document.webkitExitFullscreen;
  const fsActive = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const isInstalledApp = window.matchMedia('(display-mode: fullscreen)').matches || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const FS_CONTROLS = 'button, a, input, select, textarea, label, summary, [data-action], [role="button"], .map-cap';
  const FS_IDLE_MS = 4000;
  let fsWanted = false;
  let fsTimer = null;
  function enterFullscreen() {
    clearTimeout(fsTimer);
    try { Promise.resolve(fsRequest.call(fsRoot, { navigationUI: 'hide' })).catch(() => {}); } catch { /* not allowed right now */ }
  }
  function hideBarsSoon() {
    clearTimeout(fsTimer);
    fsTimer = setTimeout(() => { if (fsWanted && !fsActive()) enterFullscreen(); }, FS_IDLE_MS);
  }
  if (fsRequest && fsExit && !isInstalledApp && !window.PHONE_FRAME) {  // never inside the laptop phone frame
    document.addEventListener('click', event => {
      if (!isMobileDevice()) return;
      if (!fsWanted) { fsWanted = true; enterFullscreen(); return; }       // first tap: go full screen
      if (!fsActive()) { enterFullscreen(); return; }                      // bars showing: hide them again
      if (!event.target.closest(FS_CONTROLS)) {                            // tap on empty space: show bars briefly
        try { Promise.resolve(fsExit.call(document)).catch(() => {}); } catch { /* ignore */ }
        hideBarsSoon();
      }
    });
    // Any touch while the bars are showing keeps them up a little longer.
    ['pointerdown', 'keydown'].forEach(name => document.addEventListener(name, () => { if (fsWanted && !fsActive()) hideBarsSoon(); }, { passive: true }));
  }
  const socket = window.io ? window.io(SERVER_URL, { autoConnect: true, reconnection: true, reconnectionAttempts: Infinity }) : null;
  let state = null;
  let activeChatTab = 'public';
  let toastTimer = null;

  const PHASES = {
    LOBBY: ['THE LOBBY', 'The Great Houses', 'Choose a house. The lobby host can begin the Great Council once everyone has joined a house.'],
    HAND_SELECTION: ['THE FIRST KING', 'Appoint the Hand', 'The first king was chosen at random (a Baratheon always takes the crown if one is playing). The king chooses the Hand of the King before Round 1 begins.'],
    ACTION: ['ROUND ACTIONS', `Round ${state?.round || 1}: prepare your moves`, 'Recruit forces, purchase intelligence, and plan an attack. Army sizes stay private from enemy houses.'],
    COURT: ['THE ROYAL COURT', 'Words and alliances', 'Negotiate, make alliance offers, exchange secret messages, and let the king issue one decree.'],
    RESOLUTION: ['ROUND RESOLUTION', 'The realm answers', 'The host resolves the round. Pending attacks that are due are calculated and the realm chronicle is updated.']
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function prettyHouse(houseId) {
    return state?.houses?.find(h => h.id === houseId)?.name || houseId || 'Unknown house';
  }

  function phaseLabel(phase) {
    return ({ LOBBY: 'LOBBY', HAND_SELECTION: 'FIRST KING', ACTION: `ROUND ${state?.round || 1} · ACTION`, COURT: `ROUND ${state?.round || 1} · COURT`, RESOLUTION: `ROUND ${state?.round || 1} · RESOLUTION` })[phase] || phase;
  }

  function showToast(message, kind = 'normal') {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast toast-visible ${kind === 'error' ? 'toast-error' : kind === 'success' ? 'toast-success' : ''}`;
    // A popover lives in the top layer, so the toast shows above open dialogs (like the lobby menu) too.
    try { if (!toast.hasAttribute('popover')) toast.setAttribute('popover', 'manual'); if (!toast.matches(':popover-open')) toast.showPopover(); else { toast.hidePopover(); toast.showPopover(); } } catch (e) { /* older browsers: fixed toast */ }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast'; try { toast.hidePopover(); } catch (e) { /* not open */ } }, 4200);
  }

  function setConnection(connected, label) {
    const dot = $('serverDot');
    if (dot) { dot.classList.toggle('is-on', connected); dot.classList.toggle('is-off', !connected); dot.title = dot.ariaLabel = `Server ${connected ? 'connected' : 'offline'}`; }
    const pill = $('connectionPill');
    if (!pill) return;
    pill.className = `status-pill ${connected ? 'status-online' : 'status-offline'}`;
    pill.setAttribute('aria-label', `Server ${label.toLowerCase()}`);
    pill.title = `Server ${label.toLowerCase()}`;
    pill.innerHTML = `<i></i><span>${escapeHtml(label)}</span>`;
  }

  function emitAction(eventName, payload = {}, onOk) {
    if (!socket?.connected) {
      showToast('Not connected to the game server yet.', 'error');
      return;
    }
    socket.emit(eventName, payload, result => {
      if (!result?.ok) showToast(result?.message || 'Action failed.', 'error');
      else {
        if (result.message) showToast(result.message, 'success');
        if (onOk) onOk(result);
      }
    });
  }

  // ---- Locked buttons stay tappable: tapping one explains why it is locked ----
  function lock(el, reason) {
    if (!el) return;
    el.disabled = false;
    el.classList.toggle('is-locked', Boolean(reason));
    if (reason) { el.dataset.lockReason = reason; el.setAttribute('aria-disabled', 'true'); }
    else { delete el.dataset.lockReason; el.removeAttribute('aria-disabled'); }
  }
  const lockAttr = reason => (reason ? ` data-lock-reason="${escapeHtml(reason)}"` : '');
  document.addEventListener('click', event => {
    const locked = event.target.closest?.('.is-locked');
    if (!locked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showToast(locked.dataset.lockReason || 'That is not available right now.', 'error');
  }, true);
  document.addEventListener('submit', event => {
    const locked = event.target.querySelector?.('button.is-locked');
    if (!locked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showToast(locked.dataset.lockReason || 'That is not available right now.', 'error');
  }, true);

  // ---- The whole interface wears your house colour ----
  function applyTheme() {
    const pref = schemePref();
    const house = pref === 'none' ? null : pref !== 'auto' && state?.houses?.some(h => h.id === pref) ? state.houses.find(h => h.id === pref) : (state?.me?.houseId ? state.houses.find(h => h.id === state.me.houseId) : null);
    document.body.classList.toggle('house-themed', Boolean(house));
    if (house?.color) document.body.style.setProperty('--accent', house.color);
    else document.body.style.removeProperty('--accent');
  }

  function playerName(playerId) {
    return state?.players?.find(p => p.id === playerId)?.username || 'Unknown player';
  }

  const HOUSE_SPRITE_POSITION = {
    stark: ['0%', '0%'], lannister: ['33.333%', '0%'], baratheon: ['66.667%', '0%'], targaryen: ['100%', '0%'],
    tyrell: ['0%', '100%'], greyjoy: ['33.333%', '100%'], martell: ['66.667%', '100%'], arryn: ['100%', '100%']
  };

  function houseBanner(house, className = 'house-sigil-art') {
    if (!house?.id) return '';
    const position = HOUSE_SPRITE_POSITION[house.id];
    if (!position) return '';
    return `<span class="${className} house-sprite" style="--sprite-x:${position[0]};--sprite-y:${position[1]}" role="img" aria-label="${escapeHtml(house.name)} house banner"></span>`;
  }

  // Why `house` can't be taken by player `excludeId` right now (null = available). Mirrors the server rules.
  function minorHouseReason(house, excludeId) {
    const s = state.settings || {};
    if ((s.disabledHouses || []).includes(house.id)) return 'Not in this game';
    if (house.id === 'targaryen' && s.gameType === 'LAST_DRAGON') return 'Not available in Last Dragon';
    const others = house.players.filter(p => !p.left && p.id !== excludeId).length;
    if (s.gameType === 'TEAMS') {
      const size = s.teamSize || 2, maxTeams = Math.ceil((s.maxPlayers || 8) / size);
      if (others >= size) return `Team full · ${others} of ${size}`;
      const used = new Set(state.players.filter(p => !p.left && p.houseId && p.id !== excludeId).map(p => p.houseId));
      return !others && used.size >= maxTeams ? `All ${maxTeams} teams formed · join an existing team` : null;
    }
    return others ? 'Already claimed by another player' : null;
  }
  const houseChangeMsg = () => 'There are no other houses available right now.';
  // Teams must be as even as possible. Returns a message, or '' when fine.
  function teamProblem(list) {
    if (state.settings?.gameType !== 'TEAMS') return '';
    const sizes = state.houses.map(h => ({ h, n: list.filter(p => p.houseId === h.id).length })).filter(x => x.n > 0);
    if (sizes.length < 2) return 'Teams mode needs at least 2 teams.';
    const size = state.settings.teamSize || 2, need = Math.ceil(list.length / size);
    if (sizes.length !== need) return `With ${list.length} players and teams of ${size}, there must be ${need} teams. Right now there ${sizes.length === 1 ? 'is 1' : `are ${sizes.length}`}.`;
    const most = Math.max(...sizes.map(x => x.n)), least = Math.min(...sizes.map(x => x.n));
    if (most - least <= 1) return '';
    return `Teams must be as even as possible. ${sizes.filter(x => x.n === most).map(x => x.h.name).join(', ')}: ${most}. ${sizes.filter(x => x.n === least).map(x => x.h.name).join(', ')}: ${least}.`;
  }

  function renderWaitingRoom() {
    if (!state?.me) return;
    const activePlayers = state.players.filter(player => !player.left);
    $('lobbyCount').textContent = `${activePlayers.length} player${activePlayers.length === 1 ? '' : 's'}`;
    const setup = state.settings || { maxPlayers: 16, gameType: 'CLASSIC' };
    const gameTypeLabel = setup.gameType === 'LAST_DRAGON' ? `Last Dragon · ${plural(setup.dragonCount || 1, 'Dragon')} · ${setup.dragonRounds || 5} rounds` : setup.gameType === 'TEAMS' ? `Teams · up to ${setup.teamSize || 2} per team` : 'Classic';
    const ffLabel = setup.friendlyFire === false ? ' · Friendly fire off' : '';
    $('lobbySettings').textContent = `${gameTypeLabel} · ${activePlayers.length} of ${setup.maxPlayers} players${ffLabel}`;
    lobbyCanChangeHouse = state.phase === 'LOBBY' && state.houses.some(h => h.id !== state.me.houseId && !minorHouseReason(h, state.me.id));
    lock(document.querySelector('[data-action="edit-menu-house"]'), lobbyCanChangeHouse ? '' : houseChangeMsg());
    const houseRank = id => { const i = state.houses.findIndex(h => h.id === id); return i < 0 ? state.houses.length : i; };
    const lobbyOrder = [...state.players].sort((a, b) => houseRank(a.houseId) - houseRank(b.houseId));
    $('lobbyRoster').innerHTML = lobbyOrder.length ? lobbyOrder.map(p => {
      const house = state.houses.find(h => h.id === p.houseId);
      const banner = house ? houseBanner(house, 'player-house-banner') : '<span class="player-house-banner player-house-pending" aria-hidden="true">?</span>';
      const status = p.isBot ? 'Bot player' : p.left ? 'Left the game' : p.connected ? 'Connected' : 'Reconnecting';
      const own = p.id === state.me.id;
      const houseControl = own ? `<button class="lobby-banner-button ${lobbyCanChangeHouse ? '' : 'is-locked'}" type="button" data-action="edit-player" data-edit-kind="house" aria-label="Change your house"${lockAttr(lobbyCanChangeHouse ? '' : houseChangeMsg())}>${banner}</button>` : banner;
      const nameEdit = own ? '<button class="player-edit-name" type="button" data-action="edit-player" data-edit-kind="name" aria-label="Edit your name">✎</button>' : '';
      const kickControl = !p.isBot && state.isHost && state.phase === 'LOBBY' && !own && p.id !== state.hostId ? `<button class="player-edit-name player-remove-bot" type="button" data-action="kick-player" data-player-id="${escapeHtml(p.id)}" aria-label="Remove ${escapeHtml(p.username)}">✕</button>` : '';
      const botControls = p.isBot && state.isHost && state.phase === 'LOBBY' ? `<button class="player-edit-name" type="button" data-action="edit-bot" data-bot-id="${escapeHtml(p.id)}" aria-label="Edit ${escapeHtml(p.username)}">✎</button><button class="player-edit-name player-remove-bot" type="button" data-action="remove-bot" data-bot-id="${escapeHtml(p.id)}" aria-label="Remove ${escapeHtml(p.username)}">✕</button>` : '';
      return `<div class="player-row ${p.left ? 'player-left' : ''} ${own ? 'player-row-own' : ''}" ${own && house?.color ? `style="--house-color:${escapeHtml(house.color)}"` : ''}>${houseControl}<div class="player-row-info"><strong>${escapeHtml(p.username)}<img class="player-icon name-icon ${p.isBot || (p.connected && !p.left && p.houseId) ? '' : 'player-away'}" src="./assets/ui-${p.isBot ? 'bot' : p.connected && !p.left && p.houseId ? 'player' : 'dead'}.png?v=2" alt="">${p.id === state.hostId ? ' <em class="host-tag">SERVER OWNER</em>' : ''}${nameEdit}${botControls}${kickControl}</strong><small>${house ? `House ${escapeHtml(house.name)}` : 'Joining · house not chosen'} · ${status}</small></div></div>`;
    }).join('') : '<p class="muted">The hall is quiet. Be the first to join.</p>';
    const canStart = state.isHost && state.phase === 'LOBBY';
    const canAddBot = canStart && activePlayers.length < Number(setup.maxPlayers);
    $('addBotButton').hidden = !canStart;
    lock($('addBotButton'), canAddBot ? '' : 'The hall is full. Raise the player limit or remove someone first.');
    $('startGameButton').hidden = !canStart;
    const connectedPlayers = activePlayers.filter(p => p.connected);
    const teamMsg = teamProblem(connectedPlayers);
    const hasHuman = connectedPlayers.some(p => !p.isBot);
    lock($('startGameButton'), !canStart ? '' : !hasHuman ? 'A human player is needed to be the first king. Bots cannot be king.' : connectedPlayers.length < 2 ? 'At least 2 connected players are needed to begin.' : teamMsg);
    $('lobbyHostNote').textContent = !canStart ? 'The server owner will begin the game when everyone is ready.'
      : teamMsg ? teamMsg
      : 'As server owner, begin when everyone is ready.';
  }

  function renderKingSelection() {
    const king = state.king;
    const kingPlayer = state.players.find(player => player.id === king?.id);
    const house = state.houses.find(item => item.id === kingPlayer?.houseId);
    $('firstKingIdentity').innerHTML = `${houseBanner(house, 'player-house-banner first-king-banner')}<div><small>FIRST KING · HOUSE BARATHEON</small><strong>${escapeHtml(king?.username || 'Awaiting the king')}</strong></div>`;
    $('handSelectionForm').hidden = !state.isKing;
    $('kingWaitingMessage').hidden = state.isKing;
    $('kingWaitingMessage').textContent = `${king?.username || 'The king'} is choosing the Hand of the King. The game will begin when the appointment is made.`;
    const candidates = state.players.filter(player => player.id !== state.me?.id && !player.left);
    $('handPlayerSelect').innerHTML = '<option value="" disabled selected>Choose a player</option>' + candidates.map(player => {
      const playerHouse = state.houses.find(item => item.id === player.houseId);
      return `<option value="${escapeHtml(player.id)}">${escapeHtml(player.username)}${playerHouse ? ` · House ${escapeHtml(playerHouse.name)}` : ''}${player.connected ? '' : ' · reconnecting'}</option>`;
    }).join('');
    $('handPlayerSelect').disabled = !candidates.length;
    lock($('handSelectionForm').querySelector('button[type="submit"]'), 'Choose a player to appoint first.');
  }

  // ---- War: the target is chosen on the map ----
  let warTargetId = null;
  let pickingTarget = false;
  const capName = text => String(text || '').replace(/^\w/, c => c.toUpperCase());
  const diploOpen = () => state?.phase === 'ACTION' || state?.phase === 'COURT';
  const alliesOf = houseId => (state?.alliances || []).filter(a => a.houseA === houseId || a.houseB === houseId).map(a => (a.houseA === houseId ? a.houseB : a.houseA));

  function warTargetProblem(capital) {
    const mine = state.myHouse;
    if (capital.contested) return `${capital.name} is contested between two victorious allies. Wait until they settle who rules it.`;
    if (!capital.vacant) { const owner = state.houses.find(x => x.id === capital.ownerHouseId); if (!owner || !(owner.players || []).some(p => !p.left)) return `${capital.name} belongs to a house nobody chose, so it cannot be attacked.`; }
    if (capital.vacant) return '';
    if (capital.siege && capital.ownerHouseId && capital.ownerPlayerId !== state.me?.id && (capital.ownerHouseId === mine.id || alliesOf(mine.id).includes(capital.ownerHouseId))) return '';
    if (!capital.ownerHouseId || capital.ownerPlayerId === state.me?.id) return `${capital.name} is already yours.`;
    const ff = state.settings?.friendlyFire !== false;
    if (capital.ownerHouseId === mine.id && !ff) return `Friendly fire is off: ${capital.name} is held by your own house.`;
    if (alliesOf(mine.id).includes(capital.ownerHouseId) && !ff) return `${capital.name} belongs to your ally, House ${capName(prettyHouse(capital.ownerHouseId))}, and friendly fire is off.`;
    return '';
  }
  let attackMode = 'infantry';
  // One kind of force per march: soldiers by land, ships by sea, or dragons.
  const attackUnits = () => ({ infantry: attackMode === 'infantry' ? Number($('attackInfantry').value) || 0 : 0, navy: attackMode === 'navy' ? Number($('attackNavy').value) || 0 : 0, dragons: attackMode === 'dragons' ? Number($('attackDragons').value) || 0 : 0 });
  function applyAttackMode() {
    const isTarg = state?.myHouse?.id === 'targaryen';
    if (attackMode === 'dragons' && !isTarg) attackMode = 'infantry';
    const box = $('attackMode'); if (!box) return;
    box.querySelectorAll('button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.v === attackMode)); if (b.dataset.v === 'dragons') b.hidden = !isTarg; });
    box.hidden = false;
    [['attackInfantry', 'infantry'], ['attackNavy', 'navy'], ['attackDragons', 'dragons']].forEach(([id, k]) => { const col = $(id).parentElement; if (col) col.hidden = k !== attackMode; });
  }
  function warBlockReason() {
    const h = state?.myHouse;
    if (!h) return 'Choose a house first.';
    if (state.round < 2) return 'Wars cannot begin until Round 2. Round 1 is for building and scheming.';
    if (state.phase !== 'ACTION') return 'War is declared during the action phase. Wait for the next round to begin.';
    if (!state.capitals.some(c => !warTargetProblem(c))) return 'There is no capital you can attack right now.';
    return '';
  }
  function attackLockReason() {
    const block = warBlockReason();
    if (block) return block;
    if (!warTargetId) return 'Choose a target capital on the map first.';
    const h = state.myHouse;
    const { infantry: inf, navy: nav, dragons: dr } = attackUnits();
    if ([inf, nav, dr].some(n => !Number.isInteger(n) || n < 0)) return 'Units to send must be whole numbers, zero or more.';
    if (inf + nav + dr < 1) return 'Commit at least one unit to the war.';
    { const t = state.capitals.find(c => c.id === warTargetId); if (nav > 0 && t?.id === 'winterfell') return 'Winterfell cannot be attacked by ships. Send land forces only.'; }
    if (inf > h.infantry || nav > h.navy || dr > h.dragons) return `You only have ${h.infantry} infantry, ${h.navy} ships and ${h.dragons} dragons to send.`;
    return '';
  }
  const TRAVEL_SPEED = { infantry: 300, navy: 1200, dragons: 700 }; // map units per round (same as the server); ships use state.shipTravel because they sail around the coast
  function travelFor(target) {
    const from = state.capitals.find(c => c.id === state.myHouse?.cityId);
    if (!from || !target) return { infantry: 1, navy: 1, dragons: 1 };
    const d = Math.hypot(from.x - target.x, from.y - target.y);
    const out = Object.fromEntries(Object.entries(TRAVEL_SPEED).map(([k, v]) => [k, Math.max(1, Math.ceil(d / v))]));
    const sail = state.shipTravel?.[from.id]?.[target.id];
    if (sail) out.navy = sail;
    return out;
  }
  function travelNote() {
    const t = state.capitals.find(c => c.id === warTargetId);
    if (!t) return '';
    const tr = travelFor(t), au = attackUnits();
    const used = [['infantry', au.infantry], ['navy', au.navy], ['dragons', au.dragons]].filter(([, c]) => c > 0).map(([k]) => tr[k]);
    const rounds = Math.max(1, ...used);
    const word = r => `${r} round${r === 1 ? '' : 's'}`;
    return `Travel to ${t.name}: infantry ${word(tr.infantry)}, ships ${word(tr.navy)}, dragons ${word(tr.dragons)}. ${used.length ? `Your force arrives after Round ${state.round + rounds} court.` : ''}`;
  }
  function renderMarchList() {
    const box = $('marchList'); if (!box) return;
    const ms = state?.myHouse?.marches || [];
    const word = u => [['infantry', u.infantry], ['ships', u.navy], ['dragons', u.dragons]].filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ');
    box.innerHTML = ms.map(m => `<div class="march-row"><span>${m.returning ? 'Returning home' : m.relief ? `Relieving ${escapeHtml(m.targetName)}` : `Marching on ${escapeHtml(m.targetName)}`}: ${escapeHtml(word(m.units))}. ${m.returning ? 'Home' : 'Arrives'} after Round ${m.resolveRound}.</span>${m.returning ? '' : `<button class="button button-quiet button-small ${state.phase === 'ACTION' ? '' : 'is-locked'}" type="button" data-action="cancel-march" data-march-id="${escapeHtml(m.id)}"${state.phase === 'ACTION' ? '' : ' disabled'}>Call back</button>`}</div>`).join('');
  }
  function updateAttackLock() {
    if (!state?.myHouse) return;
    $('attackOrderStatus').textContent = travelNote();
    const at = (state.myHouse.sieges || []).map(x => `Your army at ${x.capitalName} (${x.role === 'relief' ? 'relief' : 'siege'}): ${[['infantry', x.units.infantry], ['ships', x.units.navy], ['dragons', x.units.dragons]].filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'none left'}.`);
    if (at.length) $('attackOrderStatus').textContent = [$('attackOrderStatus').textContent, ...at].filter(Boolean).join(' ');
    lock($('attackForm').querySelector('button[type="submit"]'), attackLockReason());
  }
  const isReliefTarget = c => Boolean(c?.siege && c.ownerHouseId && c.ownerPlayerId !== state.me?.id && (c.ownerHouseId === state.myHouse?.id || alliesOf(state.myHouse?.id).includes(c.ownerHouseId)));
  function renderWarTarget() {
    const c = state.capitals.find(x => x.id === warTargetId);
    const box = $('warTargetBox');
    box.classList.toggle('is-empty', !c);
    const relief = isReliefTarget(c);
    const sg = c?.siege ? ` · Besieged by ${c.siege.attackerHouseIds.map(id => `House ${escapeHtml(capName(prettyHouse(id)))}`).join(' and ')} (battle ${c.siege.battles})` : '';
    box.innerHTML = c ? `${escapeHtml(c.name)}<small>${escapeHtml(c.region)} · ${c.vacant ? 'Empty throne' : `House ${escapeHtml(capName(prettyHouse(c.ownerHouseId)))}`}${sg}</small>` : 'No target chosen yet';
    const submit = $('attackForm').querySelector('button[type="submit"]');
    if (submit) { submit.textContent = relief ? 'Send relief army' : 'Declare war'; submit.classList.toggle('button-danger', !relief); submit.classList.toggle('button-primary', relief); }
    const mine = c && state.myHouse?.sieges?.find(x => x.capitalId === c.id);
    $('withdrawButton').hidden = !mine;
    $('warPanel').hidden = !c;
  }

  // Map: owner colours, contested capitals, and target picking.
  const normName = text => String(text || '').toLowerCase().replace(/[^a-z]/g, '');
  // Pieces: the game's own icons (units and castles) recoloured to a house colour and set on a chess-piece base, so they stand out on land and sea.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICON_FILE = { infantry: 'ui-spear.png?v=3', navy: 'ui-ship.png?v=3', dragons: 'ui-dragon.png?v=3', castle: 'game-castle.png?v=3' };
  const KIND_NAME = { infantry: 'infantry', navy: 'ships', dragons: 'dragons' };
  const mixHex = (hex, other, t) => {
    const p = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const a = p(/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#c8a45c'), b = p(other);
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
  };
  // One recolour filter per colour and size: grey the icon, map it onto dark-to-light shades of the colour, add a dark edge and a cream halo.
  function tintFilter(svg, fill, size) {
    const k = Math.max(0.3, size / 100), id = `tint${fill.replace('#', '')}${Math.round(k * 10)}`;
    if (svg.querySelector('#' + id)) return id;
    let defs = svg.querySelector('#pieceDefs');
    if (!defs) { defs = document.createElementNS(SVG_NS, 'defs'); defs.id = 'pieceDefs'; svg.insertBefore(defs, svg.firstChild); }
    const lo = mixHex(fill, '#1b1208', 0.5), hi = mixHex(fill, '#ffffff', 0.5), mid = mixHex(lo, fill, 0.5);
    const ch = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
    const [l, md, m, h2] = [ch(lo), ch(mid), ch(fill), ch(hi)];
    const tbl = i => `${l[i].toFixed(3)} ${md[i].toFixed(3)} ${m[i].toFixed(3)} ${h2[i].toFixed(3)}`;
    const f = document.createElementNS(SVG_NS, 'filter');
    f.id = id; f.setAttribute('x', '-15%'); f.setAttribute('y', '-15%'); f.setAttribute('width', '130%'); f.setAttribute('height', '130%'); f.setAttribute('color-interpolation-filters', 'sRGB');
    f.innerHTML = `<feMorphology in="SourceAlpha" operator="dilate" radius="${(6 * k).toFixed(2)}" result="d1"/><feFlood flood-color="#f6edd2"/><feComposite in2="d1" operator="in" result="halo"/>
      <feMorphology in="SourceAlpha" operator="dilate" radius="${(3 * k).toFixed(2)}" result="d2"/><feFlood flood-color="#1b1208"/><feComposite in2="d2" operator="in" result="edge"/>
      <feColorMatrix in="SourceGraphic" type="matrix" values="0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0 0 0 1 0" result="gray"/>
      <feComponentTransfer in="gray" result="tint"><feFuncR type="table" tableValues="${tbl(0)}"/><feFuncG type="table" tableValues="${tbl(1)}"/><feFuncB type="table" tableValues="${tbl(2)}"/></feComponentTransfer>
      <feMerge><feMergeNode in="halo"/><feMergeNode in="edge"/><feMergeNode in="tint"/></feMerge>`;
    defs.appendChild(f);
    return id;
  }
  const pieceRect = (x, y, w, h, rx, fill, stroke, sw) => { const r = document.createElementNS(SVG_NS, 'rect'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h); r.setAttribute('rx', rx); r.setAttribute('fill', fill); r.setAttribute('stroke', stroke); r.setAttribute('stroke-width', sw); return r; };
  // A chess-piece stand (wide base, narrow collar, shine) with the recoloured icon standing on it. (cx, baseY) is the bottom centre.
  function chessPiece(svg, kind, cx, baseY, size, fill) {
    const g = document.createElementNS(SVG_NS, 'g'), k = Math.max(0.3, size / 100);
    const bw = size * 0.92, bh = size * 0.17, cw = size * 0.66, chh = size * 0.08, edge = 3.5 * Math.max(0.45, k), halo = 5 * Math.max(0.45, k);
    const dark = mixHex(fill, '#1b1208', 0.55), light = mixHex(fill, '#ffffff', 0.28);
    g.appendChild(pieceRect(cx - bw / 2 - halo, baseY - bh - halo, bw + halo * 2, bh + halo * 2, bh / 2 + halo, '#f6edd2', '#f6edd2', 0));
    const icon = document.createElementNS(SVG_NS, 'image'), isz = size * 0.92;
    icon.setAttribute('href', './assets/' + ICON_FILE[kind]); icon.setAttribute('x', cx - isz / 2); icon.setAttribute('y', baseY - bh - chh - size * 0.84); icon.setAttribute('width', isz); icon.setAttribute('height', isz);
    icon.setAttribute('filter', `url(#${tintFilter(svg, fill, size)})`);
    g.appendChild(icon);
    g.appendChild(pieceRect(cx - cw / 2, baseY - bh - chh, cw, chh + 2, chh / 3, fill, '#1b1208', edge * 0.85));
    g.appendChild(pieceRect(cx - bw / 2, baseY - bh, bw, bh, bh / 2, fill, '#1b1208', edge));
    for (const [yy, col] of [[0.62, light], [0.2, dark]]) {
      const ln = document.createElementNS(SVG_NS, 'path'); ln.setAttribute('d', `M${cx - bw / 2 + bh * 0.6} ${baseY - bh * yy}H${cx + bw / 2 - bh * 0.6}`); ln.setAttribute('stroke', col); ln.setAttribute('stroke-width', Math.max(1.2, bh * 0.16)); ln.setAttribute('stroke-linecap', 'round');
      g.appendChild(ln);
    }
    return g;
  }
  function renderMap() {
    if (!state?.capitals) return;
    const byName = new Map(state.capitals.map(c => [normName(c.name), c]));
    $('mapDialog').querySelectorAll('.map-cap').forEach(el => {
      const label = el.querySelector('.cap-name');
      const cap = label ? byName.get(normName(label.textContent)) : null;
      if (!cap) return;
      const owner = state.houses.find(h => h.id === cap.ownerHouseId);
      el.dataset.capital = cap.id;
      el.classList.toggle('is-mine', Boolean(state.myHouse && cap.ownerHouseId === state.myHouse.id));
      el.style.setProperty('--cap-color', owner?.color || '#7d2a14');
      el.classList.toggle('is-contested', Boolean(cap.contested));
      const idle = !owner || !(owner.players || []).some(p => !p.left);
      el.classList.toggle('is-idle', idle);
      if (idle) el.style.setProperty('--cap-color', '#8d8d8d');
      el.style.display = idle && !cap.vacant ? 'none' : ''; // houses nobody chose are not on the map
      const pos = !idle && owner ? HOUSE_SPRITE_POSITION[owner.id] : null;
      const pop = el.querySelector('.cap-pop');
      let flag = el.querySelector('.cap-banner');
      if (pos && pop) {
        const col = Math.round(parseFloat(pos[0]) / 33.333), row = pos[1] === '100%' ? 1 : 0;
        if (!flag) {
          const NS = 'http://www.w3.org/2000/svg';
          flag = document.createElementNS(NS, 'g');
          flag.setAttribute('class', 'cap-banner'); flag.setAttribute('transform', 'translate(-24 -78) scale(0.1463)');
          const clip = document.createElementNS(NS, 'g'); clip.setAttribute('clip-path', 'url(#bannerClip)');
          const img = document.createElementNS(NS, 'image');
          img.setAttribute('href', './assets/house-banners.png'); img.setAttribute('width', '1312'); img.setAttribute('height', '760');
          clip.appendChild(img); flag.appendChild(clip); pop.insertBefore(flag, pop.firstChild);
        }
        const flagImg = flag.querySelector('image');
        flagImg.setAttribute('x', String(-col * 328)); flagImg.setAttribute('y', String(-row * 380));
      } else if (flag) flag.remove();
      if (pop) {
        const fillCol = idle ? '#8d8d8d' : (owner?.color || '#7d2a14');
        if (pop.dataset.pieceColor !== fillCol) {
          pop.dataset.pieceColor = fillCol;
          pop.querySelectorAll('.cap-piece').forEach(x => x.remove());
          const holder = document.createElementNS(SVG_NS, 'g'); holder.setAttribute('class', 'cap-piece'); holder.setAttribute('pointer-events', 'none');
          holder.appendChild(chessPiece($('mapDialog').querySelector('.realm-map'), 'castle', 0, 24, 56, fillCol));
          pop.insertBefore(holder, pop.querySelector('.cap-dot'));
        }
      }
      const sub = el.querySelector('.cap-sub');
      if (sub) sub.textContent = cap.vacant ? 'Empty throne' : cap.contested ? 'Contested' : owner ? `House ${capName(owner.name)}` : '';
      el.classList.toggle('is-target', pickingTarget && state.myHouse && !warTargetProblem(cap));
    });
    renderMapUnits();
  }
  // Your own location, your troops at home, and any army you have on the march (other houses' armies stay secret).
  function renderMapUnits() {
    const svg = $('mapDialog').querySelector('.realm-map');
    if (!svg) return;
    const NS = 'http://www.w3.org/2000/svg';
    let layer = svg.querySelector('#mapUnits');
    if (!layer) { layer = document.createElementNS(NS, 'g'); layer.id = 'mapUnits'; layer.setAttribute('pointer-events', 'none'); svg.appendChild(layer); }
    layer.innerHTML = '';
    const h = state?.myHouse;
    if (!h || !['ACTION', 'COURT', 'RESOLUTION'].includes(state.phase)) return;
    const pos = new Map();
    $('mapDialog').querySelectorAll('.map-cap').forEach(el => {
      const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(el.getAttribute('transform') || '');
      if (m && el.dataset.capital) pos.set(el.dataset.capital, { x: Number(m[1]), y: Number(m[2]) });
    });
    const img = (href, x, y, w) => { const i = document.createElementNS(NS, 'image'); i.setAttribute('href', href); i.setAttribute('x', x); i.setAttribute('y', y); i.setAttribute('width', w); i.setAttribute('height', w); return i; };
    const tag = (x, y, text, color) => { const t = document.createElementNS(NS, 'text'); t.setAttribute('x', x); t.setAttribute('y', y); t.setAttribute('font-size', '32'); t.setAttribute('font-weight', '700'); t.setAttribute('fill', color || '#f3e6c2'); t.setAttribute('stroke', '#1b1208'); t.setAttribute('stroke-width', '6'); t.setAttribute('paint-order', 'stroke'); t.setAttribute('font-family', 'Georgia, serif'); t.textContent = text; return t; };
    for (const c of state.capitals) { const p = pos.get(c.id); if (!c.siege || !p) continue; layer.appendChild(img('./assets/game-swords.png?v=3', p.x + 26, p.y - 74, 52)); layer.appendChild(tag(p.x + 52, p.y - 78, 'SIEGE', '#e8a79c')); }
    const home = pos.get(h.cityId);
    const color = (state.houses.find(x => x.id === h.id) || {}).color || '#c8a45c';
    // A badge: the piece with its unit count in a dark pill.
    const badge = (cx, cy, r, count, label, kind = 'infantry') => {
      const g = document.createElementNS(NS, 'g');
      g.appendChild(chessPiece(svg, kind, cx, cy + r, r * 2, color));
      const w = 30 + String(count).length * 26, ph = 48;
      const pill = document.createElementNS(NS, 'rect'); pill.setAttribute('x', cx + r * 0.62); pill.setAttribute('y', cy + r * 0.5); pill.setAttribute('width', w); pill.setAttribute('height', ph); pill.setAttribute('rx', ph / 2); pill.setAttribute('fill', '#1b1208'); pill.setAttribute('stroke', '#f6edd2'); pill.setAttribute('stroke-width', '4');
      g.appendChild(pill);
      const t = document.createElementNS(NS, 'text'); t.setAttribute('x', cx + r * 0.62 + w / 2); t.setAttribute('y', cy + r * 0.5 + 35); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '36'); t.setAttribute('font-weight', '700'); t.setAttribute('fill', '#f3e6c2'); t.setAttribute('font-family', 'Georgia, serif'); t.textContent = String(count);
      g.appendChild(t);
      const title = document.createElementNS(NS, 'title'); title.textContent = label; g.appendChild(title);
      return g;
    };
    // Ship routes: open water only, kept off the shore, from the sailing grid (sea-routes.js). Walk to the harbour, sail, land on the beach nearest the target.
    const capAt = (x, y) => state.capitals.find(c => c.x === x && c.y === y);
    const seaPath = (fromCap, toCap) => {
      const sea = window.SEA_ROUTES?.[`${fromCap?.id}>${toCap?.id}`];
      return sea && fromCap && toCap ? { sea, all: [[fromCap.x, fromCap.y], ...sea, [toCap.x, toCap.y]] } : null;
    };
    const smoothD = pts => {
      if (pts.length < 3) return 'M' + pts.map(q => q.join(' ')).join('L');
      let d = `M${pts[0][0]} ${pts[0][1]}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        d += `C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
      }
      return d;
    };
    const pathEl = (d, stroke, w, dash, opacity) => {
      const el = document.createElementNS(NS, 'path'); el.setAttribute('d', d); el.setAttribute('fill', 'none'); el.setAttribute('stroke', stroke); el.setAttribute('stroke-width', w); el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
      if (dash) el.setAttribute('stroke-dasharray', dash); if (opacity) el.setAttribute('opacity', opacity);
      return el;
    };
    const drawSeaRoute = (route, planned, returning) => {
      const g = document.createElementNS(NS, 'g');
      const d = smoothD(route.sea);
      g.appendChild(pathEl(d, '#f6edd2', planned ? 8 : 10, '', planned ? '.35' : '.45'));
      g.appendChild(pathEl(d, planned ? '#1b1208' : color, planned ? 3 : 4, planned ? '3 14' : returning ? '4 12' : '10 8', planned ? '.55' : '.8'));
      const first = route.all[0], hs = route.sea[0], last = route.all[route.all.length - 1], hb = route.sea[route.sea.length - 1];
      for (const [x1, y1, x2, y2] of [[first[0], first[1], hs[0], hs[1]], [hb[0], hb[1], last[0], last[1]]]) {
        const walk = document.createElementNS(NS, 'line'); walk.setAttribute('x1', x1); walk.setAttribute('y1', y1); walk.setAttribute('x2', x2); walk.setAttribute('y2', y2); walk.setAttribute('stroke', '#1b1208'); walk.setAttribute('stroke-width', '3'); walk.setAttribute('stroke-dasharray', '6 9'); walk.setAttribute('opacity', '.5'); walk.setAttribute('stroke-linecap', 'round');
        g.appendChild(walk);
      }
      const beach = document.createElementNS(NS, 'circle'); beach.setAttribute('cx', hb[0]); beach.setAttribute('cy', hb[1]); beach.setAttribute('r', '9'); beach.setAttribute('fill', '#f6edd2'); beach.setAttribute('stroke', color); beach.setAttribute('stroke-width', '4'); beach.setAttribute('opacity', '.9');
      const bt = document.createElementNS(NS, 'title'); bt.textContent = 'Landing beach'; beach.appendChild(bt); g.appendChild(beach);
      layer.appendChild(g);
    };
    const alongPath = (pts, t) => {
      const seg = []; let len = 0;
      for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); len += l; }
      let want = len * t;
      for (let i = 0; i < seg.length; i++) { if (want <= seg[i] || i === seg.length - 1) { const f = seg[i] ? Math.min(1, want / seg[i]) : 0; return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f }; } want -= seg[i]; }
      return { x: pts[0][0], y: pts[0][1] };
    };
    const homeCap = state.capitals.find(c => c.id === h.cityId);
    const planTarget = attackMode === 'navy' && warTargetId ? state.capitals.find(c => c.id === warTargetId) : null;
    if (planTarget && homeCap) { const r = seaPath(homeCap, planTarget); if (r) drawSeaRoute(r, true, false); }
    if (home) {
      const ring = document.createElementNS(NS, 'circle'); ring.setAttribute('cx', home.x); ring.setAttribute('cy', home.y); ring.setAttribute('r', '44'); ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', color); ring.setAttribute('stroke-width', '8'); ring.setAttribute('stroke-dasharray', '14 10');
      const rt = document.createElementNS(NS, 'title'); rt.textContent = 'You live here'; ring.appendChild(rt);
      layer.appendChild(ring);
      // Troops at home: a small count chip per type beside the city piece (tap one to send that kind to war).
      const kinds = [['infantry', h.infantry], ['navy', h.navy], ['dragons', h.dragons]].filter(([, n]) => n > 0);
      kinds.forEach(([k, n], i) => {
        const w = 52 + String(n).length * 18, ph = 38, x = home.x - 44 - w, y = home.y - 18 + i * (ph + 6);
        const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'army-piece'); g.dataset.homeKind = k; g.setAttribute('pointer-events', 'all'); g.style.cursor = 'pointer';
        const pill = pieceRect(x, y, w, ph, ph / 2, '#1b1208', '#f6edd2', 3);
        const ic = img('./assets/' + ICON_FILE[k], x + 4, y + 3, 32); ic.setAttribute('filter', `url(#${tintFilter(svg, color, 40)})`);
        const t = document.createElementNS(NS, 'text'); t.setAttribute('x', x + 40 + (w - 44) / 2); t.setAttribute('y', y + 28); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '26'); t.setAttribute('font-weight', '700'); t.setAttribute('fill', '#f3e6c2'); t.setAttribute('font-family', 'Georgia, serif'); t.textContent = String(n);
        const ti = document.createElementNS(NS, 'title'); ti.textContent = `Your ${KIND_NAME[k]} at home: ${n}. Tap to send them to war.`;
        g.append(pill, ic, t, ti); layer.appendChild(g);
      });
    }
    const marchShapes = [];
    for (const o of (h.marches || [])) {
      const from = { x: o.fromX, y: o.fromY }, to = { x: o.toX, y: o.toY };
      if (!Number.isFinite(from.x) || !Number.isFinite(to.x)) continue;
      const step = (state.round - o.orderedRound) * 2 + ['ACTION', 'COURT', 'RESOLUTION'].indexOf(state.phase);
      const total = Math.max(2, (o.resolveRound - o.orderedRound) * 2);
      const t = Math.min(0.85, 0.15 + 0.7 * Math.min(1, step / total));
      const kind = o.units.navy > 0 ? 'navy' : o.units.dragons > 0 ? 'dragons' : 'infantry';
      const n = o.units[kind];
      const label = o.returning ? `Your ${KIND_NAME[kind]} marching home` : `Your ${KIND_NAME[kind]} marching on ${o.targetName}`;
      const route = kind === 'navy' ? seaPath(capAt(from.x, from.y), capAt(to.x, to.y)) : null;
      if (route) {
        drawSeaRoute(route, false, o.returning);
        const at = alongPath(route.all, t);
        marchShapes.push({ x: at.x, y: at.y, n, label, kind, id: o.id });
        continue;
      }
      for (const [w, stroke] of [[8, '#f6edd2'], [4, color]]) {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', from.x); line.setAttribute('y1', from.y); line.setAttribute('x2', to.x); line.setAttribute('y2', to.y);
        line.setAttribute('stroke', stroke); line.setAttribute('stroke-width', w); line.setAttribute('stroke-dasharray', o.returning ? '4 12' : '10 8'); line.setAttribute('stroke-linecap', 'round'); line.setAttribute('opacity', stroke === color ? '.8' : '.4');
        layer.appendChild(line);
      }
      marchShapes.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, n, label, kind, id: o.id });
    }
    for (const m of marchShapes) { const b = badge(m.x, m.y, 50, m.n, m.label + (m.id ? '. Tap to change.' : ''), m.kind); b.setAttribute('class', 'army-piece'); b.dataset.marchId = m.id || ''; b.setAttribute('pointer-events', 'all'); b.style.cursor = 'pointer'; layer.appendChild(b); }
  }
  // Tap one of your armies on the map: home troops start a new order; an army that has not left yet is pulled back so you can change where and how many; one on the road can be called home.
  function armyClicked(data) {
    const h = state?.myHouse; if (!h) return;
    const sendKind = (kind, count, targetId) => {
      attackMode = kind; applyAttackMode();
      const field = { infantry: 'attackInfantry', navy: 'attackNavy', dragons: 'attackDragons' }[kind];
      setTimeout(() => {
        if (field && count) $(field).value = String(count);
        const t = targetId && state.capitals.find(c => c.id === targetId);
        warTargetId = t && !warTargetProblem(t) ? t.id : null;
        renderWarTarget(); startPick(); updateAttackLock(); renderMapUnits();
        showMapHint(`Choose where to send your ${KIND_NAME[kind]}, set how many, then declare war.`);
      }, 250);
    };
    if (data.homeKind) {
      const block = warBlockReason();
      if (block) return showMapHint(block);
      return sendKind(data.homeKind, 0, null);
    }
    const m = (h.marches || []).find(x => x.id === data.marchId);
    if (!m) return;
    if (m.returning) return showMapHint('That army is already marching home.');
    if (state.phase !== 'ACTION') return showMapHint('Orders can only be changed during the action phase.');
    const kind = m.units.navy > 0 ? 'navy' : m.units.dragons > 0 ? 'dragons' : 'infantry';
    if (m.orderedRound === state.round) {
      emitAction('cancel-march', { marchId: m.id }, () => sendKind(kind, m.units[kind], m.targetCapitalId));
    } else if (window.confirm(`That army is already on the road to ${m.targetName}. Call it back home?`)) {
      emitAction('cancel-march', { marchId: m.id });
    }
  }
  function showMapHint(text) {
    const hint = $('mapHint');
    hint.textContent = text || '';
    hint.hidden = !text;
  }
  function startPick() {
    pickingTarget = true;
    $('mapDialog').classList.add('pick-mode');
    showMapHint('War map: tap a highlighted city to march on it.');
    renderMap();
  }
  function endPick() {
    if (!pickingTarget && !$('mapDialog').classList.contains('pick-mode')) return;
    pickingTarget = false;
    $('mapDialog').classList.remove('pick-mode');
    showMapHint('');
    if (state) renderMap();
  }

  function renderRoundActions() {
    const house = state.myHouse;
    if (!house) return;
    $('infantryCostLabel').textContent = house.infantryCost;
    $('navyCostLabel').textContent = house.navyCost;
    const prevSpy = $('spyTarget').value;
    $('spyTarget').innerHTML = '<option value="">Choose a house</option>' + state.houses.filter(h => h.id !== house.id && (h.players || []).some(p => !p.left)).map(h => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}</option>`).join('');
    if ([...$('spyTarget').options].some(o => o.value === prevSpy)) $('spyTarget').value = prevSpy;
    // Dragon hunts are one more kind of spy mission, offered only in Last Dragon games.
    const missionSel = $('spyMission'), hasDragon = [...missionSel.options].some(o => o.value === 'dragon'), wantDragon = state.settings?.gameType === 'LAST_DRAGON';
    if (wantDragon && !hasDragon) { const o = document.createElement('option'); o.value = 'dragon'; o.textContent = 'Hunt a Dragon'; missionSel.appendChild(o); window.__wheels?.refresh(state); }
    else if (!wantDragon && hasDragon) { if (missionSel.value === 'dragon') missionSel.value = ''; [...missionSel.options].find(o => o.value === 'dragon').remove(); window.__wheels?.refresh(state); }
    const prevGift = $('giftTarget').value;
    $('giftTarget').innerHTML = '<option value="">Choose a player</option>' + state.players.filter(p => p.id !== state.me.id && !p.left && !p.eliminated && p.houseId).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.username)} · House ${escapeHtml(state.houses.find(x => x.id === p.houseId)?.name || '')}</option>`).join('');
    if ([...$('giftTarget').options].some(o => o.value === prevGift)) $('giftTarget').value = prevGift;
    updateGiftForm();
    $('attackInfantry').max = house.infantry;
    $('attackNavy').max = house.navy;
    $('attackDragons').max = house.dragons;
    $('attackDragons').disabled = house.dragons === 0;
    applyAttackMode();
    $('attackForm').hidden = false;
    const target = state.capitals.find(c => c.id === warTargetId);
    if (!target || warTargetProblem(target)) warTargetId = null;
    renderWarTarget();
    renderMarchList();
    updateAttackLock();
    if (pickingTarget && warBlockReason()) { endPick(); showMapHint(warBlockReason()); }
    updateRecruitButton();
    updateDisbandButton();
    updateSpyForm();
    $('spyReports').innerHTML = state.spyReports.length ? `<div class="subsection-title">Your intelligence reports</div>${state.spyReports.map(spyReportMarkup).join('')}` : '';
  }

  const SPY_PARAMS = { wealth: [0.30, 0.045, 0.60, 0.03], messages: [0.20, 0.04, 0.40, 0.02], war: [0.35, 0.045, 0.75, 0.03], dragon: [0.15, 0.04, 0.80, 0.03] };
  const SPY_LABEL = { wealth: 'Wealth', messages: 'Messages', war: 'War', dragon: 'Dragons' };
  function spyOddsFor(spend, targetId, mission) {
    const [sb, sp, db, dp] = SPY_PARAMS[mission] || SPY_PARAMS.war;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    return { success: clamp(sb + sp * (spend - 2) - (targetId === 'targaryen' ? 0.15 : 0), 0.05, 0.95), caught: clamp(db - dp * (spend - 2), 0.05, 0.9) };
  }
  function spyReportMarkup(r) {
    const mission = r.mission || 'war';
    const status = r.success ? 'successful' : r.caught ? 'caught' : 'failed';
    const head = `<div><b class="row-who">${bannerOf(r.targetHouseId)}${escapeHtml(capName(r.targetName))}</b><span>Round ${r.round} · ${escapeHtml(SPY_LABEL[mission])} · ${status}${r.spent ? ` · ${r.spent} gold` : ''}</span></div>`;
    if (!r.success) return `<article class="spy-report spy-failed">${head}<p>${r.caught ? 'Your agents were captured. The enemy knows who sent them.' : 'Your agents returned with nothing.'}</p></article>`;
    const f = r.findings || {};
    let body = '';
    if (mission === 'wealth') body = f.kind === 'total' ? `<p>Their treasury holds about ${f.gold} gold.</p>` : `<p>Recently they earned ${f.earned} gold and spent ${f.spent}.</p>`;
    else if (mission === 'messages') {
      if (f.kind === 'raven') body = `<p>Raven intercepted. <b>${escapeHtml(f.letter.from)}</b> to ${escapeHtml(f.letter.to)}: “${escapeHtml(f.letter.text)}”</p>`;
      else if (f.kind === 'alliance') body = `<p>Secret alliance with ${f.houses.map(id => `House ${escapeHtml(capName(prettyHouse(id)))}`).join(', ')}.</p>`;
      else body = '<p>No ravens flew and no secrets surfaced.</p>';
    } else if (mission === 'dragon') body = f.hasDragon ? '<p>A Dragon hides in this house.</p>' : '<p>No Dragon hides in this house.</p>';
    else if (f.kind === 'movement') body = `<p>Their army is marching on ${escapeHtml(f.movingOn || 'an unknown city')}: about ${f.infantry} infantry, ${f.navy} ships${f.dragons ? `, ${f.dragons} dragon${f.dragons === 1 ? '' : 's'}` : ''}. Counts may be off by 1 or 2.</p>`;
    else body = `<p>About ${f.infantry} infantry · ${f.navy} ships · ${f.dragons} dragons. Counts may be off by 1 or 2.${f.marching ? '' : ' No army on the march.'}</p>`;
    return `<article class="spy-report">${head}${body}</article>`;
  }
  function updateSpyForm() {
    const house = state?.myHouse;
    if (!house) return;
    const raw = $('spyGold').value.trim();
    const spend = Number(raw);
    const valid = raw !== '' && Number.isInteger(spend) && spend >= 2 && spend <= 20;
    const mission = $('spyMission').value;
    const ready = valid && $('spyTarget').value && mission;
    if (ready) {
      const o = spyOddsFor(spend, $('spyTarget').value, $('spyMission').value);
      const diff = o.success >= 0.5 ? 'Easy' : o.success >= 0.3 ? 'Medium' : 'Hard';
      const danger = o.caught >= 0.6 ? 'High' : o.caught >= 0.35 ? 'Medium' : 'Low';
      $('spyOdds').innerHTML = `<span>Difficulty <b class="lvl-${diff === 'Easy' ? 'good' : diff === 'Medium' ? 'mid' : 'bad'}">${diff}</b> · ${Math.round(o.success * 100)}%</span><span>Danger <b class="lvl-${danger === 'Low' ? 'good' : danger === 'Medium' ? 'mid' : 'bad'}">${danger}</b> · ${Math.round(o.caught * 100)}%</span>`;
    } else $('spyOdds').innerHTML = '';
    lock($('spyForm').querySelector('button[type="submit"]'), state.phase !== 'ACTION' ? 'Spies can only be sent during the action phase.' : (mission === 'dragon' ? state.me.lastDragonSpyRound : state.me.lastSpyRound) === state.round ? (mission === 'dragon' ? 'You have already hunted for dragons this round.' : 'You have already sent spies this round.') : !$('spyTarget').value ? 'Choose a target house.' : !$('spyMission').value ? 'Choose a mission.' : !valid ? 'Spend a whole number of gold between 2 and 20.' : house.money < spend ? `You chose to spend ${spend} gold, but your house only has ${house.money}.` : '');
  }
  const giftNum = id => { const raw = $(id).value.trim(); return raw === '' ? 0 : Number(raw); };
  function updateGiftForm() {
    const h = state?.myHouse; if (!h) return;
    const g = giftNum('giftGold'), inf = giftNum('giftInfantry'), nav = giftNum('giftNavy'), note = $('giftMessage').value.trim();
    const bad = [g, inf, nav].some(n => !Number.isInteger(n) || n < 0);
    lock($('giftForm').querySelector('button[type="submit"]'), state.phase !== 'ACTION' ? 'Gifts can be sent during the action phase.' : !$('giftTarget').value ? 'Choose who receives the gift.' : bad ? 'Gold, infantry and ships must be whole numbers, zero or more.' : g + inf + nav + (note ? 1 : 0) < 1 ? 'Add gold, troops, ships or a note.' : g > h.money ? `You only have ${h.money} gold.` : inf > h.infantry ? `You only have ${h.infantry} infantry.` : nav > h.navy ? `You only have ${h.navy} ships.` : '');
  }
  ['giftGold', 'giftInfantry', 'giftNavy', 'giftMessage'].forEach(id => $(id).addEventListener('input', updateGiftForm));
  $('giftTarget').addEventListener('change', updateGiftForm);
  $('giftForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('send-gift', { toPlayerId: $('giftTarget').value, gold: giftNum('giftGold'), infantry: giftNum('giftInfantry'), navy: giftNum('giftNavy'), message: $('giftMessage').value }, () => { ['giftGold', 'giftInfantry', 'giftNavy', 'giftMessage'].forEach(id => { $(id).value = ''; }); updateGiftForm(); });
  });
  $('spyGold').addEventListener('input', updateSpyForm);
  $('spyMission').addEventListener('change', updateSpyForm);
  $('spyTarget').addEventListener('change', updateSpyForm);

  function updateDisbandButton() {
    const house = state?.myHouse;
    if (!house) return;
    const unit = $('disbandUnit').value, amount = Number($('disbandAmount').value);
    lock($('disbandForm').querySelector('button[type="submit"]'), state.phase !== 'ACTION' ? 'Units can be disbanded during the action phase.' : !Number.isInteger(amount) || amount < 1 ? 'Choose how many units to disband.' : amount > house[unit] ? `You only have ${house[unit]} ${unit === 'navy' ? 'ships' : unit}.` : '');
  }
  function updateRecruitButton() {
    const button = $('recruitForm')?.querySelector('button[type="submit"]');
    if (!button) return;
    const house = state?.myHouse;
    if (!house) return lock(button, 'Choose a house first.');
    const unit = $('unitSelect').value;
    const amount = Number($('unitAmount').value);
    const cost = unit === 'navy' ? house.navyCost : house.infantryCost;
    lock(button, state.phase !== 'ACTION' ? 'Recruiting is only possible during the action phase.'
      : house.lockedByEmbargo ? 'A royal embargo blocks your recruitment this round.'
      : !Number.isInteger(amount) || amount < 1 ? 'Choose a whole number of units, at least 1.'
      : cost * amount > house.money ? `That costs ${cost * amount} gold, but your house only has ${house.money}.` : '');
  }

  function renderRoundOverview() {
    const house = state.myHouse;
    $('roundGold').textContent = house ? house.money : '—';
    const total = house ? house.infantry + house.navy + house.dragons : null;
    $('roundMilitaryTotal').textContent = total === null ? '—' : total;
    const ldLive = state.settings?.gameType === 'LAST_DRAGON' && ['HAND_SELECTION', 'ACTION', 'COURT', 'RESOLUTION'].includes(state.phase) && !state.gameOver;
    $('headerRounds').hidden = !ldLive; $('headerDragons').hidden = !ldLive;
    if (ldLive) {
      const left = Math.max(0, (state.settings.dragonRounds || 5) - state.round + 1);
      $('roundsLeft').textContent = left;
      $('headerRounds').title = `${plural(left, 'round')} left until the Targaryens win`;
      $('dragonsLeft').textContent = state.dragonsLeft ?? '—';
      $('headerDragons').title = `${plural(state.dragonsLeft ?? 0, 'Targaryen')} remaining`;
    }
    $('headerArmy').title = house ? `${house.infantry} infantry · ${house.navy} navy · ${house.dragons} dragons` : 'Forces unavailable';
    // King / Hand icons only appear for the player who holds that role.
    const myDef = state.houses.find(item => item.id === state.me?.houseId);
    const banner = $('headerBanner');
    if (banner.dataset.house !== (myDef?.id || '')) {
      banner.dataset.house = myDef?.id || '';
      banner.innerHTML = myDef ? houseBanner(myDef, 'hs-banner-art') : '';
    }
    banner.hidden = !myDef;
    $('roundKingBadge').hidden = !state.isKing;
    $('roundHandBadge').hidden = !state.isHand;
  }

  const HOST_STEPS = { ACTION: ['OPEN COURT', 'Open the court'], COURT: ['NEXT ROUND', 'End the court, collect income and begin the next round'] };
  // The header pill shows the round for everyone; for the host it doubles as the "advance" button.
  function updateRoundPill() {
    const pill = $('roundPill');
    if (!pill || !state) return;
    if (state.gameOver) {
      pill.textContent = state.isHost ? 'NEW GAME →' : 'GAME OVER';
      pill.title = state.isHost ? 'Everyone is revived and chooses a house again' : '';
      if (state.isHost) { pill.dataset.action = 'reset-game'; pill.disabled = false; pill.classList.add('round-pill-action'); }
      else { delete pill.dataset.action; pill.disabled = true; pill.classList.remove('round-pill-action'); }
      return;
    }
    const step = state.isHost ? HOST_STEPS[state.phase] : null;
    const rd = state.ready || { mode: 'off', ready: 0, total: 0 };
    const canReady = !state.isHost && rd.mode !== 'off' && ['ACTION', 'COURT', 'RESOLUTION'].includes(state.phase) && state.myHouse && !state.me?.eliminated;
    if (canReady) {
      const phone = document.body.classList.contains('mobile-device') && document.documentElement.classList.contains('style-med');
      pill.textContent = rd.me ? 'READY ✓' : phone ? 'READY' : `ROUND ${state.round} · READY`;
      pill.dataset.action = 'toggle-ready';
      pill.title = rd.me ? 'Tap to cancel' : 'Tell the host you are done';
      pill.disabled = false;
      pill.classList.add('round-pill-action');
      pill.classList.toggle('is-ready', Boolean(rd.me));
      return;
    }
    pill.classList.remove('is-ready');
    if (step) {
      const count = rd.mode !== 'off' && rd.total ? ` (${rd.ready}/${rd.total})` : '';
      const phone = document.body.classList.contains('mobile-device') && document.documentElement.classList.contains('style-med');
      pill.textContent = phone ? `${state.phase === 'ACTION' ? 'COURT' : 'NEXT'}${rd.mode !== 'off' && rd.total ? ` ${rd.ready}/${rd.total}` : ''} →` : `ROUND ${state.round} · ${step[0]}${count} →`;
      pill.dataset.action = 'advance-phase';
      pill.title = rd.mode === 'wait' && rd.ready < rd.total ? 'Waiting for everyone to be ready' : step[1];
      pill.disabled = false;
      pill.classList.add('round-pill-action');
    } else {
      pill.textContent = phaseLabel(state.phase);
      delete pill.dataset.action;
      pill.removeAttribute('title');
      pill.disabled = true;
      pill.classList.remove('round-pill-action');
    }
  }

  const goodsMarkup = t => {
    const parts = [];
    if (t.gold) parts.push(`${t.gold} gold`);
    if (t.infantry) parts.push(`${t.infantry} infantry`);
    if (t.navy) parts.push(`${t.navy} ships`);
    return parts.length ? `<div class="treaty-goods">${parts.map(x => `<span>${escapeHtml(x)}</span>`).join('')}</div>` : '';
  };
  const houseColor = id => state.houses.find(h => h.id === id)?.color || '#c8a86c';
  const TREATY_STATUS = { accepted: 'Accepted', declined: 'Declined', cancelled: 'Withdrawn' };

  const DECREE_STATE = { sent: 'Paid', pending: 'Unpaid', noted: 'Delivered' };
  const bannerOf = id => houseBanner(state.houses.find(h => h.id === id), 'msg-banner');
  function decreeCard(d, popup = false) {
    const h = state.myHouse;
    const can = h && h.money >= d.gold && h.infantry >= d.infantry && h.navy >= d.navy;
    const reason = can ? '' : `You cannot meet this demand yet: you have ${h?.money ?? 0} gold, ${h?.infantry ?? 0} infantry and ${h?.navy ?? 0} ships.`;
    const demand = goodsMarkup(d);
    const buttons = d.myState === 'pending' ? `<div class="treaty-actions"><button class="button button-primary button-small ${can ? '' : 'is-locked'}" data-action="respond-decree" data-decree-id="${escapeHtml(d.id)}"${lockAttr(reason)}>Send</button>${popup ? '<button class="button button-quiet button-small" data-action="close-decree-popup">Close</button>' : ''}</div>` : '';
    return `<article class="treaty-card decree-card" style="--house-color:${escapeHtml(houseColor(d.kingHouseId))}"><header>${bannerOf(d.kingHouseId)}<span class="royal-seal royal-seal-sm"><img src="./assets/game-throne.png?v=3" alt=""></span><strong>Decree of King ${escapeHtml(d.kingName)}<small> · House ${escapeHtml(capName(prettyHouse(d.kingHouseId)))}</small></strong><span class="treaty-status is-${escapeHtml(d.myState === 'sent' ? 'accepted' : d.myState === 'pending' ? 'declined' : 'pending')}">${escapeHtml(DECREE_STATE[d.myState] || '')}</span></header>${d.message ? `<p class="treaty-note">“${escapeHtml(d.message)}”</p>` : ''}${demand ? `<div><small>The crown demands:</small>${demand}</div>` : ''}<small>Round ${d.round}${d.myState === 'pending' ? '' : ''}</small>${buttons}</article>`;
  }
  // A sealed decree pops up once when it arrives. Backdrop tap = ignore it for now; Send / Close answer it.
  const shownDecrees = new Set();
  let decreesPrimed = false;
  function checkDecreePopup() {
    if (!state?.myHouse) return;
    const pending = (state.decrees || []).filter(d => !d.isIssuer && d.myState === 'pending');
    if (!decreesPrimed) { pending.forEach(d => shownDecrees.add(d.id)); decreesPrimed = true; return; }
    if (!$('decreeOverlay').hidden) {
      const stillOpen = pending.find(d => d.id === $('decreePop').dataset.decree);
      if (!stillOpen) $('decreeOverlay').hidden = true;
      return;
    }
    const next = pending.find(d => !shownDecrees.has(d.id));
    if (!next || !$('announceOverlay').hidden) return;
    shownDecrees.add(next.id);
    $('decreePop').dataset.decree = next.id;
    $('decreePop').innerHTML = `<p class="eyebrow" id="decreePopTitle">A ROYAL DECREE</p>${decreeCard(next, true)}`;
    $('decreeOverlay').hidden = false;
  }

  function renderAlliances() {
    const mine = state.myHouse;
    const myId = mine?.id;
    const open = diploOpen();
    const allied = new Set(alliesOf(myId));
    const offers = state.allianceOffers || [];
    const alliances = state.alliances || [];
    const withPlayers = state.houses.filter(h => h.id !== myId && h.players.length > 0);
    const proposable = withPlayers.filter(h => !allied.has(h.id) && !offers.some(o => (o.fromHouseId === myId && o.toHouseId === h.id) || (o.fromHouseId === h.id && o.toHouseId === myId)));
    $('allianceTarget').innerHTML = proposable.map(h => `<option value="${escapeHtml(h.id)}">House ${escapeHtml(capName(h.name))}</option>`).join('');
    $('treatyTarget').innerHTML = withPlayers.map(h => `<option value="${escapeHtml(h.id)}">House ${escapeHtml(capName(h.name))}${allied.has(h.id) ? ' · ally' : ''}</option>`).join('');
    const handHouseId = state.hand ? state.players.find(p => p.id === state.hand.id)?.houseId : null;
    $('decreeTarget').innerHTML = '<option value="">All houses</option>' + withPlayers.filter(h => h.id !== handHouseId).map(h => `<option value="${escapeHtml(h.id)}">House ${escapeHtml(capName(h.name))}</option>`).join('');
    const closedMsg = 'Diplomacy is open during the action and court phases.';
    lock($('allianceForm').querySelector('button[type="submit"]'), !mine ? 'Choose a house first.' : !open ? closedMsg : !withPlayers.length ? 'No other house has a player yet.' : !proposable.length ? 'Every house with a player is already your ally or has a pending offer.' : '');
    lock($('treatyForm').querySelector('button[type="submit"]'), !mine ? 'Choose a house first.' : !open ? closedMsg : !withPlayers.length ? 'No other house has a player yet.' : '');
    // Decrees exist only for the king.
    $('decreeForm').hidden = !state.isKing;
    lock($('decreeForm').querySelector('button[type="submit"]'), !state.isKing ? '' : !open ? closedMsg : mine?.commandUsedRound === state.round ? 'You have already issued a decree this round.' : '');
    const incoming = (state.decrees || []).filter(d => !d.isIssuer && d.myState);
    $('kingBadge').textContent = state.king ? `King: ${state.king.username}` : 'No king';

    let markup = '';
    markup += offers.map(o => `<div class="alliance-row offer-row"><div class="row-who">${bannerOf(o.isOutgoing ? o.toHouseId : o.fromHouseId)}<div><strong>${o.isOutgoing ? `Offer to House ${escapeHtml(capName(prettyHouse(o.toHouseId)))}` : `Offer from House ${escapeHtml(capName(prettyHouse(o.fromHouseId)))}`}</strong><small>${o.scope === 'secret' ? 'Secret offer' : 'Public offer'} · Round ${o.round}</small></div></div><div class="alliance-row-actions">${o.canRespond ? `<button class="button button-primary button-small ${open ? '' : 'is-locked'}" data-action="respond-alliance" data-offer-id="${escapeHtml(o.id)}" data-accept="true"${lockAttr(open ? '' : closedMsg)}>Accept</button><button class="button button-quiet button-small ${open ? '' : 'is-locked'}" data-action="respond-alliance" data-offer-id="${escapeHtml(o.id)}" data-accept="false"${lockAttr(open ? '' : closedMsg)}>Decline</button>` : '<span class="subtle-label">Awaiting reply</span>'}</div></div>`).join('');
    markup += alliances.map(a => `<div class="alliance-row"><div class="row-who">${bannerOf(a.houseA)}${bannerOf(a.houseB)}<div><strong>${escapeHtml(capName(prettyHouse(a.houseA)))} <span class="alliance-link">↔</span> ${escapeHtml(capName(prettyHouse(a.houseB)))}</strong><small>${a.scope === 'secret' ? 'Secret alliance' : 'Public alliance'} · since Round ${a.createdRound}</small></div></div>${mine && (a.houseA === myId || a.houseB === myId) ? `<button class="button button-quiet button-small ${open ? '' : 'is-locked'}" data-action="break-alliance" data-alliance-id="${escapeHtml(a.id)}"${lockAttr(open ? '' : closedMsg)}><img class="button-icon" src="./assets/game-chain.png?v=3" alt="">Break</button>` : ''}</div>`).join('');
    $('allianceList').innerHTML = markup || '<p class="muted small-text">No alliances or alliance offers yet.</p>';

    const treaties = [...(state.treaties || [])].sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)).slice(0, 14);
    const treatyItems = treaties.map(t => {
      const otherId = t.isOutgoing ? t.toHouseId : t.fromHouseId;
      const pending = t.status === 'pending';
      const label = pending ? (t.isOutgoing ? 'Awaiting reply' : 'Awaiting your answer') : TREATY_STATUS[t.status] || t.status;
      const actions = pending ? (t.isOutgoing
        ? `<button class="button button-quiet button-small" data-action="cancel-treaty" data-treaty-id="${escapeHtml(t.id)}">Withdraw</button>`
        : `<button class="button button-primary button-small ${open ? '' : 'is-locked'}" data-action="respond-treaty" data-treaty-id="${escapeHtml(t.id)}" data-accept="true"${lockAttr(open ? '' : closedMsg)}>Accept</button><button class="button button-quiet button-small ${open ? '' : 'is-locked'}" data-action="respond-treaty" data-treaty-id="${escapeHtml(t.id)}" data-accept="false"${lockAttr(open ? '' : closedMsg)}>Decline</button>`) : '';
      return `<article class="treaty-card" style="--house-color:${escapeHtml(houseColor(otherId))}"><header>${bannerOf(otherId)}<strong>${t.isOutgoing ? 'To' : 'From'} House ${escapeHtml(capName(prettyHouse(otherId)))}${allied.has(otherId) ? ' · ally' : ''}</strong><span class="treaty-status is-${escapeHtml(t.status)}">${escapeHtml(label)}</span></header>${goodsMarkup(t)}${t.message ? `<p class="treaty-note">“${escapeHtml(t.message)}”</p>` : ''}<small>Round ${t.round}</small>${actions ? `<div class="treaty-actions">${actions}</div>` : ''}</article>`;
    });
    const decreeItems = incoming.map(d => ({ pend: d.myState === 'pending', html: decreeCard(d) }));
    const treatyMapped = treaties.map((t, i) => ({ pend: t.status === 'pending', html: treatyItems[i] }));
    const merged = [...decreeItems, ...treatyMapped].sort((x, y) => Number(y.pend) - Number(x.pend));
    $('treatyList').innerHTML = merged.map(x => x.html).join('') || '<p class="muted small-text">No treaties or subsidies yet. Send one to an ally or any other house.</p>';

    // War councils: invitations from allies, your own marching orders, and the spoils of won wars.
    let war = '';
    for (const pa of (mine?.marches || [])) {
      war += `<article class="treaty-card war-card"><header><strong>${pa.returning ? 'Your army returning home' : `Your war on ${escapeHtml(pa.targetName)}`}</strong><span class="treaty-status">${pa.returning ? 'Home' : 'Resolves'} after Round ${pa.resolveRound}</span></header></article>`;
    }
    war += (state.spoils || []).map(sp => {
      const other = sp.houseA === myId ? sp.houseB : sp.houseA;
      const nm = id => capName(prettyHouse(id));
      if (sp.status !== 'open') return `<article class="treaty-card war-card"><header><strong>${escapeHtml(sp.capitalName)}</strong><span class="treaty-status is-accepted">Settled</span></header><p class="treaty-note">Now ruled by House ${escapeHtml(nm(sp.winnerId))}.</p></article>`;
      const myClaim = sp.claims[myId], theirClaim = sp.claims[other];
      const claimBtn = id => `<button class="button button-secondary button-small ${myClaim === id ? 'is-mine' : ''}" data-action="claim-spoils" data-spoil-id="${escapeHtml(sp.id)}" data-claim="${escapeHtml(id)}">${myClaim === id ? 'Chosen · ' : ''}House ${escapeHtml(nm(id))} rules</button>`;
      return `<article class="treaty-card war-card" style="--house-color:${escapeHtml(houseColor(other))}"><header>${bannerOf(sp.houseA)}${bannerOf(sp.houseB)}<strong>Spoils: ${escapeHtml(sp.capitalName)}</strong><span class="treaty-status">Decide by the end of Round ${sp.deadlineRound} court</span></header><p class="treaty-note">You and House ${escapeHtml(nm(other))} won it together and split ${sp.plunder} gold of plunder. You must both name the same ruler, or you will fight each other for it.</p><small>Your choice: ${myClaim ? `House ${escapeHtml(nm(myClaim))}` : 'not chosen'} · Their choice: ${theirClaim ? `House ${escapeHtml(nm(theirClaim))}` : 'not chosen'}</small><div class="spoil-claims">${claimBtn(sp.houseA)}${claimBtn(sp.houseB)}</div></article>`;
    }).join('');
    $('warList').innerHTML = war || '<p class="muted small-text">No wars yet.</p>';
  }

  const selectedRecipients = new Set();
  const chatOthers = () => (state?.players || []).filter(p => !p.left && p.id !== state.me?.id).sort((x, y) => houseIndex(x.houseId) - houseIndex(y.houseId));

  function messageMarkup(messages, isPrivate = false) {
    const myId = state.me?.id;
    return messages.map(m => {
      const house = state.houses.find(h => h.id === m.senderHouseId);
      const mine = m.senderId === myId;
      const to = isPrivate
        ? (m.targets || []).map(t => { const th = state.houses.find(h => h.id === t.houseId); return `<span class="msg-chip" style="--house-color:${escapeHtml(th?.color || '#c8a86c')}">${houseBanner(th, 'msg-banner msg-banner-sm')}${escapeHtml(t.id === myId ? 'You' : t.name)}</span>`; }).join('')
        : '<span class="msg-chip msg-chip-all">The whole court</span>';
      return `<article class="chat-message ${isPrivate ? 'chat-secret-message' : ''} ${mine ? 'chat-mine' : ''}" style="--house-color:${escapeHtml(house?.color || '#c8a86c')}"><div class="msg-head">${houseBanner(house, 'msg-banner')}<div class="msg-meta"><strong>${escapeHtml(mine ? 'You' : m.senderName)}</strong><span>House ${escapeHtml(m.senderHouseName || house?.name || '')} · R${m.round}</span></div></div><div class="msg-to"><em>to</em>${to}</div><p>${escapeHtml(m.message)}</p></article>`;
    }).join('') || '<p class="muted small-text chat-empty">No messages yet. Start the conversation.</p>';
  }

  function renderChat() {
    const logs = [$('publicChat'), $('secretChat')].map(el => [el, el.scrollHeight - el.scrollTop - el.clientHeight < 40]);
    $('publicChat').innerHTML = messageMarkup(state.publicMessages || []);
    const isPrivate = activeChatTab === 'secret';
    $('publicChat').hidden = isPrivate;
    $('secretChat').hidden = !isPrivate;
    document.querySelectorAll('[data-chat-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.chatTab === activeChatTab));
    // Who a private message goes to: individual players, any number of them.
    const others = chatOthers();
    [...selectedRecipients].forEach(id => { if (!others.some(p => p.id === id)) selectedRecipients.delete(id); });
    // With players picked: everything the picked players sent to me, plus what I sent only if it went to exactly that group.
    const myId = state.me?.id;
    const thread = m => {
      if (m.senderId !== myId) return selectedRecipients.has(m.senderId);
      const to = new Set((m.targets || []).map(t => t.id)); to.delete(myId);
      return to.size === selectedRecipients.size && [...to].every(id => selectedRecipients.has(id));
    };
    $('secretChat').innerHTML = messageMarkup(selectedRecipients.size ? (state.privateMessages || []).filter(thread) : (state.privateMessages || []), true);
    logs.forEach(([el, atBottom]) => { if (atBottom) el.scrollTop = el.scrollHeight; });
    $('chatRecipients').hidden = !isPrivate;
    $('recipientChips').innerHTML = others.length
      ? `<button type="button" class="recipient-chip recipient-all ${selectedRecipients.size === others.length ? 'selected' : ''}" data-recipient="__all">Everyone</button>${others.map(p => {
        const house = state.houses.find(item => item.id === p.houseId);
        const on = selectedRecipients.has(p.id);
        return `<button type="button" class="recipient-chip ${on ? 'selected' : ''}" data-recipient="${escapeHtml(p.id)}" aria-pressed="${on}" style="--house-color:${escapeHtml(house?.color || '#c8a86c')}">${houseBanner(house, 'msg-banner msg-banner-sm')}<span>${escapeHtml(p.username)}</span></button>`;
      }).join('')}`
      : '<p class="muted small-text">No other players are at court yet.</p>';
    $('chatMessage').disabled = !state.myHouse;
    lock($('chatForm').querySelector('button[type="submit"]'), state.myHouse ? '' : 'Choose a house before you speak at court.');
    $('chatMessage').placeholder = isPrivate ? 'Whisper to the chosen players…' : 'Speak before the court…';
  }

  const HUBS = { money: ['YOUR TREASURY', 'Money', 'hubMoney'], relations: ['COURT & DIPLOMACY', 'Relations', 'hubRelations'], army: ['FORCES & WAR', 'Army', 'hubArmy'] };
  const SUB_LABEL = { gift: 'Send money & troops', reports: 'Reports', alliances: 'Alliances', treaties: 'Pay taxes & tribute', messages: 'Messages', decrees: 'Decrees', hand: 'Hand’s ledger', recruit: 'Recruit & disband', spies: 'Spies' };
  let currentSub = null;
  function showSub(name) {
    currentSub = name || null;
    const pane = currentHub ? $(HUBS[currentHub][2]) : null;
    if (!pane) return;
    pane.querySelectorAll('.sub-menu').forEach(menu => { menu.hidden = Boolean(currentSub); });
    pane.querySelectorAll('.sub-page').forEach(page => { page.hidden = page.dataset.sub !== currentSub; });
    // Header: small text = category (Money), big text = the menu you are in (Send money & troops).
    $('hubEyebrow').textContent = currentSub ? HUBS[currentHub][1] : HUBS[currentHub][0];
    $('hubTitle').textContent = currentSub ? SUB_LABEL[currentSub] : HUBS[currentHub][1];
    $('hubBack').hidden = !currentSub;
    $('hubOverlay').querySelector('.hub-sheet').dataset.cat = currentSub || currentHub;
    $('hubOverlay').querySelector('.hub-sheet-body').scrollTop = 0;
    updateBadges();
  }
  // On phones the three category buttons are a footer of tabs: one is always selected and its page stays open above it.
  const onPhone = () => document.body.classList.contains('mobile-device') && document.documentElement.classList.contains('style-med');
  const inHubPhase = () => state && (state.phase === 'ACTION' || state.phase === 'COURT');
  let lastPhoneHub = 'money';
  function openHub(kind, sub = null) {
    const cfg = HUBS[kind];
    if (!cfg) return;
    if (onPhone()) { if (currentHub && currentHub !== kind) markHubSeen(currentHub); lastPhoneHub = kind; }
    document.querySelectorAll('#actionHub .hub-button[data-hub]').forEach(b => b.classList.toggle('is-active', b.dataset.hub === kind));
    $('hubEyebrow').textContent = cfg[0];
    $('hubTitle').textContent = cfg[1];
    for (const [key, value] of Object.entries(HUBS)) $(value[2]).hidden = key !== kind;
    currentHub = kind;
    $('hubOverlay').hidden = false;
    $('hubOverlay').querySelector('.hub-sheet').dataset.cat = kind;
    showSub(sub);
    document.body.classList.add('hub-open');
  }
  function closeHub() {
    if ($('hubOverlay').hidden) return;
    if (onPhone() && inHubPhase()) return;
    document.querySelectorAll('#actionHub .hub-button.is-active').forEach(b => b.classList.remove('is-active'));
    markHubSeen(currentHub);
    $('hubOverlay').hidden = true;
    currentHub = null;
    currentSub = null;
    document.body.classList.remove('hub-open');
    updateBadges();
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  let ledgerAll = false, ledgerFilter = 'all';
  function renderHub() {
    const visible = state.phase === 'ACTION' || state.phase === 'COURT';
    $('actionHub').hidden = !visible;
    $('gameScreen').classList.toggle('hub-mode', visible);
    $('mapToggleButton').hidden = visible;
    if (!visible) closeHub();
    const courtOnly = state.phase === 'COURT';
    if (onPhone()) {
      const tb = document.querySelector('.topbar');
      if (tb) document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`);
      const fh = $('actionHub').offsetHeight; if (fh) document.documentElement.style.setProperty('--footer-h', `${fh}px`);
      if (visible && $('hubOverlay').hidden) { if (courtOnly) openHub('relations', 'messages'); else openHub(HUBS[lastPhoneHub] ? lastPhoneHub : 'money'); }
    }
    document.querySelectorAll('#actionHub .hub-button[data-hub]').forEach(b => {
      const shut = courtOnly && b.dataset.hub !== 'relations';
      b.classList.toggle('is-locked', shut); b.setAttribute('aria-disabled', String(shut));
      b.title = shut ? 'During court only the chat is open.' : '';
    });
    if (courtOnly && !$('hubOverlay').hidden && !(currentHub === 'relations' && currentSub === 'messages')) openHub('relations', 'messages');
    if (state.phase === 'LOBBY') seenNotes.ready = false;
    const h = state.myHouse;
    if (!h) return;
    updateBadges();
    const myAlliances = (state.alliances || []).filter(a => a.houseA === h.id || a.houseB === h.id).length;
    const waiting = (state.allianceOffers || []).filter(o => o.canRespond).length + (state.treaties || []).filter(t => t.status === 'pending' && !t.isOutgoing).length + (state.decrees || []).filter(d => !d.isIssuer && d.myState === 'pending').length;
    const total = h.infantry + h.navy + h.dragons;
    // Hub buttons (details are hidden on phones)
    $('hubMoneyGold').textContent = `${h.money} gold`;
    $('hubMoneyIncome').textContent = `+${h.incomePerRound} income · −${h.upkeepPerRound} upkeep`;
    $('hubMoneyCapitals').textContent = state.capitals.find(c => c.id === h.cityId)?.name ? `Living in ${state.capitals.find(c => c.id === h.cityId).name}` : 'You have no city';
    $('hubRelAlliances').textContent = plural(myAlliances, 'alliance');
    $('hubRelOffers').textContent = waiting ? `${plural(waiting, 'offer')} awaiting your reply` : 'No offers waiting';
    $('hubRelRole').textContent = state.isKing ? 'You wear the crown — traitors & taxes' : 'Alliances, treaties & messages';
    $('hubArmyTotal').textContent = `${total} units`;
    $('hubArmyDetail').textContent = `${h.infantry} infantry · ${h.navy} navy${h.navyBuilding ? ` (+${h.navyBuilding})` : ''} · ${h.dragons} dragons`;
    $('hubArmyCosts').textContent = `Recruit: infantry ${h.infantryCost}g · navy ${h.navyCost}g`;
    // Money sheet
    $('moneyGold').textContent = `${h.money} gold`;
    $('moneyIncomeNote').textContent = `${h.incomePerRound >= h.upkeepPerRound ? '+' : '−'}${Math.abs(h.incomePerRound - h.upkeepPerRound)} a round · ${h.incomePerRound} income − ${h.upkeepPerRound} upkeep`;
    $('upkeepNote').textContent = `Upkeep: ${h.upkeepPerRound} gold per round (1 per unit).`;
    const led = (h.ledger || []).map(e => ({ ...e, kind: e.kind || (e.res === 'gold' ? 'money' : 'soldiers'), tone: e.tone || (e.delta > 0 ? 'good' : e.delta < 0 ? 'bad' : 'info') }));
    const KINDS = [['all', 'All', null], ['money', 'Money', 'game-coins'], ['soldiers', 'Soldiers', 'game-swords'], ['battles', 'Battles', 'game-swords'], ['spies', 'Spies', 'game-spy'], ['diplomacy', 'Diplomacy', 'game-handshake'], ['cities', 'Cities', 'game-castle']];
    const unread = e => e.alert && !seenNotes.ledger.has(e.id);
    $('ledgerFilters').innerHTML = KINDS.map(([k, label]) => { const n = led.filter(e => (k === 'all' || e.kind === k) && unread(e)).length; return `<button type="button" class="ledger-chip ${ledgerFilter === k ? 'is-on' : ''}" data-action="ledger-filter" data-filter="${k}" aria-pressed="${ledgerFilter === k}">${label}${n ? `<i class="ledger-chip-dot">${n}</i>` : ''}</button>`; }).join('');
    const sum = (res, sign) => led.filter(e => e.res === res && Math.sign(e.delta) === sign).reduce((n, e) => n + Math.abs(e.delta), 0);
    $('ledgerTotals').hidden = !['all', 'money', 'soldiers'].includes(ledgerFilter);
    $('ledgerTotals').innerHTML = `<span>Gold in <b class="in">+${sum('gold', 1)}</b></span><span>Gold out <b class="out">−${sum('gold', -1)}</b></span><span>Troops in <b class="in">+${sum('infantry', 1) + sum('navy', 1) + sum('dragons', 1)}</b></span><span>Troops out <b class="out">−${sum('infantry', -1) + sum('navy', -1) + sum('dragons', -1)}</b></span>`;
    const ICON = { money: 'game-coins', soldiers: 'game-swords', battles: 'game-swords', spies: 'game-spy', diplomacy: 'game-handshake', cities: 'game-castle' };
    const UNIT = { gold: 'gold', infantry: 'infantry', navy: 'ships', dragons: 'dragons' };
    const filtered = led.filter(e => ledgerFilter === 'all' || e.kind === ledgerFilter);
    const recent = e => e.round >= state.round - 1 || unread(e);
    const older = filtered.filter(e => !recent(e)).length;
    const shown = ledgerAll ? filtered : filtered.filter(recent);
    const tog = $('ledgerToggle');
    tog.hidden = !older;
    tog.textContent = ledgerAll ? 'Hide earlier rounds' : `Show earlier rounds (${older})`;
    let lastRound = null, rows = '';
    for (const e of shown) {
      if (e.round !== lastRound) { rows += `<div class="ledger-round-head">Round ${e.round}</div>`; lastRound = e.round; }
      rows += `<div class="ledger-row tone-${e.tone} ${unread(e) ? 'is-new' : ''}"><img class="ledger-icon" src="./assets/${ICON[e.kind] || 'game-coins'}.png?v=2" alt="${escapeHtml(e.kind)}"><p>${escapeHtml(e.text)}</p>${e.delta ? `<span class="ledger-delta">${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta)} ${UNIT[e.res] || escapeHtml(e.res)}</span>` : ''}${unread(e) ? '<i class="ledger-new">NEW</i>' : ''}</div>`;
    }
    $('moneyLedger').innerHTML = rows || `<p class="muted small-text">${ledgerFilter === 'all' ? 'Nothing has been recorded yet.' : 'Nothing of this kind has been recorded.'}</p>`;
    const fb = $('forfeitCrownButton'); $('kingForfeit').hidden = !state.isKing; $('subTreaties').hidden = state.isKing || state.isHand; if ((state.isKing || state.isHand) && currentSub === 'treaties') showSub(null); if (fb) { lock(fb, state.phase === 'ACTION' ? '' : 'You can forfeit the crown during the action phase.'); }
    // Army sheet
    $('armyInfantry').textContent = h.infantry;
    $('armyNavy').textContent = h.navy + (h.navyBuilding ? ` (+${h.navyBuilding} building)` : '');
    $('armyDragons').textContent = h.dragons;
    $('armyInfantryCost').textContent = `${h.infantryCost} gold`;
    $('armyNavyCost').textContent = `${h.navyCost} gold`;
    $('battleReports').innerHTML = (state.events || []).filter(e => e.kind === 'battle').map(e => `<div class="resolution-item"><span>R${e.round}</span><p>${escapeHtml(e.text)}${e.battle ? ` <button class="button button-quiet button-small" type="button" data-replay="${escapeHtml(e.battle.id)}">Watch the dice</button>` : ''}</p></div>`).join('') || '<p class="muted small-text">No battles have been fought yet.</p>';
    $('battleReports').querySelectorAll('[data-replay]').forEach(btn => btn.addEventListener('click', () => {
      const ev = (state.events || []).find(e => e.battle && e.battle.id === btn.dataset.replay); if (!ev) return;
      announceQueue.push({ notice: { id: `replay-${ev.battle.id}`, kind: 'battle-report', title: `Battle at ${ev.battle.capitalName}`, text: ev.text, banners: [], battle: ev.battle } });
      if (!announceShowing) { announceShowing = true; showNextAnnouncement(); }
    }));
    $('armyPhaseNote').textContent = state.phase === 'ACTION' ? '' : 'Recruiting, spying and declaring war open during the action phase.';
    $('relationsPhaseNote').textContent = diploOpen() ? '' : 'Alliances, treaties, decrees and war councils open during the action and court phases. Messages can be sent at any time.';
    // King's ledger
    $('kingTools').hidden = !state.isKing;
    $('kingDecrees').hidden = !state.isKing;
    $('subDecrees').hidden = !state.isKing;
    $('subHand').hidden = !state.isHand;
    if ((currentSub === 'decrees' && !state.isKing) || (currentSub === 'hand' && !state.isHand)) showSub(null);
    if (state.isKing) {
      const keep = $('newHandSelect').value;
      $('newHandSelect').innerHTML = state.players.filter(p => !p.left && !p.eliminated && p.id !== state.me?.id).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.username)}${p.id === state.hand?.id ? ' (current Hand)' : ''}</option>`).join('');
      if (keep) $('newHandSelect').value = keep;
      lock($('newHandForm').querySelector('button[type="submit"]'), !diploOpen() ? 'A new Hand can be named during the action and court phases.' : !$('newHandSelect').value ? 'There is no one else at court.' : $('newHandSelect').value === state.hand?.id ? 'That player is already the Hand.' : '');
    }
    if (state.isHand) {
      const all = state.decrees || [];
      $('handLedger').innerHTML = all.length ? all.map(d => `<article class="tax-entry"><strong>Round ${d.round} · King ${escapeHtml(d.kingName)}${d.message ? ` · “${escapeHtml(d.message)}”` : ''}</strong>${(d.gold || d.infantry || d.navy) ? `<div class="tax-row"><span>Demanded</span><span>${[d.gold && `${d.gold} gold`, d.infantry && `${d.infantry} infantry`, d.navy && `${d.navy} ships`].filter(Boolean).join(' · ')}</span></div>` : ''}${(d.recipients || []).map(x => `<div class="tax-row"><span class="row-who">${bannerOf(x.houseId)}House ${escapeHtml(capName(prettyHouse(x.houseId)))}</span><span class="${x.state === 'sent' ? 'tax-paid' : x.state === 'noted' ? 'tax-none' : 'tax-short'}">${x.state === 'sent' ? `Paid${[d.gold && ` ${d.gold} gold`, d.infantry && ` ${d.infantry} infantry`, d.navy && ` ${d.navy} ships`].filter(Boolean).join(',')}` : x.state === 'noted' ? 'Delivered' : 'Not yet paid'}</span></div>`).join('')}</article>`).join('') : '<p class="muted small-text">The king has issued no decrees yet.</p>';
    }
    if (state.isKing) {
      const others = state.players.filter(p => !p.left && p.id !== state.me?.id).sort((x, y) => houseIndex(x.houseId) - houseIndex(y.houseId));
      $('traitorList').innerHTML = others.length ? others.map(p => {
        const house = state.houses.find(item => item.id === p.houseId);
        return `<div class="alliance-row house-row" style="--house-color:${escapeHtml(house?.color || '#888')}"><div class="row-who">${houseBanner(house, 'msg-banner')}<div><strong>${escapeHtml(p.username)}${p.traitor ? ' <em class="traitor-tag">TRAITOR</em>' : ''}</strong><small>${house ? `House ${escapeHtml(house.name)}` : 'No house'}</small></div></div><button class="button ${p.traitor ? 'button-quiet' : 'button-danger'} button-small" type="button" data-action="toggle-traitor" data-player-id="${escapeHtml(p.id)}" data-traitor="${p.traitor ? 'false' : 'true'}">${p.traitor ? 'Pardon' : 'Label traitor'}</button></div>`;
      }).join('') : '<p class="muted small-text">There is no one else at court.</p>';
      const issued = (state.decrees || []).filter(d => d.isIssuer);
      $('taxLedger').innerHTML = issued.length ? issued.map(d => `<article class="tax-entry"><strong>Round ${d.round}${d.message ? ` · “${escapeHtml(d.message)}”` : ''}</strong>${(d.gold || d.infantry || d.navy) ? `<div class="tax-row"><span>Demanded</span><span>${[d.gold && `${d.gold} gold`, d.infantry && `${d.infantry} infantry`, d.navy && `${d.navy} ships`].filter(Boolean).join(' · ')}</span></div>` : ''}<small class="muted">Only the Hand sees who has paid.</small></article>`).join('') : '<p class="muted small-text">You have issued no decrees yet. Open the Relations menu and seal one.</p>';
    }
  }

  function renderEvents() {
    $('resolutionEvents').innerHTML = state.events.filter(e => e.kind === 'battle' || e.kind === 'important').map(e => `<div class="resolution-item"><span>R${e.round}</span><p>${escapeHtml(e.text)}</p></div>`).join('') || '<p class="muted small-text">No major events have been recorded yet.</p>';
  }

  function renderPhase() {
    const phaseInfo = PHASES[state.phase] || PHASES.LOBBY;
    $('phaseEyebrow').textContent = phaseInfo[0];
    $('phaseTitle').textContent = state.phase === 'ACTION' ? `Round ${state.round}: prepare your moves` : phaseInfo[1];
    $('phaseDescription').textContent = phaseInfo[2];
    updateRoundPill();

    $('resolutionPanel').hidden = state.phase !== 'RESOLUTION';
  }

  const normHouse = value => String(value || '').toLowerCase().replace(/^house\s+/, '').trim();
  function findPickedHouse() {
    if (!pickedHouse || !state?.houses) return null;
    return state.houses.find(h => h.id === pickedHouse.key || normHouse(h.id) === pickedHouse.key || normHouse(h.name) === pickedHouse.key) || null;
  }
  function setPickedHouse(value) {
    pickedHouse = value;
    if (value) localStorage.setItem(pickedHouseKey, JSON.stringify(value));
    else localStorage.removeItem(pickedHouseKey);
  }

  // Flow: host setup or throne selection → name → waiting room → game.
  function updateScreens() {
    const loggedIn = Boolean(state?.me);
    const needName = !loggedIn && !enteredName && !nameDismissed;
    $('nameScreen').hidden = !needName;
    if (needName && !$('nameEntryInput').dataset.filled) { $('nameEntryInput').value = savedPlayerName(); $('rememberNameInput').checked = Boolean(savedPlayerName()); $('nameEntryInput').dataset.filled = '1'; }
    const hostSetup = showHostSetup || (loggedIn && state?.phase === 'LOBBY' && state.isHost && !state.settings?.configured);
    const showThrone = changingLobbyHouse || !loggedIn;
    const waiting = loggedIn && state?.phase === 'LOBBY' && !hostSetup && !changingLobbyHouse;
    const inGame = loggedIn && state?.phase !== 'LOBBY' && state?.phase !== 'HAND_SELECTION';
    $('throneScreen').hidden = !showThrone;
    $('hostSetupScreen').hidden = !hostSetup;
    $('lobbyScreen').hidden = !waiting;
    $('kingSelectionScreen').hidden = !loggedIn || state?.phase !== 'HAND_SELECTION';
    $('gameScreen').hidden = !inGame;
    $('buildLabel').hidden = inGame;
    $('gameVersion').hidden = inGame;
    $('headerStats').hidden = !inGame;
    $('headerPin').hidden = !waiting;
    if (waiting) $('headerPinCode').textContent = gameCode || '——';
    document.body.classList.toggle('in-game', inGame);
    document.body.classList.toggle('throne-open', showThrone);
    if (hostSetup) {
      $('gameTypeInput').value = state?.settings?.gameType || 'CLASSIC';
      $('teamSizeInput').value = String(state?.settings?.teamSize || 2);
      limitOptions(state?.settings?.maxPlayers);
      updateDragonSetup();
      $('friendlyFireInput').checked = state?.settings?.friendlyFire !== false;
    }
  }

  // Tell the throne which houses can be picked right now (same rules as the lobby house picker).
  function sendHousesToThrone() {
    const frame = $('throneFrame');
    if (!frame?.contentWindow || !state?.houses) return;
    const houses = state.houses.map(h => {
      const reason = minorHouseReason(h, state.me?.id);
      const hiddenHouse = (h.id === 'targaryen' && state.settings?.gameType === 'LAST_DRAGON') || (state.settings?.disabledHouses || []).includes(h.id);
      const locked = Boolean(reason) && !reason.startsWith('Already claimed') && !reason.startsWith('Team full');
      const claimed = Boolean(reason) && !locked;
      return {
        id: h.id, name: h.name, motto: h.motto, color: h.color, buff: state.settings?.houseBuffs === false ? '' : (h.buff || ''),
        status: hiddenHouse ? 'hidden' : locked ? 'locked' : claimed ? 'claimed' : 'open',
        note: reason || (state.settings?.gameType === 'TEAMS' ? `Team · ${h.players.filter(p => !p.left).length} of ${state.settings.teamSize || 2} sworn` : 'One player per house')
      };
    });
    frame.contentWindow.postMessage({ type: 'iron-throne:houses', houses }, location.origin === 'null' ? '*' : location.origin);
  }

  // Once logged in, claim the house picked on the throne (uses the existing select-house action).
  function claimPickedHouse() {
    if (!pickedHouse || !state?.me) return;
    const house = findPickedHouse();
    const label = pickedHouse.name;
    setPickedHouse(null);
    if (!house) { showToast(`Could not find ${label}. Choose a house in the lobby.`, 'error'); return; }
    if (state.me.houseId === house.id) return;
    if (state.phase !== 'LOBBY') { showToast('The game has already begun, so your house cannot change now.', 'error'); return; }
    emitAction('select-house', { houseId: house.id });
  }

  function openNameEditor() {
    $('lobbyEditMenu').close?.();
    $('lobbyNameInput').value = state?.me?.pendingName || state?.me?.username || '';
    $('lobbyRememberInput').checked = Boolean(savedPlayerName());
    $('lobbyNameDialog').showModal();
    $('lobbyNameInput').focus();
  }

  let editingBotId = null;
  function openBotEditor(botId) {
    const bot = state?.players?.find(p => p.id === botId && p.isBot);
    if (!bot) return;
    editingBotId = botId;
    $('botNameInput').value = bot.username;
    $('botHouseSelect').innerHTML = state.houses.filter(h => !(h.id === 'targaryen' && state.settings?.gameType === 'LAST_DRAGON') && !(state.settings?.disabledHouses || []).includes(h.id)).map(h => {
      const unavailable = Boolean(minorHouseReason(h, bot.id));
      return `<option value="${escapeHtml(h.id)}" ${unavailable ? 'disabled' : ''}>${escapeHtml(h.name)}</option>`;
    }).join('');
    $('botHouseSelect').value = bot.houseId;
    $('botEditDialog').showModal();
  }

  function removeBot(botId) {
    const bot = state?.players?.find(p => p.id === botId && p.isBot);
    if (bot) emitAction('remove-bot', { botId });
  }

  let mapZoom = 1;
  function applyMapZoom(next, keepCenter = true) {
    const vp = $('mapViewport'), svg = vp.querySelector('.realm-map');
    const prev = mapZoom; mapZoom = Math.min(4.5, Math.max(1, next));
    const cx = (vp.scrollLeft + vp.clientWidth / 2) / (vp.scrollWidth || 1), cy = (vp.scrollTop + vp.clientHeight / 2) / (vp.scrollHeight || 1);
    svg.style.setProperty('--map-zoom', String(mapZoom));
    if (keepCenter && prev !== mapZoom) { vp.scrollLeft = cx * vp.scrollWidth - vp.clientWidth / 2; vp.scrollTop = cy * vp.scrollHeight - vp.clientHeight / 2; }
  }
  (() => {
    const vp = $('mapViewport'); let drag = null, moved = false;
    vp.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, l: vp.scrollLeft, t: vp.scrollTop }; moved = false; });
    window.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) > 5) { moved = true; vp.classList.add('is-dragging'); }
      if (moved) { vp.scrollLeft = drag.l - dx; vp.scrollTop = drag.t - dy; }
    });
    window.addEventListener('pointerup', () => { drag = null; vp.classList.remove('is-dragging'); });
    vp.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
    vp.addEventListener('wheel', e => { e.preventDefault(); applyMapZoom(mapZoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
  })();
  (() => {
    const vp = $('mapViewport'); let pinch = null;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    vp.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = { d: dist(e.touches), z: mapZoom }; }, { passive: true });
    vp.addEventListener('touchmove', e => {
      if (e.touches.length !== 2 || !pinch) return;
      e.preventDefault();
      applyMapZoom(pinch.z * dist(e.touches) / pinch.d);
    }, { passive: false });
    vp.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
  })();
  function fitMap() {
    const vp = $('mapViewport'), dlg = $('mapDialog');
    const vh = Math.max(280, Math.min(window.innerHeight - 175, 1500));
    const mapW = vh * 944 / 1721;
    dlg.style.width = Math.max(320, Math.min(window.innerWidth - 20, mapW + 40, 900)) + 'px';
    vp.style.maxHeight = 'none'; vp.style.height = vh + 'px';
    vp.style.height = Math.min(vh, Math.round(vp.clientWidth * 1721 / 944)) + 'px';
    mapZoom = 1; applyMapZoom(1, false);
    vp.scrollLeft = 0; vp.scrollTop = 0;
  }
  function setMapOpen(open) {
    const dialog = $('mapDialog');
    if (open) {
      if (!dialog.open) { dialog.showModal(); fitMap(); }
      if (state?.myHouse && !warBlockReason()) startPick(true);
      else if (state?.myHouse && ['ACTION', 'COURT', 'RESOLUTION'].includes(state.phase)) showMapHint(warBlockReason());
    } else if (dialog.open) dialog.close();
    dialog.querySelectorAll('.map-cap.is-active').forEach(cap => cap.classList.remove('is-active'));
  }

  function openHouseChooser() {
    $('lobbyEditMenu').close?.();
    if (!lobbyCanChangeHouse) return showToast(houseChangeMsg(), 'error');
    changingLobbyHouse = true;
    setPickedHouse(null);
    $('throneFrame')?.contentWindow?.postMessage({ type: 'iron-throne:reset' }, location.origin === 'null' ? '*' : location.origin);
    transitionThrone('house');
    render();
    sendHousesToThrone();
  }

  // ---- Notification badges: on the three hub buttons, and on the exact box inside each menu ----
  const seenNotes = { ready: false, pub: new Set(), sec: new Set(), offers: new Set(), treaties: new Set(), decrees: new Set(), war: new Set(), battles: new Set(), ledger: new Set(), gold: 0 };
  let currentHub = null;
  const markSeen = (set, list) => list.forEach(item => set.add(item.id));
  function noteLists() {
    const me = state.me.id;
    return {
      pub: (state.publicMessages || []).filter(m => m.senderId !== me),
      sec: (state.privateMessages || []).filter(m => m.senderId !== me),
      offers: (state.allianceOffers || []).filter(o => o.canRespond),
      treaties: (state.treaties || []).filter(t => t.status === 'pending' && !t.isOutgoing),
      decrees: (state.decrees || []).filter(d => !d.isIssuer && d.myState === 'pending'),
      war: [...(state.spoils || []).filter(x => x.status === 'open').map(x => ({ id: x.id }))],
      battles: (state.events || []).filter(e => e.kind === 'battle'),
      ledger: (state.myHouse?.ledger || []).filter(e => e.alert)
    };
  }
  function setBadge(id, text) {
    const el = $(id);
    if (!el) return;
    const previous = el.hidden ? '' : el.textContent;
    el.hidden = !text;
    el.textContent = text || '';
    if (text && text !== previous) { el.classList.remove('badge-pop'); void el.offsetWidth; el.classList.add('badge-pop'); }
  }
  // Boxes inside a menu keep their badge while you are in it; they count as seen when you close the menu.
  function markHubSeen(kind) {
    const h = state?.myHouse;
    if (!h || !state.me || !kind) return;
    const n = noteLists();
    // Relations and army pages count as seen when you open them (see updateBadges), not when you close the menu.
    if (kind === 'money') { seenNotes.gold = h.money; markSeen(seenNotes.ledger, n.ledger); }
  }
  function updateBadges() {
    const h = state?.myHouse;
    if (!h || !state.me) return;
    const n = noteLists();
    if (!seenNotes.ready) {
      markSeen(seenNotes.pub, n.pub); markSeen(seenNotes.sec, n.sec); markSeen(seenNotes.offers, n.offers); markSeen(seenNotes.treaties, n.treaties); markSeen(seenNotes.decrees, n.decrees); markSeen(seenNotes.war, n.war); markSeen(seenNotes.battles, n.battles); markSeen(seenNotes.ledger, n.ledger);
      seenNotes.gold = h.money;
      seenNotes.ready = true;
    }
    // The chat tab you are reading counts as seen straight away.
    if (currentHub === 'relations' && currentSub === 'messages') markSeen(activeChatTab === 'public' ? seenNotes.pub : seenNotes.sec, activeChatTab === 'public' ? n.pub : n.sec);
    if (currentHub === 'relations' && currentSub === 'alliances') markSeen(seenNotes.offers, n.offers);
    if (currentHub === 'relations' && currentSub === 'treaties') { markSeen(seenNotes.treaties, n.treaties); markSeen(seenNotes.decrees, n.decrees); }
    if (currentHub === 'money' && currentSub === 'reports') { markSeen(seenNotes.war, n.war); markSeen(seenNotes.battles, n.battles); }
    if (h.money < seenNotes.gold) seenNotes.gold = h.money;
    const count = (list, set) => list.filter(item => !set.has(item.id)).length;
    const unPub = count(n.pub, seenNotes.pub), unSec = count(n.sec, seenNotes.sec), unOffers = count(n.offers, seenNotes.offers), unTreaties = count(n.treaties, seenNotes.treaties), unDecrees = count(n.decrees, seenNotes.decrees), unWar = count(n.war, seenNotes.war), unBattles = count(n.battles, seenNotes.battles), unLedger = count(n.ledger, seenNotes.ledger);
    const gain = Math.max(0, h.money - seenNotes.gold);
    const text = value => (value ? String(Math.min(value, 99)) : '');
    setBadge('badgeRelations', text(unPub + unSec + unOffers + unTreaties + unDecrees));
    setBadge('badgeMoneyN', text(unBattles + unWar + unLedger));
    setBadge('badgeLedger', text(unLedger));
    setBadge('badgeSubReports', text(unBattles + unWar + unLedger));
    setBadge('badgeSubAlliances', text(unOffers));
    setBadge('badgeSubTreaties', text(unTreaties + unDecrees));
    setBadge('badgeSubMessages', text(unPub + unSec));
    setBadge('badgeMoney', gain ? `+${gain}` : '');
    setBadge('badgeTabPublic', text(unPub));
    setBadge('badgeTabSecret', text(unSec));
    setBadge('badgeOffers', text(unOffers));
    setBadge('badgeTreaties', text(unTreaties + unDecrees));
    setBadge('badgeWar', text(unWar));
    setBadge('badgeGold', gain ? `+${gain}` : '');
  }

  // ---- King / Hand announcements: the new player's banner replaces the old one ----
  const announceKey = () => `warOfWesterosAnnounced:${gameCode}`;
  let announced = { king: null, hand: null };
  let announcedFor = '';
  const announceQueue = [];
  let announceShowing = false;
  let announceTimer = null;
  function loadAnnounced() {
    if (announcedFor === gameCode) return;
    announcedFor = gameCode;
    try { announced = { king: null, hand: null, ...JSON.parse(localStorage.getItem(announceKey()) || '{}') }; } catch { announced = { king: null, hand: null }; }
  }
  function saveAnnounced() { try { localStorage.setItem(announceKey(), JSON.stringify(announced)); } catch { /* storage unavailable */ } }
  function roleSnapshot(person) {
    if (!person) return null;
    const player = state.players.find(p => p.id === person.id);
    return { id: person.id, name: person.username, houseId: player?.houseId || null };
  }
  // A king with no Hand is taken straight to the decrees menu to appoint one (once per round until they have).
  let handPromptKey = null;
  function maybePromptHand() {
    if (state?.settings?.handEnabled === false) return;
    if (!state?.me || !state.isKing || state.hand || !['ACTION', 'RESOLUTION'].includes(state.phase)) { if (!state?.isKing || state?.hand) handPromptKey = null; return; }
    if (announceShowing || !$('announceOverlay').hidden || !$('decreeOverlay').hidden) return;
    const key = `${state.me.id}:${state.round}`;
    if (handPromptKey === key) return;
    handPromptKey = key;
    openHub('relations', 'decrees');
  }
  function checkRoleChanges() {
    if (!state?.me || !gameCode || document.hidden) return;
    loadAnnounced();
    if (state.phase === 'LOBBY') {
      if (announced.king || announced.hand) { announced = { king: null, hand: null }; saveAnnounced(); }
      return;
    }
    if (!['ACTION', 'COURT', 'RESOLUTION'].includes(state.phase)) return;
    for (const role of ['king', 'hand']) {
      const next = roleSnapshot(state[role]);
      const prev = announced[role];
      if (!next || (prev && prev.id === next.id)) continue;
      if (popupAllowed('king-hand') && !state.gameOver) announceQueue.push({ role, prev, next }); // no "new king" popup on the move that ends the game
      announced[role] = next;
    }
    saveAnnounced();
    if (!announceShowing) showNextAnnouncement();
  }
  // ---- Event notices: alliances, traitor labels, attacks, battle results ----
  const NOTICE_LABEL = { decree: 'ROYAL DECREE', crown: 'THE CROWN', desertion: 'DESERTION', 'round-start': 'NEW ROUND', 'round-bad': 'NEW ROUND', 'battle-report': 'THE SIEGE', 'spy-caught': 'SPIES CAUGHT', alliance: 'ALLIANCE', 'alliance-broken': 'ALLIANCE BROKEN', traitor: 'TRAITOR', attacked: 'UNDER ATTACK', 'battle-won': 'VICTORY', 'battle-lost': 'DEFEAT', siege: 'UNDER SIEGE', sacked: 'SACKED', 'city-fell': 'YOUR CITY FELL' };
  const NOTICE_MID = { 'spy-caught': 'game-spy', alliance: 'game-handshake', 'alliance-broken': 'game-chain', attacked: 'game-swords', 'battle-won': 'game-swords', 'battle-lost': 'game-swords', siege: 'game-swords', sacked: 'game-swords' };
  const NOTICE_NOT_NEGATIVE = new Set(['round-start', 'battle-report', 'alliance', 'battle-won', 'spy-caught', 'decree', 'crown', 'notice']); // default outline; everything else is red
  // After being away, only these still matter: a broken alliance, a siege, or your own city falling.
  const BACKLOG_KINDS = new Set(['alliance-broken', 'siege', 'city-fell']);
  let wasAway = true; // true on page load and whenever the tab was hidden
  document.addEventListener('visibilitychange', () => { if (document.hidden) wasAway = true; else if (state) { checkNotices(); checkRoleChanges(); } });
  const noticeKey = () => `warOfWesterosNotices:${gameCode}`;
  let seenNoticeIds = null;
  function checkNotices() {
    if (!state?.me || !gameCode || !state.myHouse) return;
    if (!seenNoticeIds) {
      let raw = null;
      try { raw = localStorage.getItem(noticeKey()); } catch { /* storage unavailable */ }
      seenNoticeIds = new Set(raw ? JSON.parse(raw) : []);
      if (!raw) (state.notices || []).forEach(n => seenNoticeIds.add(n.id));
    }
    if (document.hidden) { wasAway = true; return; } // popups wait until the tab is visible again
    const fresh = (state.notices || []).filter(n => !seenNoticeIds.has(n.id)).reverse();
    const backlog = wasAway && fresh.length > 2;
    wasAway = false;
    if (!fresh.length) return;
    fresh.forEach(n => seenNoticeIds.add(n.id));
    // A pile of missed popups collapses to what still matters; the latest king and hand are announced by checkRoleChanges.
    (backlog ? fresh.filter(n => BACKLOG_KINDS.has(n.kind)) : fresh).filter(n => !NOTICE_POPUP[n.kind] || popupAllowed(NOTICE_POPUP[n.kind])).forEach(n => announceQueue.push({ notice: n }));
    try { localStorage.setItem(noticeKey(), JSON.stringify([...seenNoticeIds].slice(-150))); } catch { /* storage unavailable */ }
    if (!announceShowing) showNextAnnouncement();
  }
  function announceBanner(snap, className) {
    const house = snap && state.houses.find(h => h.id === snap.houseId);
    return (house && houseBanner(house, `announce-banner ${className}`)) || `<span class="announce-banner announce-banner-empty ${className}" aria-hidden="true">?</span>`;
  }
  function showNextAnnouncement() {
    const item = announceQueue.shift();
    if (!item) {
      announceShowing = false; $('announceOverlay').hidden = true;
      checkDecreePopup(); // a decree that arrived meanwhile follows straight after
      maybePromptHand();
      return;
    }
    if (battleAnim) { battleAnim.cancel(); battleAnim = null; }
    announceShowing = true;
    // Back-to-back popups: the overlay stays up and only the card changes, fading in as the new content lands.
    const swapCard = $('announceOverlay').querySelector('.announce-card');
    swapCard.classList.remove('swap-out', 'swap-in', 'battle-card');
    $('announceStage').classList.remove('is-battle');
    if (!$('announceOverlay').hidden) { void swapCard.offsetWidth; swapCard.classList.add('swap-in'); }
    if (item.reveal) {
      const r = item.reveal;
      const house = state.houses.find(h => h.id === r.houseId);
      $('announceEyebrow').textContent = 'YOUR ROLE';
      $('announceTitle').textContent = r.dragon ? 'You are a Targaryen' : `You are House ${house ? capName(house.name) : ''}`;
      $('announceStage').classList.remove('has-old');
      $('announceStage').classList.add('is-notice');
      $('announceStage').innerHTML = announceBanner({ houseId: r.dragon ? 'targaryen' : r.houseId }, 'ann-new ann-first notice-banner');
      $('announceName').innerHTML = `<span class="notice-text">${r.dragon
        ? `A secret Dragon. Publicly you remain House ${escapeHtml(house ? capName(house.name) : '')}.${r.fellow.length ? ` Fellow Dragons: ${escapeHtml(r.fellow.map(d => d.username).join(', '))}.` : ' You are the only Dragon.'}`
        : `You are loyal to your chosen house. ${plural(r.count, 'Dragon')} hide${r.count === 1 ? 's' : ''} among the players.`}</span>`;
      $('announceOverlay').querySelector('.announce-card').dataset.tone = r.dragon ? 'bad' : '';
      $('announceOverlay').hidden = false;
      clearTimeout(announceTimer);
      announceTimer = setTimeout(closeAnnouncement, 9000);
      return;
    }
    if (item.gameover) {
      const go = item.gameover;
      const youWon = go.type === 'REALM' ? !state.dragon : go.type === 'DRAGONS' ? Boolean(state.dragon) : go.winnerHouseId === state.me?.houseId;
      const ids = go.type === 'CLASSIC' ? [go.winnerHouseId] : go.type === 'DRAGONS' ? [...new Set((go.dragons || []).map(d => d.houseId))] : [];
      $('announceEyebrow').textContent = go.type === 'DRAGONS' ? 'THE DRAGONS WIN' : go.type === 'REALM' ? 'THE REALM WINS' : 'A HOUSE WINS';
      $('announceTitle').textContent = youWon ? 'Victory' : 'Defeat';
      $('announceStage').classList.remove('has-old');
      $('announceStage').classList.add('is-notice');
      $('announceStage').innerHTML = ids.slice(0, 4).map(id => announceBanner({ houseId: id }, 'ann-new ann-first notice-banner')).join('');
      $('announceName').innerHTML = `<span class="notice-text">${escapeHtml(go.text)}${go.dragons?.length ? ` The Dragons were ${escapeHtml(go.dragons.map(d => `${d.username} (House ${prettyHouse(d.houseId)})`).join(', '))}.` : ''}</span>`;
      $('announceOverlay').querySelector('.announce-card').dataset.tone = youWon ? '' : 'bad';
      $('announceOverlay').hidden = false;
      clearTimeout(announceTimer);
      return;
    }
    if (item.notice) {
      const n = item.notice;
      if (n.battle) { renderBattle(n); return; }
      const mid = NOTICE_MID[n.kind];
      const banners = (n.banners || []).map(id => announceBanner({ houseId: id }, 'ann-new ann-first notice-banner'));
      $('announceEyebrow').textContent = NOTICE_LABEL[n.kind] || 'NEWS OF THE REALM';
      $('announceTitle').textContent = n.title;
      $('announceStage').classList.remove('has-old');
      $('announceStage').classList.add('is-notice');
      $('announceStage').innerHTML = banners.length === 2 && mid ? `${banners[0]}<img class="notice-mid" src="./assets/${mid}.png?v=3" alt="">${banners[1]}` : banners.join('');
      $('announceName').innerHTML = n.kind.startsWith('round-') ? `<span class="notice-text round-report">${String(n.text).split('\n').map(l => `<span>${escapeHtml(l)}</span>`).join('')}</span>` : `<span class="notice-text">${escapeHtml(n.text)}</span>`;
      $('announceOverlay').querySelector('.announce-card').dataset.tone = NOTICE_NOT_NEGATIVE.has(n.kind) ? '' : 'bad'; // default outline unless negative
      $('announceOverlay').hidden = false;
      clearTimeout(announceTimer);
      announceTimer = setTimeout(closeAnnouncement, n.kind.startsWith('round-') ? 10000 : 7000);
      return;
    }
    $('announceStage').classList.remove('is-notice');
    $('announceOverlay').querySelector('.announce-card').dataset.tone = '';
    const isKing = item.role === 'king';
    const house = state.houses.find(h => h.id === item.next.houseId);
    $('announceEyebrow').textContent = item.prev ? (isKing ? 'A NEW KING' : 'A NEW HAND') : (isKing ? 'THE FIRST KING' : 'THE HAND OF THE KING');
    $('announceTitle').textContent = isKing ? 'The crown has a new bearer' : 'The King has a new Hand';
    $('announceStage').innerHTML = `${item.prev ? announceBanner(item.prev, 'ann-old') : ''}${announceBanner(item.next, item.prev ? 'ann-new' : 'ann-new ann-first')}`;
    $('announceStage').classList.toggle('has-old', Boolean(item.prev));
    $('announceName').innerHTML = `<strong>${escapeHtml(item.next.name)}</strong>${house ? `<span>House ${escapeHtml(house.name)}</span>` : ''}`;
    $('announceOverlay').hidden = false;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(closeAnnouncement, item.prev ? 7000 : 5500);
  }
  let announceClosing = false;

  // ---- Siege battle: every unit rolls a die, the two sides are lined up from highest to lowest and compared in pairs ----
  let battleAnim = null;
  const DIE_ICON = { infantry: 'ui-spear', navy: 'ui-ship', dragons: 'ui-dragon', garrison: 'game-castle' };
  function renderBattle(n) {
    const b = n.battle, card = $('announceOverlay').querySelector('.announce-card'), stage = $('announceStage');
    const ROW = 38, rows = Math.max(b.attackers.length, b.defenders.length, 1);
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card.classList.add('battle-card'); card.dataset.tone = '';
    $('announceEyebrow').textContent = b.field ? (b.battleNo === 1 ? 'ARMIES MEET ON THE ROAD' : `FIELD BATTLE · EXCHANGE ${b.battleNo}`) : b.battleNo === 1 ? 'THE SIEGE BEGINS' : `THE SIEGE · BATTLE ${b.battleNo}`;
    $('announceTitle').textContent = n.title;
    stage.classList.remove('has-old'); stage.classList.add('is-notice', 'is-battle');
    const names = list => [...new Set(list.map(d => d.houseId))].map(id => `House ${escapeHtml(capName(prettyHouse(id)))}`).join(' · ') || '—';
    const UNIT_NAME = { infantry: 'Infantry', navy: 'Ship', dragons: 'Dragon', garrison: 'Garrison' };
    const dieHtml = (d, side, i) => { const hh = state.houses.find(x => x.id === d.houseId); return `<div class="die ${side} u-${d.unit}" data-side="${side}" data-i="${i}" style="--hc:${escapeHtml(hh?.color || '#8a6a3a')}" title="${escapeHtml(UNIT_NAME[d.unit] || '')}${hh ? ` of House ${escapeHtml(capName(hh.name))}` : ''}"><img class="die-unit" src="./assets/${DIE_ICON[d.unit] || 'ui-spear'}.png?v=3" alt="${escapeHtml(UNIT_NAME[d.unit] || '')}"><b>?</b>${hh ? houseBanner(hh, 'die-banner') : ''}</div>`; };
    stage.innerHTML = `<div class="dice-arena"><div class="dice-head"><span>${b.field ? 'First army' : 'Attackers'}<small>${names(b.attackers)}</small></span><span>${b.field ? 'Second army' : 'Defenders'}<small>${names(b.defenders)}</small></span></div>
      <div class="dice-scroll"><div class="dice-board" style="height:${rows * ROW}px">${b.attackers.map((d, i) => dieHtml(d, 'att', i)).join('')}${b.defenders.map((d, i) => dieHtml(d, 'def', i)).join('')}</div></div>
      <div class="dice-legend"><span>${b.field ? 'Highest rolls face each other · tied dice are discarded · spare dice are discarded' : 'Highest rolls face each other · ties go to the defenders · spare dice are discarded'}</span></div></div>`;
    $('announceName').innerHTML = '<span class="notice-text battle-summary"></span>';
    $('announceOverlay').hidden = false;
    clearTimeout(announceTimer);
    const dice = { att: [...stage.querySelectorAll('.die.att')], def: [...stage.querySelectorAll('.die.def')] };
    const data = { att: b.attackers, def: b.defenders };
    const timers = [], rand = () => Math.floor(Math.random() * 6) + 1;
    const shuffled = n2 => { const a = [...Array(n2).keys()]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const slotOf = { att: shuffled(b.attackers.length), def: shuffled(b.defenders.length) };
    const place = (side, el, slot) => { el.style.top = `${slot * ROW}px`; };
    ['att', 'def'].forEach(side => dice[side].forEach((el, i) => place(side, el, slotOf[side][i])));
    const resultText = b.field ? (b.result === 'ended' ? 'One army is destroyed. The other marches on.' : 'Both armies are bloodied. The fighting goes on.') : b.result === 'fell' ? `The defence collapses. ${escapeHtml(b.capitalName)} falls.` : b.result === 'broken' ? 'The attackers are spent. The siege is broken.' : 'Both sides are bloodied. The siege goes on.';
    const summary = b.field ? `<b>First army lost ${b.attLost}</b> · <b>Second army lost ${b.defLost}</b>${b.ties ? ` · ${b.ties} tied` : ''}<br>${resultText}` : `<b>Attackers lost ${b.attLost}</b> · <b>Defenders lost ${b.defLost}</b><br>${resultText}`;
    const anim = { done: false, cancel() { timers.forEach(clearTimeout); timers.length = 0; clearInterval(anim.spin); }, finish() {
      anim.cancel(); anim.done = true;
      ['att', 'def'].forEach(side => dice[side].forEach((el, i) => { el.classList.remove('rolling'); el.querySelector('b').textContent = data[side][i].v; place(side, el, i); el.classList.toggle('lost', Boolean(data[side][i].lost)); el.classList.toggle('won', i < b.pairs && !data[side][i].lost && !data[side][i].tied); el.classList.toggle('discard', i >= b.pairs || Boolean(data[side][i].tied)); }));
      const sum = stage.parentElement.querySelector('.battle-summary'); if (sum) { sum.innerHTML = summary; sum.classList.add('show'); }
      clearTimeout(announceTimer); announceTimer = setTimeout(closeAnnouncement, 12000);
    } };
    battleAnim = anim;
    if (calm) { anim.finish(); return; }
    // 1) tumble: the faces flicker while the dice shake  2) settle on the real rolls  3) sort high to low  4) compare pair by pair
    dice.att.concat(dice.def).forEach(el => el.classList.add('rolling'));
    anim.spin = setInterval(() => dice.att.concat(dice.def).forEach(el => { el.querySelector('b').textContent = rand(); }), 70);
    timers.push(setTimeout(() => {
      clearInterval(anim.spin);
      ['att', 'def'].forEach(side => dice[side].forEach((el, i) => { el.classList.remove('rolling'); el.querySelector('b').textContent = data[side][i].v; }));
    }, 1100));
    timers.push(setTimeout(() => ['att', 'def'].forEach(side => dice[side].forEach((el, i) => { el.classList.add('sorting'); place(side, el, i); })), 1800));
    const step = Math.max(90, Math.min(420, 3200 / Math.max(1, b.pairs)));
    for (let i = 0; i < b.pairs; i++) timers.push(setTimeout(() => {
      const a = dice.att[i], d = dice.def[i];
      if (data.att[i].tied) { a.classList.add('discard'); d.classList.add('discard'); } else { a.classList.add(data.att[i].lost ? 'lost' : 'won'); d.classList.add(data.def[i].lost ? 'lost' : 'won'); }
      a.classList.add('clash'); d.classList.add('clash');
      const board = a.parentElement; board.scrollTop = 0;
      a.scrollIntoView?.({ block: 'nearest' });
    }, 2700 + i * step));
    timers.push(setTimeout(() => { dice.att.concat(dice.def).forEach((el, i2) => { const side = el.dataset.side, i = Number(el.dataset.i); if (i >= b.pairs) el.classList.add('discard'); }); }, 2700 + b.pairs * step));
    timers.push(setTimeout(() => anim.finish(), 3000 + b.pairs * step));
  }
  function closeAnnouncement() {
    clearTimeout(announceTimer);
    if (battleAnim && !battleAnim.done) { battleAnim.finish(); return; } // first tap skips to the result
    if (announceClosing) return; // ignore extra taps while the card is mid-transition
    const overlay = $('announceOverlay');
    if (overlay.hidden) { showNextAnnouncement(); return; }
    const card = overlay.querySelector('.announce-card');
    const more = announceQueue.length > 0;
    // More popups waiting: fade the card out and straight into the next one, no gap. Otherwise fade the whole overlay away.
    if (more) { card.classList.remove('swap-in'); card.classList.add('swap-out'); } else overlay.classList.add('is-leaving');
    announceClosing = true;
    setTimeout(() => { announceClosing = false; overlay.classList.remove('is-leaving'); card.classList.remove('swap-out'); showNextAnnouncement(); }, 260);
  }

  // House dropdowns: the real <select> stays hidden (value + change events), a custom list shows each house's banner and colour, ordered by house.
  const HOUSE_SELECTS = ['allianceTarget', 'treatyTarget', 'decreeTarget', 'spyTarget', 'giftTarget', 'newHandSelect', 'handPlayerSelect'];
  const houseIndex = id => { const i = (state?.houses || []).findIndex(h => h.id === id); return i < 0 ? 99 : i; };
  const houseOfValue = value => {
    const house = state.houses.find(x => x.id === value);
    if (house) return house;
    const player = state.players.find(x => x.id === value);
    return player ? state.houses.find(x => x.id === player.houseId) || null : null;
  };
  function closeHouseDrops(except) { document.querySelectorAll('.hdrop.open').forEach(d => { if (d !== except) d.classList.remove('open'); }); }
  document.addEventListener('click', event => { if (!event.target.closest('.hdrop')) closeHouseDrops(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeHouseDrops(); });
  function updateSelectBanners() {
    if (!state?.houses) return;
    for (const id of HOUSE_SELECTS) {
      const sel = $(id); if (!sel) continue;
      let dd = sel.nextElementSibling?.classList?.contains('hdrop') ? sel.nextElementSibling : null;
      if (!dd) {
        dd = document.createElement('div'); dd.className = 'hdrop';
        dd.innerHTML = '<button type="button" class="hdrop-btn" aria-haspopup="listbox"></button><div class="hdrop-list" role="listbox"></div>';
        sel.classList.add('hdrop-native'); sel.after(dd);
        dd.querySelector('.hdrop-btn').addEventListener('click', () => { if (sel.disabled) return; const open = !dd.classList.contains('open'); closeHouseDrops(dd); dd.classList.toggle('open', open); });
        dd.querySelector('.hdrop-list').addEventListener('click', event => {
          const item = event.target.closest('.hdrop-item'); if (!item || item.dataset.disabled) return;
          sel.value = item.dataset.value; sel.dispatchEvent(new Event('change', { bubbles: true })); dd.classList.remove('open'); updateSelectBanners();
        });
      }
      const items = [...sel.options].map(o => ({ o, house: houseOfValue(o.value) }));
      items.sort((x, y) => (x.house ? 1 : 0) - (y.house ? 1 : 0) || (x.house ? houseIndex(x.house.id) - houseIndex(y.house.id) : 0));
      const row = ({ o, house }) => `${house ? houseBanner(house, 'msg-banner') : ''}<span>${escapeHtml(o.textContent)}</span>`;
      const cur = sel.selectedOptions[0];
      const curHouse = cur ? houseOfValue(cur.value) : null;
      const btn = dd.querySelector('.hdrop-btn');
      btn.innerHTML = cur ? row({ o: cur, house: curHouse }) : '<span class="muted">—</span>';
      btn.disabled = sel.disabled;
      dd.style.setProperty('--house-color', curHouse?.color || '');
      dd.classList.toggle('has-house', Boolean(curHouse));
      dd.querySelector('.hdrop-list').innerHTML = items.map(it => `<div class="hdrop-item ${it.o.value === sel.value ? 'sel' : ''}" role="option" data-value="${escapeHtml(it.o.value)}"${it.o.disabled ? ' data-disabled="1"' : ''} style="--house-color:${escapeHtml(it.house?.color || '#888')}">${row(it)}</div>`).join('');
    }
  }
  function limitOptions(want) {
    const mode = $('gameTypeInput').value;
    const lo = mode === 'TEAMS' ? 4 : 3, hi = mode === 'CLASSIC' ? 8 : mode === 'LAST_DRAGON' ? 7 : 16;
    const sel = $('maxPlayersInput'), keep = Number(want) || Number(sel.value) || (mode === 'CLASSIC' ? 8 : mode === 'LAST_DRAGON' ? 7 : 8);
    sel.innerHTML = Array.from({ length: hi - lo + 1 }, (_, i) => i + lo).map(n => `<option value="${n}">${n} players</option>`).join('');
    sel.value = String(Math.min(hi, Math.max(lo, keep)));
  }
  function updateDragonSetup() {
    const ld = $('gameTypeInput').value === 'LAST_DRAGON';
    const teams = $('gameTypeInput').value === 'TEAMS';
    $('dragonSetup').hidden = !ld;
    $('teamSetup').hidden = !teams;
    const max = Math.max(1, Math.floor(Number($('maxPlayersInput').value || 10) / 2));
    const sel = $('dragonCountInput'), keep = Number(sel.value) || Number(state?.settings?.dragonCount) || 1;
    sel.innerHTML = Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${plural(i + 1, 'Dragon')}</option>`).join('');
    sel.value = String(Math.min(keep, max));
    if (!$('dragonRoundsInput').dataset.set) { $('dragonRoundsInput').value = String(state?.settings?.dragonRounds || 5); $('dragonRoundsInput').dataset.set = '1'; }
    $('gameTypeNote').textContent = ld
      ? 'Targaryen is not a house in this mode. Secret Dragons are picked at random from the players. If they survive the set number of rounds or one takes the throne, they win. If they are all defeated first, the whole realm wins.'
      : teams ? 'Players join teams that share a house. Teams must be as even as possible. The last team standing wins.'
      : 'Each player picks their own house and it is locked. Defeat every other house to win.';
  }
  $('crownDialog')?.addEventListener('cancel', e => e.preventDefault());
  function renderCrownOffer() {
    const dlg = $('crownDialog'); if (!dlg) return;
    const offered = Boolean(state?.crownOffer) && !state.gameOver;
    if (offered && !dlg.open) dlg.showModal();
    else if (!offered && dlg.open) dlg.close();
  }
  let gameOverShownFor = '';
  let roleRevealShown = false;
  function renderEndgame() {
    const note = $('dragonNote');
    const ld = state?.settings?.gameType === 'LAST_DRAGON';
    const live = ['ACTION', 'COURT', 'RESOLUTION'].includes(state?.phase) && !state?.gameOver;
    let text = '';
    if (live && state.me?.eliminated) text = 'You have been eliminated when the throne fell. You can still watch and speak at court.';
    else if (live && state.isKing && !state.hand) text = 'You hold King’s Landing and wear the crown. Appoint your Hand from Relations → Decrees.' + (text ? ' ' + text : '');
    if (live && state.myHouse?.fallen) text = 'Your house has fallen. You can still watch and speak at court.' + (text ? ' ' + text : '');
    note.hidden = !text; note.textContent = text;
    if (state?.phase === 'LOBBY') roleRevealShown = false;
    if (ld && state?.me?.houseId && state.phase !== 'LOBBY' && !state.gameOver && !roleRevealShown) {
      roleRevealShown = true;
      announceQueue.push({ reveal: { dragon: Boolean(state.dragon), fellow: state.dragon?.fellow || [], houseId: state.me.houseId, count: state.settings.dragonCount } });
      if (!announceShowing) showNextAnnouncement();
    }
    const go = state?.gameOver;
    if (!go) { gameOverShownFor = ''; return; }
    if (live === false && go) { note.hidden = false; note.textContent = go.text; }
    const key = go.type + go.text;
    if (gameOverShownFor === key) return;
    gameOverShownFor = key;
    announceQueue.push({ gameover: go });
    if (!announceShowing) showNextAnnouncement();
  }
  function render() {
    updateScreens();
    applyTheme();
    if (!state) return;
    applyRuleVisibility();
    tickPhaseTimer();
    if ($('advDialog').open) renderAdvPlayers();
    if (!$('playerMenu').hidden) renderPlayerMenu();
    // Preserve all form selections and text while another player causes a shared-state update.
    const savedValues = {};
    document.querySelectorAll('input[id], select[id], textarea[id]').forEach(element => {
      savedValues[element.id] = element.value;
    });
    const wasFocused = document.activeElement?.id;
    const selectionStart = wasFocused && typeof document.activeElement.selectionStart === 'number' ? document.activeElement.selectionStart : null;

    const loggedIn = Boolean(state.me);
    if (!loggedIn) return;
    claimPickedHouse();

    renderWaitingRoom();
    checkNotices(); // event notices first (siege, sacked...), then the victory/defeat screen, then new king/Hand
    renderEndgame();
    renderCrownOffer();
    checkRoleChanges();
    if (state.phase === 'HAND_SELECTION') {
      renderKingSelection();
      updateSelectBanners();
      updateRoundPill();
      return;
    }
    renderPhase();
    renderRoundOverview();
    renderRoundActions();
    renderAlliances();
    renderChat();
    renderEvents();
    renderHub();
    renderMap();
    checkDecreePopup();
    maybePromptHand();

    for (const [id, value] of Object.entries(savedValues)) {
      const element = $(id);
      if (!element) continue;
      if (element.tagName === 'SELECT') {
        if ([...element.options].some(option => option.value === value)) element.value = value;
      } else {
        element.value = value;
      }
    }
    updateSelectBanners();
    updateRecruitButton();
    if (state.myHouse) { updateAttackLock(); updateSpyForm(); updateDisbandButton(); }
    window.__wheels?.refresh(state);
    if (wasFocused) {
      const element = $(wasFocused);
      if (element && !element.disabled) {
        element.focus({ preventScroll: true });
        if (selectionStart !== null && element.setSelectionRange && element.type !== 'number') element.setSelectionRange(selectionStart, selectionStart);
      }
    }
  }

  updateScreens();

  if (!socket) {
    setConnection(false, 'Socket.IO failed to load');
    showToast('The realtime client library did not load. Check your internet connection or CDN access.', 'error');
  } else {
    const forgetSaved = () => { savedCode = ''; localStorage.removeItem(roomCodeKey); localStorage.removeItem(usernameKey); };
    const offerReturn = () => {
      if (!savedCode || gameCode) return;
      const code = savedCode;
      let answered = false;
      socket.emit('check-room', { pin: code }, result => {
        answered = true;
        if (!result?.ok) return forgetSaved();
        $('returnCode').textContent = code;
        $('returnOverlay').hidden = false;
      });
      setTimeout(() => { if (!answered) forgetSaved(); }, 4000);
    };
    $('returnYes').addEventListener('click', () => {
      $('returnOverlay').hidden = true;
      gameCode = savedCode; savedCode = '';
      setThronePage('house');
      if (socket.connected) socket.emit('join-game-room', { pin: gameCode, clientToken }, result => {
        if (!result?.ok) { gameCode = ''; forgetSaved(); setThronePage('entry'); render(); showToast(result?.message || 'That game is no longer available.', 'error'); return; }
        socket.emit('request-state');
        const savedName = localStorage.getItem(usernameKey);
        if (savedName) socket.emit('login', { username: savedName, clientToken }, r => { if (!r?.ok) showToast(r?.message || 'Could not restore your session.', 'error'); });
      });
      render();
    });
    $('returnNo').addEventListener('click', () => { $('returnOverlay').hidden = true; forgetSaved(); });
    socket.on('connect', () => {
      // Only show green once the server really answers; a half-open connection gets reset.
      setConnection(false, 'Connecting');
      let alive = false;
      socket.emit('check-room', { pin: '0000' }, () => {
        alive = true; setConnection(true, 'Connected to server');
        if (hostPending) hostGame();
      });
      setTimeout(() => { if (!alive && socket.connected) { socket.disconnect(); socket.connect(); } }, 4000);
      if (!gameCode) offerReturn();
      const restoreSession = () => {
        socket.emit('request-state');
        const savedName = gameCode ? localStorage.getItem(usernameKey) : null;
        if (savedName) socket.emit('login', { username: savedName, clientToken }, result => {
          if (!result?.ok) showToast(result?.message || 'Could not restore your session.', 'error');
        });
        else if (gameCode && pickedHouse && enteredName) doLogin(enteredName);
      };
      if (gameCode) socket.emit('join-game-room', { pin: gameCode, clientToken }, result => {
        if (!result?.ok) {
          gameCode = '';
          localStorage.removeItem(roomCodeKey);
          localStorage.removeItem(usernameKey);
          setThronePage('entry');
          render();
          showToast(result?.message || 'That game PIN is no longer available.', 'error');
          return;
        }
        restoreSession();
      });
      else restoreSession();
    });
    socket.on('disconnect', () => setConnection(false, 'Disconnected — reconnecting'));
    socket.on('connect_error', () => setConnection(false, 'Server unavailable'));
    socket.on('state', nextState => {
      state = nextState;
      render();
      sendHousesToThrone();
    });
    socket.on('game-ended', ({ message } = {}) => {
      gameCode = '';
      state = null;
      localStorage.removeItem(roomCodeKey);
      localStorage.removeItem(usernameKey);
      setPickedHouse(null);
      setThronePage('entry');
      $('throneFrame')?.contentWindow?.postMessage({ type: 'iron-throne:reset' }, location.origin === 'null' ? '*' : location.origin);
      render();
      showToast(message || 'The host did not reconnect in time. This game has ended.', 'error');
    });
  }

  // Host a new game. If the socket is still waking up (or silently dead), wait for it and retry instead of doing nothing.
  let hostPending = false, hostTimer = 0;
  function throneSay(message) { $('throneFrame')?.contentWindow?.postMessage({ type: 'iron-throne:mode-error', message }, location.origin === 'null' ? '*' : location.origin); }
  function hostGame(retry = 0) {
    if (!socket) return throneSay('The game server library did not load. Refresh the page.');
    if (!socket.connected) { hostPending = true; throneSay('Waking the server… your game opens as soon as it connects.'); return; }
    hostPending = false;
    let answered = false;
    clearTimeout(hostTimer);
    hostTimer = setTimeout(() => {
      if (answered) return;
      if (retry < 2) { setConnection(false, 'Reconnecting'); hostPending = true; socket.disconnect(); socket.connect(); throneSay('Still connecting… one moment.'); }
      else throneSay('The server did not answer. Please try again.');
    }, 6000);
    socket.emit('create-game-room', { clientToken }, result => {
      answered = true; clearTimeout(hostTimer);
      if (!result?.ok || !result.pin) return throneSay(result?.message || 'Could not create a game.');
      gameCode = result.pin;
      localStorage.setItem(roomCodeKey, gameCode);
      localStorage.removeItem(usernameKey);
      setPickedHouse(null);
      preparingHost = true;
      showHostSetup = true;
      render();
    });
  }

  // Messages from the throne screen (same site only).
  window.addEventListener('message', event => {
    const frame = $('throneFrame');
    if (!frame || event.source !== frame.contentWindow || !event.data) return;
    if (event.data.type === 'iron-throne:ready') sendHousesToThrone();
    if (event.data.type === 'iron-throne:host') hostGame();
    if (event.data.type === 'iron-throne:join-pin' && typeof event.data.pin === 'string') {
      const pin = event.data.pin.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (pin.length !== 4) return frame.contentWindow.postMessage({ type: 'iron-throne:mode-error', message: 'Enter the complete four-character game PIN.' }, location.origin === 'null' ? '*' : location.origin);
      if (!socket?.connected) return frame.contentWindow.postMessage({ type: 'iron-throne:mode-error', message: 'Connecting to the game server. Try again in a moment.' }, location.origin === 'null' ? '*' : location.origin);
      socket.emit('join-game-room', { pin, clientToken }, result => {
        if (!result?.ok) return frame.contentWindow.postMessage({ type: 'iron-throne:mode-error', message: result?.message || 'Could not join that game.' }, location.origin === 'null' ? '*' : location.origin);
        gameCode = result.pin;
        localStorage.setItem(roomCodeKey, gameCode);
        localStorage.removeItem(usernameKey);
        setPickedHouse(null);
        showHostSetup = false;
        transitionThrone('house');
        render();
        sendHousesToThrone();
      });
    }
    if (event.data.type === 'iron-throne:back') backToEntry();
    if (event.data.type === 'iron-throne:pick' && typeof event.data.house === 'string') {
      setPickedHouse({ key: normHouse(event.data.house).slice(0, 40), name: String(event.data.name || event.data.house).slice(0, 60) });
      if (state?.me) changingLobbyHouse = false;
      if (!enteredName) nameDismissed = false;
      render();
      if (!state?.me && gameCode && enteredName) doLogin(enteredName);
    }
  });
  $('throneFrame')?.addEventListener('load', sendHousesToThrone);

  function doLogin(username) {
    if (!socket?.connected) { showToast(`Cannot reach ${SERVER_URL}. Check your connection and try again.`, 'error'); return; }
    socket.emit('login', { username, clientToken }, result => {
      if (!result?.ok) {
        // Most often the name is already used in this lobby: ask for another one on the name card.
        enteredName = '';
        nameDismissed = false;
        $('nameEntryInput').value = username; $('nameEntryInput').dataset.filled = '1';
        $('nameError').textContent = result?.message || 'Could not join the game.';
        render();
        return;
      }
      localStorage.setItem(usernameKey, username);
      enteredName = username;
      showToast(result.message || 'Welcome to the realm.', 'success');
      socket.emit('request-state');
    });
  }

  // Back out of the opening screens: X button, Escape, or a click outside the card.
  function resetThrone() {
    $('throneFrame')?.contentWindow?.postMessage({ type: 'iron-throne:reset' }, location.origin === 'null' ? '*' : location.origin);
    sendHousesToThrone();
  }
  function closeNameScreen() {
    nameDismissed = true;
    $('nameError').textContent = '';
    if (!state?.me && pickedHouse) { setPickedHouse(null); resetThrone(); }
    render();
  }
  function backToEntry() {
    if (state?.me) { changingLobbyHouse = false; render(); return; }
    gameCode = '';
    try { localStorage.removeItem(roomCodeKey); localStorage.removeItem(usernameKey); } catch (e) { /* storage unavailable */ }
    showHostSetup = false;
    preparingHost = false;
    setPickedHouse(null);
    setThronePage('entry');
    render();
  }
  [['nameScreen', closeNameScreen], ['hostSetupScreen', () => { if (!state?.me) backToEntry(); }]].forEach(([id, close]) => {
    const screen = $(id);
    let downOnBackdrop = false;
    screen.addEventListener('pointerdown', e => { downOnBackdrop = e.target === screen; });
    screen.addEventListener('click', e => { if (e.target === screen && downOnBackdrop) close(); downOnBackdrop = false; });
    screen.querySelector('[data-screen-x]')?.addEventListener('click', close);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('nameScreen').hidden) closeNameScreen();
    else if (!$('hostSetupScreen').hidden && !state?.me) backToEntry();
  });
  $('nameForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('nameEntryInput').value.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 22) { $('nameError').textContent = 'Name must be between 2 and 22 characters.'; return; }
    $('nameError').textContent = '';
    enteredName = name;
    try { if ($('rememberNameInput').checked) localStorage.setItem(savedNameKey, name); else localStorage.removeItem(savedNameKey); } catch (e) { /* storage unavailable */ }
    render();
    if (gameCode && pickedHouse && !state?.me) doLogin(name);
  });
  $('gameTypeInput').addEventListener('change', () => { limitOptions(); updateDragonSetup(); });
  $('maxPlayersInput').addEventListener('change', updateDragonSetup);
  $('hostSetupForm').addEventListener('submit', event => {
    event.preventDefault();
    $('hostSetupError').textContent = '';
    const settings = { ...advDraft, maxPlayers: Number($('maxPlayersInput').value), gameType: $('gameTypeInput').value, teamSize: Number($('teamSizeInput').value || 2), dragonCount: Number($('dragonCountInput').value || 1), dragonRounds: Number($('dragonRoundsInput').value || 5), friendlyFire: $('friendlyFireInput').checked };
    socket.emit(preparingHost ? 'set-room-settings' : 'set-game-settings', preparingHost ? { ...settings, clientToken } : settings, result => {
      if (!result?.ok) $('hostSetupError').textContent = result?.message || 'Could not save game setup.';
      else {
        showToast(result.message || 'Game setup saved.', 'success');
        if (preparingHost) {
          preparingHost = false;
          showHostSetup = false;
          transitionThrone('house');
          render();
          sendHousesToThrone();
        }
      }
    });
  });
  $('startGameButton').addEventListener('click', () => emitAction('start-game'));
  $('handSelectionForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('appoint-hand', { playerId: $('handPlayerSelect').value });
  });
  $('handPlayerSelect').addEventListener('change', event => {
    lock($('handSelectionForm').querySelector('button[type="submit"]'), event.target.value ? '' : 'Choose a player to appoint first.');
  });
  $('lobbyNameForm').addEventListener('submit', event => {
    event.preventDefault();
    const username = $('lobbyNameInput').value.trim();
    if (!socket?.connected) return showToast('Not connected to the game server yet.', 'error');
    socket.emit('edit-player-name', { username }, result => {
      if (!result?.ok) return showToast(result?.message || 'Could not update your name.', 'error');
      $('lobbyNameDialog').close();
      enteredName = username;
      try { if ($('lobbyRememberInput').checked) localStorage.setItem(savedNameKey, username); else localStorage.removeItem(savedNameKey); } catch (e) { /* storage unavailable */ }
      showToast(result.message || 'Name updated.', 'success');
    });
  });

  $('botEditForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!socket?.connected) return showToast('Not connected to the game server yet.', 'error');
    socket.emit('edit-bot', { botId: editingBotId, username: $('botNameInput').value.trim(), houseId: $('botHouseSelect').value }, result => {
      if (!result?.ok) return showToast(result?.message || 'Could not update the bot.', 'error');
      $('botEditDialog').close();
      showToast(result.message || 'Bot updated.', 'success');
    });
  });
  // Clicking the dimmed backdrop closes the map.
  $('mapDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) return setMapOpen(false);
    const armyEl = event.target.closest('.army-piece');
    if (armyEl) return armyClicked(armyEl.dataset);
    if (pickingTarget) {
      const pick = event.target.closest('.map-cap');
      if (pick) {
        const capital = state.capitals.find(c => c.id === pick.dataset.capital);
        if (!capital) return showMapHint('The Red Keep and King’s Landing cannot be attacked. Choose a house capital.');
        const problem = warTargetProblem(capital);
        if (problem) return showMapHint(problem);
        warTargetId = capital.id;
        showMapHint('War map: tap a highlighted city to march on it.');
        renderWarTarget();
        updateAttackLock();
        renderMapUnits();
        $('warPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
    }
    // Tap a capital to pop it out on touch screens; tapping elsewhere puts it back.
    const cap = event.target.closest('.map-cap');
    $('mapDialog').querySelectorAll('.map-cap.is-active').forEach(el => { if (el !== cap) el.classList.remove('is-active'); });
    if (cap) { cap.classList.toggle('is-active'); cap.parentNode.appendChild(cap); }
  });
  // Keep the hovered capital on top of its neighbours.
  $('mapDialog').addEventListener('pointerover', event => {
    const cap = event.target.closest('.map-cap');
    if (cap && cap.parentNode.lastElementChild !== cap) cap.parentNode.appendChild(cap);
  });

  $('mapDialog').addEventListener('close', endPick);
  $('decreeOverlay').addEventListener('click', event => { if (event.target === event.currentTarget) $('decreeOverlay').hidden = true; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('mapDialog').open) closeHub();
  });

  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-chat-tab]');
    if (tab) {
      activeChatTab = tab.dataset.chatTab;
      renderChat();
      const log = $(activeChatTab === 'public' ? 'publicChat' : 'secretChat');
      log.scrollTop = log.scrollHeight;
      updateBadges();
      return;
    }
    const chip = event.target.closest('[data-recipient]');
    if (chip) {
      const id = chip.dataset.recipient;
      const others = chatOthers();
      if (id === '__all') { if (selectedRecipients.size === others.length) selectedRecipients.clear(); else others.forEach(p => selectedRecipients.add(p.id)); }
      else if (selectedRecipients.has(id)) selectedRecipients.delete(id);
      else selectedRecipients.add(id);
      renderChat();
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'edit-player') {
      if (document.body.classList.contains('mobile-device')) $('lobbyEditMenu').showModal();
      else if (button.dataset.editKind === 'house') openHouseChooser();
      else openNameEditor();
      return;
    }
    if (action === 'pm-name') { closePlayerMenu(); openNameEditor(); return; }
    if (action === 'pm-host') { closePlayerMenu(); openAdvanced('live'); return; }
    if (action === 'pm-leave') { closePlayerMenu(); if (window.confirm('Leave this game?')) $('logoutButton').click(); return; }
    if (action === 'adv-open-setup') { openAdvanced('setup'); return; }
    if (action === 'adv-close') { $('advDialog').close(); return; }
    if (action === 'adv-mute') { emitAction('mute-player', { playerId: button.dataset.playerId, muted: button.dataset.muted === '1' }); return; }
    if (action === 'adv-kick') { const t = state?.players?.find(p => p.id === button.dataset.playerId); if (t && window.confirm(`Remove ${t.username} from the game?`)) emitAction('kick-player', { playerId: t.id }); return; }
    if (action === 'edit-menu-name') { openNameEditor(); return; }
    if (action === 'edit-menu-house') { openHouseChooser(); return; }
    if (action === 'close-edit-menu') { $('lobbyEditMenu').close(); return; }
    if (action === 'close-name-dialog') { $('lobbyNameDialog').close(); return; }
    if (action === 'add-bot') { emitAction('add-bot'); return; }
    if (action === 'edit-bot') { openBotEditor(button.dataset.botId); return; }
    if (action === 'kick-player') {
      const target = state?.players?.find(p => p.id === button.dataset.playerId);
      if (target && window.confirm(`Remove ${target.username} from the game?`)) emitAction('kick-player', { playerId: target.id });
      return;
    }
    if (action === 'remove-bot') { removeBot(button.dataset.botId); return; }
    if (action === 'remove-bot-dialog') { $('botEditDialog').close(); removeBot(editingBotId); return; }
    if (action === 'close-bot-dialog') { $('botEditDialog').close(); return; }
    if (action === 'open-hub') {
      if (state?.phase === 'COURT') { if (button.dataset.hub === 'relations') openHub('relations', 'messages'); return; }
      openHub(button.dataset.hub); return;
    }
    if (action === 'open-sub') { if (state?.phase === 'COURT' && button.dataset.sub !== 'messages') return; showSub(button.dataset.sub); return; }
    if (action === 'sub-back') { if (state?.phase === 'COURT') { closeHub(); return; } showSub(null); return; }
    if (action === 'close-hub') { closeHub(); return; }
    if (action === 'close-announce') { closeAnnouncement(); return; }
    if (action === 'toggle-traitor') { emitAction('mark-traitor', { playerId: button.dataset.playerId, traitor: button.dataset.traitor === 'true' }); return; }
    if (action === 'gold-info') return;
    if (action === 'attack-mode') { attackMode = button.dataset.v || 'infantry'; applyAttackMode(); updateAttackLock(); renderMapUnits(); return; }
    if (action === 'ledger-filter') { ledgerFilter = button.dataset.filter || 'all'; renderHub(); return; }
    if (action === 'toggle-ledger') { ledgerAll = !ledgerAll; renderHub(); return; }
    if (action === 'close-decree-popup') { $('decreeOverlay').hidden = true; return; }
    if (action === 'cancel-march') { emitAction('cancel-march', { marchId: button.dataset.marchId }); return; }
    if (action === 'withdraw-army') { emitAction('withdraw-army', { capitalId: warTargetId }); return; }
    if (action === 'war-cancel') { warTargetId = null; renderWarTarget(); updateAttackLock(); renderMapUnits(); return; }
    if (action === 'open-map') { setMapOpen(true); return; }
    if (action === 'forfeit-crown') { if (window.confirm('Forfeit the crown? You return to your home city. The Hand may take the throne, or the first army to reach King’s Landing will take it unopposed.')) emitAction('forfeit-crown'); return; }
    if (action === 'crown-take') { $('crownDialog').close(); emitAction('crown-choice', { accept: true }); return; }
    if (action === 'crown-refuse') { $('crownDialog').close(); emitAction('crown-choice', { accept: false }); return; }
    if (action === 'reset-game') { emitAction('reset-game'); return; }
    if (action === 'map-zoom-reset') { applyMapZoom(1, false); const vp = $('mapViewport'); vp.scrollLeft = 0; vp.scrollTop = 0; return; }
    if (action === 'close-map') { setMapOpen(false); return; }
    if (action === 'change-house') {
      setPickedHouse(null);
      $('throneFrame')?.contentWindow?.postMessage({ type: 'iron-throne:reset' }, location.origin === 'null' ? '*' : location.origin);
      sendHousesToThrone();
      render();
      return;
    }
    if (action === 'select-house') emitAction('select-house', { houseId: button.dataset.houseId });
    else if (action === 'start-game') emitAction('start-game');
    else if (action === 'toggle-ready') emitAction('toggle-ready');
    else if (action === 'advance-phase') {
      const rd = state?.ready;
      if (rd && rd.mode === 'bypass' && rd.ready < rd.total && !window.confirm(`Only ${rd.ready} of ${rd.total} players are ready. Move on anyway?`)) return;
      emitAction('advance-phase', { force: true });
    }
    else if (action === 'respond-alliance') emitAction('respond-alliance', { offerId: button.dataset.offerId, accept: button.dataset.accept === 'true' });
    else if (action === 'break-alliance') emitAction('break-alliance', { allianceId: button.dataset.allianceId });
    else if (action === 'respond-decree') {
      $('decreeOverlay').hidden = true;
      emitAction('respond-decree', { decreeId: button.dataset.decreeId, comply: true });
    }
    else if (action === 'respond-treaty') emitAction('respond-treaty', { treatyId: button.dataset.treatyId, accept: button.dataset.accept === 'true' });
    else if (action === 'cancel-treaty') emitAction('cancel-treaty', { treatyId: button.dataset.treatyId });
    else if (action === 'claim-spoils') emitAction('claim-spoils', { spoilId: button.dataset.spoilId, claimHouseId: button.dataset.claim });
  });


  $('recruitForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('purchase', { unit: $('unitSelect').value, amount: Number($('unitAmount').value) });
  });
  $('unitSelect').addEventListener('change', updateRecruitButton);
  $('unitAmount').addEventListener('input', updateRecruitButton);

  $('disbandUnit').addEventListener('change', updateDisbandButton);
  $('disbandAmount').addEventListener('input', updateDisbandButton);
  $('disbandForm').addEventListener('submit', event => {
    event.preventDefault();
    const unit = $('disbandUnit').value, amount = Number($('disbandAmount').value);
    if (!window.confirm(`Disband ${amount} ${unit === 'navy' ? 'ships' : unit}? This cannot be undone and nothing is refunded.`)) return;
    emitAction('disband', { unit, amount });
  });

  $('spyForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('spy', { targetHouseId: $('spyTarget').value, mission: $('spyMission').value, spend: Number($('spyGold').value) });
  });

  $('attackForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('plan-attack', {
      targetCapitalId: warTargetId,
      ...attackUnits()
    }, () => { warTargetId = null; ['attackInfantry', 'attackNavy', 'attackDragons'].forEach(id => { $(id).value = ''; }); });
  });
  ['attackInfantry', 'attackNavy', 'attackDragons'].forEach(id => $(id).addEventListener('input', updateAttackLock));

  $('treatyForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('offer-treaty', {
      targetHouseId: $('treatyTarget').value,
      gold: Number($('treatyGold').value || 0),
      infantry: Number($('treatyInfantry').value || 0),
      navy: Number($('treatyNavy').value || 0),
      message: $('treatyMessage').value
    }, () => { $('treatyGold').value = 0; $('treatyInfantry').value = 0; $('treatyNavy').value = 0; $('treatyMessage').value = ''; });
  });

  $('allianceForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('offer-alliance', { targetHouseId: $('allianceTarget').value, scope: $('allianceScope').value });
  });

  $('newHandForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('replace-hand', { playerId: $('newHandSelect').value });
  });
  $('decreeForm').addEventListener('submit', event => {
    event.preventDefault();
    const target = $('decreeTarget').value;
    emitAction('issue-decree', {
      targetHouseIds: target ? [target] : [],
      gold: Number($('decreeGold').value || 0), infantry: Number($('decreeInfantry').value || 0), navy: Number($('decreeNavy').value || 0),
      message: $('decreeMessage').value
    }, () => { $('decreeGold').value = 0; $('decreeInfantry').value = 0; $('decreeNavy').value = 0; $('decreeMessage').value = ''; });
  });

  $('chatForm').addEventListener('submit', event => {
    event.preventDefault();
    const message = $('chatMessage').value.trim();
    if (!message) return;
    // The tab you are on decides the type: Public goes to the whole court, Private to the players you chose.
    const scope = activeChatTab === 'secret' ? 'secret' : 'public';
    if (scope === 'secret' && !selectedRecipients.size) return showToast('Choose at least one player to whisper to.', 'error');
    emitAction('send-chat', { scope, targetPlayerIds: [...selectedRecipients], message });
    $('chatMessage').value = '';
  });


  // ---- Personal settings dropdown (press the throne in the corner) ----
  const POPUP_TYPES = [
    { id: 'alliance', label: 'Alliance formed', kinds: ['alliance'] },
    { id: 'alliance-broken', label: 'Alliance broken', kinds: ['alliance-broken'] },
    { id: 'battle', label: 'Battle won or lost', kinds: ['battle-won', 'battle-lost', 'battle-report'] },
    { id: 'attacked', label: 'Your city attacked', kinds: ['attacked'] },
    { id: 'city-fell', label: 'Your city fell', kinds: ['city-fell'] },
    { id: 'siege', label: 'King’s Landing under siege', kinds: ['siege'] },
    { id: 'sacked', label: 'King’s Landing sacked', kinds: ['sacked'] },
    { id: 'crown', label: 'Crown news', kinds: ['crown'] },
    { id: 'king-hand', label: 'New king or Hand', kinds: [] },
    { id: 'decree', label: 'Royal decree sent', kinds: ['decree'] },
    { id: 'spy-caught', label: 'Spies caught', kinds: ['spy-caught'] },
    { id: 'desertion', label: 'Troops deserted', kinds: ['desertion'] },
    { id: 'round-start', label: 'Start-of-round report', kinds: ['round-start', 'round-bad'] },
    { id: 'traitor', label: 'Branded a traitor', kinds: ['traitor'] }
  ];
  const NOTICE_POPUP = Object.fromEntries(POPUP_TYPES.flatMap(t => t.kinds.map(k => [k, t.id])));
  const SETUP_HOUSES = [['stark', 'Stark'], ['lannister', 'Lannister'], ['baratheon', 'Baratheon'], ['targaryen', 'Targaryen'], ['tyrell', 'Tyrell'], ['greyjoy', 'Greyjoy'], ['martell', 'Martell'], ['arryn', 'Arryn']];
  function readPref(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } }
  function writePref(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }
  // A player's own choice (Show / Hide) beats the host's setting; "Default" follows the host.
  function popupAllowed(id) {
    const mine = readPref('warOfWesterosPopupPrefs', {})[id];
    if (mine === 'show') return true;
    if (mine === 'hide') return false;
    return !(state?.settings?.disabledPopups || []).includes(id);
  }
  const schemePref = () => readPref('warOfWesterosScheme', 'auto');

  function closePlayerMenu() { $('playerMenu').hidden = true; }
  function renderPlayerMenu() {
    const me = state?.me;
    $('pmName').textContent = me?.username || '';
    const house = me?.houseId ? state.houses.find(h => h.id === me.houseId) : null;
    $('pmHouse').textContent = house ? `House ${capName(house.name)}` : 'No house yet';
    $('pmView').value = window.PHONE_FRAME ? 'phone' : 'normal';
    $('pmStyle').value = document.documentElement.classList.contains('style-med') ? 'medieval' : 'original';
    const scheme = schemePref();
    $('pmScheme').innerHTML = [['auto', house ? `My house (${capName(house.name)})` : 'My house'], ['none', 'None (classic gold)'], ...state.houses.map(h => [h.id, `House ${capName(h.name)}`])]
      .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === scheme ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
    const prefs = readPref('warOfWesterosPopupPrefs', {});
    $('pmPopupList').innerHTML = POPUP_TYPES.map(t => {
      const off = (state.settings?.disabledPopups || []).includes(t.id);
      return `<div class="pm-popup-row"><span>${escapeHtml(t.label)}</span><select data-popup-pref="${t.id}" aria-label="${escapeHtml(t.label)}"><option value="default" ${!prefs[t.id] ? 'selected' : ''}>Host: ${off ? 'off' : 'on'}</option><option value="show" ${prefs[t.id] === 'show' ? 'selected' : ''}>Always show</option><option value="hide" ${prefs[t.id] === 'hide' ? 'selected' : ''}>Never show</option></select></div>`;
    }).join('');
    $('pmHost').hidden = !state.isHost;
  }
  function togglePlayerMenu() {
    const menu = $('playerMenu');
    if (!menu.hidden) { closePlayerMenu(); return; }
    renderPlayerMenu();
    const r = document.querySelector('.brand-mark').getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 8)}px`;
    menu.style.left = `${Math.max(8, Math.round(r.left))}px`;
    menu.hidden = false;
  }
  $('pmView').addEventListener('change', () => { try { localStorage.setItem('westerosView', $('pmView').value); } catch { /* storage unavailable */ } const clean = location.href.replace(/[?&]phoneframe=1/, m => m.startsWith('?') ? '?' : '').replace(/\?$/, ''); if (window.PHONE_FRAME) window.top.location.href = clean; else location.reload(); });
  $('pmStyle').addEventListener('change', () => { const med = $('pmStyle').value === 'medieval'; document.documentElement.classList.toggle('style-med', med); try { localStorage.setItem('westerosStyle', med ? 'medieval' : 'original'); } catch { /* storage unavailable */ } if (state) { renderHub(); updateRoundPill(); } });
  $('pmScheme').addEventListener('change', () => { writePref('warOfWesterosScheme', $('pmScheme').value); applyTheme(); });
  $('pmPopupList').addEventListener('change', event => {
    const sel = event.target.closest('[data-popup-pref]'); if (!sel) return;
    const prefs = readPref('warOfWesterosPopupPrefs', {});
    if (sel.value === 'default') delete prefs[sel.dataset.popupPref]; else prefs[sel.dataset.popupPref] = sel.value;
    writePref('warOfWesterosPopupPrefs', prefs);
  });
  document.addEventListener('click', event => { if (!$('playerMenu').hidden && !event.target.closest('#playerMenu, .brand-mark')) closePlayerMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePlayerMenu(); });

  // ---- Host advanced settings ----
  let advMode = 'live'; // 'setup': the room is still being created, so the choices ride along with the setup form
  let advDraft = { alliancesEnabled: true, handEnabled: true, houseBuffs: true, disabledHouses: [], disabledPopups: [], roundSeconds: 0, readyMode: 'bypass' };
  const advFrom = src => ({ alliancesEnabled: src.alliancesEnabled !== false, handEnabled: src.handEnabled !== false, houseBuffs: src.houseBuffs !== false, disabledHouses: [...(src.disabledHouses || [])], disabledPopups: [...(src.disabledPopups || [])], roundSeconds: Number(src.roundSeconds || 0), readyMode: ['wait', 'bypass', 'off'].includes(src.readyMode) ? src.readyMode : 'bypass' });
  function renderAdvPlayers() {
    const list = (state?.players || []).filter(p => !p.left && p.id !== state.me?.id);
    $('advPlayersBox').hidden = advMode === 'setup';
    $('advPlayers').innerHTML = list.length ? list.map(p => `<div class="adv-player"><span>${escapeHtml(p.username)}${p.isBot ? ' <small>(bot)</small>' : ''}${p.muted ? ' <small>muted</small>' : ''}</span>${p.isBot ? '' : `<button class="button button-quiet button-small" type="button" data-action="adv-mute" data-player-id="${escapeHtml(p.id)}" data-muted="${p.muted ? '0' : '1'}">${p.muted ? 'Unmute' : 'Mute'}</button>`}<button class="button button-danger button-small" type="button" data-action="adv-kick" data-player-id="${escapeHtml(p.id)}">Remove</button></div>`).join('') : '<p class="muted small-text">No other players yet.</p>';
  }
  function openAdvanced(mode) {
    advMode = mode;
    const src = mode === 'setup' ? (state?.settings?.configured ? advFrom(state.settings) : advDraft) : advFrom(state.settings || {});
    const lobby = mode === 'setup' || state?.phase === 'LOBBY';
    $('advAlliances').checked = src.alliancesEnabled; $('advHand').checked = src.handEnabled; $('advBuffs').checked = src.houseBuffs;
    $('advTimer').value = String(src.roundSeconds); $('advReady').value = src.readyMode;
    if (![...$('advTimer').options].some(o => o.value === String(src.roundSeconds))) { const o = new Option(`${Math.round(src.roundSeconds / 60)} minutes`, String(src.roundSeconds)); $('advTimer').add(o); $('advTimer').value = o.value; }
    $('advHouseList').innerHTML = SETUP_HOUSES.map(([id, name]) => `<label class="check-row"><input type="checkbox" data-adv-house="${id}" ${src.disabledHouses.includes(id) ? '' : 'checked'}> ${name}</label>`).join('');
    $('advPopupList').innerHTML = POPUP_TYPES.map(t => `<label class="check-row"><input type="checkbox" data-adv-popup="${t.id}" ${src.disabledPopups.includes(t.id) ? '' : 'checked'}> ${escapeHtml(t.label)}</label>`).join('');
    $('advRules').disabled = !lobby; $('advHouses').disabled = !lobby; $('advLockNote').hidden = lobby;
    $('advError').textContent = '';
    renderAdvPlayers();
    $('advDialog').showModal();
  }
  $('advForm').addEventListener('submit', event => {
    event.preventDefault();
    const payload = {
      alliancesEnabled: $('advAlliances').checked, handEnabled: $('advHand').checked, houseBuffs: $('advBuffs').checked,
      disabledHouses: [...document.querySelectorAll('[data-adv-house]')].filter(i => !i.checked).map(i => i.dataset.advHouse),
      disabledPopups: [...document.querySelectorAll('[data-adv-popup]')].filter(i => !i.checked).map(i => i.dataset.advPopup),
      roundSeconds: Number($('advTimer').value || 0), readyMode: $('advReady').value
    };
    if (advMode === 'setup') { advDraft = advFrom(payload); $('advDialog').close(); return; }
    if (!socket?.connected) { $('advError').textContent = 'Not connected to the game server yet.'; return; }
    socket.emit('set-advanced-settings', payload, result => {
      if (!result?.ok) $('advError').textContent = result?.message || 'Could not save settings.';
      else { showToast(result.message || 'Game settings saved.', 'success'); $('advDialog').close(); }
    });
  });

  // ---- Rules the host switched off + round countdown ----
  function applyRuleVisibility() {
    const s = state?.settings || {};
    const noAlliances = s.alliancesEnabled === false, noHand = s.handEnabled === false;
    const allianceBtn = document.querySelector('#hubRelations [data-sub="alliances"][data-action="open-sub"]');
    if (allianceBtn) allianceBtn.hidden = noAlliances;
    if (noAlliances && currentSub === 'alliances') showSub(null);
    $('newHandForm').hidden = noHand;
  }
  function tickPhaseTimer() {
    const el = $('phaseTimer');
    const ends = state?.phaseEndsAt;
    if (!ends || state.gameOver || !state.me) { el.hidden = true; return; }
    const left = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
    el.hidden = false;
    el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    el.classList.toggle('is-low', left <= 15);
  }
  setInterval(tickPhaseTimer, 500);

  $('homeLink').addEventListener('click', event => {
    event.preventDefault();
    if (state?.me && event.target.closest('.brand-mark')) { togglePlayerMenu(); return; }
    if (!window.confirm('Return to the start page? You will leave this game session.')) return;
    localStorage.removeItem(usernameKey);
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(roomCodeKey);
    gameCode = '';
    setPickedHouse(null);
    const makePart = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
    clientToken = `${makePart()}-${makePart()}`;
    localStorage.setItem(tokenKey, clientToken);
    if (socket?.connected) socket.emit('logout-player', {}, () => window.location.reload());
    setTimeout(() => window.location.reload(), 500);
  });

  $('logoutButton').addEventListener('click', () => {
    if (socket?.connected) socket.emit('logout-player', {}, () => {});
    localStorage.removeItem(usernameKey);
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(roomCodeKey);
    gameCode = '';
    state = state ? { ...state, me: null, myHouse: null } : null;
    setPickedHouse(null);
    setThronePage('entry');
    $('throneFrame')?.contentWindow?.postMessage({ type: 'iron-throne:reset' }, location.origin === 'null' ? '*' : location.origin);
    render();
    // Prepare a fresh guest identity on this browser; the server keeps the old player slot disconnected.
    const makePart = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
    clientToken = `${makePart()}-${makePart()}`;
    localStorage.setItem(tokenKey, clientToken);
    showToast('Signed out in this browser.', 'normal');
  });
})();
