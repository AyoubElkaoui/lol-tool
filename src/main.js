// Electron hoofdproces: verbindt met de League-client, volgt ban/pick-fase,
// haalt runes/items/spells/matchup op en zet alles automatisch in de client.

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { LcuClient } = require("./lcu");
const dd = require("./ddragon");
const lol = require("./lolalytics");
const ugg = require("./ugg");
const apply = require("./apply");
const guide = require("./guide");
const an = require("./analysis");
const picks = require("./picks");
const update = require("./update");

const lcu = new LcuClient();
let win = null;

const PROFILES = {
  ayoub: { name: "Ayoub", lane: "top", pool: ["irelia", "teemo", "jax"] },
  danny: { name: "Danny", lane: "jungle", pool: ["fiddlesticks", "nocturne", "leesin", "udyr", "masteryi"] },
};

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
let settings = { profile: "ayoub", tier: "gold_plus", autoRunes: true, autoItems: true, autoSpells: false, autoHover: true, autoAccept: false, alwaysOnTop: false, runeChoice: "pick", flashKey: "d" };
function loadSettings() { try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) }; } catch { /* defaults */ } }
function saveSettings() { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); }

const blank = () => ({
  me: null, lane: null, enemy: null, enemies: [], team: null, bans: null, inBan: false, picks: null, locked: false,
  runes: null, items: null, teamBuild: null, spells: null, skills: null, guide: null,
  applied: { runes: null, items: null, spells: null },
});
const state = { client: "zoeken", phase: "None", ...blank(), postgame: null, profiles: PROFILES, log: [], data: null, update: null, myStats: {} };
let autoPickId = 0, autoBanId = 0, autoTried = "";
let lastKey = "", lastBanKey = "", lastPickKey = "", busy = false, acceptedId = null, eogShown = null;

function log(msg) { state.log = [`${new Date().toLocaleTimeString("nl-NL")}  ${msg}`, ...state.log].slice(0, 60); push(); }
function push() { if (win && !win.isDestroyed()) win.webContents.send("state", { ...state, settings }); }

const LANE = { top: "top", jungle: "jungle", middle: "middle", bottom: "bottom", utility: "support" };
const BOOTS = new Set([1001, 3005, 3006, 3009, 3010, 3020, 3047, 3111, 3117, 3158]);
const isBoot = (id) => BOOTS.has(Number(id));
const FLASH = 4;

// Eerste spell zit op D, tweede op F: Flash komt op de toets die de speler gewend is.
function orderSpells(ids) {
  const at = ids.indexOf(FLASH);
  const want = settings.flashKey === "f" ? 1 : 0;
  return at < 0 || at === want ? ids : [...ids].reverse();
}

async function countersFor(slug, lane, patch) {
  try { return (await lol.counters({ patch, slug, lane, tier: settings.tier })).list; } catch { return []; }
}

// Gebande en gekozen champions.
function takenIds(session) {
  const taken = new Set();
  for (const a of (session.actions || []).flat()) if (a.completed && a.championId > 0) taken.add(a.championId);
  for (const p of [...(session.myTeam || []), ...(session.theirTeam || [])]) if (p.championId > 0) taken.add(p.championId);
  return taken;
}

// Patch-keuze + wat de app laat zien over de versheid van de data.
async function refreshData() {
  const latest = await dd.lolalyticsPatch();
  const { patch, n } = await lol.resolvePatch(latest, "irelia", "top", settings.tier);
  state.data = { patch, latest, games: n, tier: settings.tier };
  return patch;
}

async function refreshMyStats() {
  try { state.myStats = picks.myStats(await lcu.get("/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=99")); push(); }
  catch { /* geen historie: rijen tonen dan alleen de data */ }
}

async function checkUpdate() {
  try { state.update = await update.check(app.getVersion()); push(); } catch { /* offline */ }
}

// ---------- ban-fase ----------
async function processBans(session, champs, patch) {
  const myCell = session.localPlayerCellId;
  const meRow = (session.myTeam || []).find((p) => p.cellId === myCell);
  const lane = LANE[meRow?.assignedPosition] || PROFILES[settings.profile].lane;
  const taken = takenIds(session);
  const hovers = (session.theirTeam || []).map((p) => p.championPickIntent || p.championId).filter((x) => x > 0);
  const key = `${lane}|${[...taken].sort().join(",")}|${hovers.join(",")}|${meRow?.championPickIntent || 0}`;
  if (key === lastBanKey) return;
  lastBanKey = key;
  const pool = [...PROFILES[settings.profile].pool];
  // Hover je een champ buiten je pool, dan telt die mee (zodat het ook werkt als je iets anders speelt).
  const myHover = champs[meRow?.championPickIntent || meRow?.championId || 0];
  if (myHover && !pool.includes(myHover.lolaSlug)) pool.unshift(myHover.lolaSlug);
  const poolCounters = [];
  for (const slug of pool) poolCounters.push({ slug, list: await countersFor(slug, lane, patch) });
  state.bans = { lane, ...an.banAdvice({ poolCounters, lane, taken, champs, enemyHovers: hovers }), pool };
  state.lane = lane;
  push();
}

// ---------- pick-fase ----------
async function resolveEnemyLaner(meSlug, lane, enemyIds, champs, patch) {
  const champ = await picks.laneOpponent({ enemyIds, lane, champs, patch, tier: settings.tier });
  if (!champ) return null;
  const row = (await countersFor(meSlug, lane, patch)).find((r) => r.cid === champ.id) || null;
  return { champ, row };
}

// Counter picks / blind pick: alleen zolang je nog niet gelockt hebt.
async function processCounterPicks(session, champs, patch) {
  const myCell = session.localPlayerCellId;
  const meRow = (session.myTeam || []).find((p) => p.cellId === myCell);
  if (!meRow) return;
  const myPicks = (session.actions || []).flat().filter((a) => a.type === "pick" && a.actorCellId === myCell);
  state.locked = myPicks.length ? myPicks.every((a) => a.completed) : meRow.championId > 0;
  if (state.locked) return;
  const myHoverId = meRow.championPickIntent || meRow.championId || 0;
  const lane = LANE[meRow.assignedPosition] || PROFILES[settings.profile].lane;
  const taken = takenIds(session);
  taken.delete(myHoverId);
  const enemyIds = (session.theirTeam || []).map((p) => p.championId || p.championPickIntent || 0).filter((x) => x > 0);
  const pool = PROFILES[settings.profile].pool.map((slug) => Object.values(champs).find((c) => c.lolaSlug === slug)).filter(Boolean);
  if (champs[myHoverId] && !pool.includes(champs[myHoverId])) pool.unshift(champs[myHoverId]);
  const key = `${lane}|${patch}|${enemyIds.slice().sort().join(",")}|${[...taken].sort().join(",")}|${pool.map((c) => c.id).join(",")}`;
  if (key === lastPickKey) return;
  lastPickKey = key;
  try {
    const opts = { lane, champs, patch, tier: settings.tier };
    const enemy = await picks.laneOpponent({ enemyIds, ...opts });
    state.picks = await picks.advice({ enemy, pool, taken, ...opts });
    push();
  } catch (e) { lastPickKey = ""; log("Counter picks mislukt: " + e.message); }
}

// Startitems als u.gg niet bereikbaar is: op klasse.
function fallbackStarters(me, lane) {
  if (lane === "jungle") return [1101, 2003]; // jungle pet + pot
  if (me.tags?.includes("Mage") || an.dmgType(me) === "AP") return [1056, 2003];
  if (me.tags?.includes("Tank") && !me.tags?.includes("Fighter")) return [1054, 2003];
  if (lane === "support") return [3865, 2003];
  return [1055, 2003]; // Doran's Blade + pot
}

async function processPick(session, champs, patch) {
  const myCell = session.localPlayerCellId;
  const meRow = (session.myTeam || []).find((p) => p.cellId === myCell);
  const myChampId = meRow?.championId || meRow?.championPickIntent || 0; // hoveren telt al
  if (!meRow || !myChampId) return;
  const lane = LANE[meRow.assignedPosition] || PROFILES[settings.profile].lane;
  const locked = meRow.championId > 0;
  const enemyIds = (session.theirTeam || []).map((p) => p.championId || p.championPickIntent || 0).filter((x) => x > 0);
  const key = `${myChampId}|${lane}|${locked}|${enemyIds.slice().sort().join(",")}`;
  if (key === lastKey || busy) return;
  busy = true; lastKey = key;
  try {
    const me = champs[myChampId];
    const slug = me.lolaSlug;
    const sameChamp = state.me?.id === me.id && state.lane === lane;
    state.me = me; state.lane = lane; state.enemies = enemyIds.map((id) => champs[id]).filter(Boolean);
    if (!sameChamp) log(`Champ select: ${me.name} (${lane})${locked ? "" : ", nog niet gelockt"}`);

    const laner = await resolveEnemyLaner(slug, lane, enemyIds, champs, patch);
    const enemyChanged = (laner?.champ?.id || null) !== (state.enemy?.id || null);
    state.enemy = laner?.champ || null;
    if (laner && enemyChanged) log(`Tegenstander in lane: ${laner.champ.name}${laner.row ? ` (${laner.row.vsWr}% wr)` : ""}`);
    state.team = an.analyseTeam(state.enemies);

    const opts = { patch, slug, lane, tier: settings.tier };
    const itemData = await dd.items();
    const itemNames = Object.fromEntries(Object.values(itemData).map((i) => [i.id, i.name]));
    const itemGold = Object.fromEntries(Object.values(itemData).map((i) => [i.id, i.gold]));
    const urls = await dd.imageUrls();

    let runes = state.runes, items = state.items, u = state.ugg;
    if (!sameChamp || !runes || !items) {
      runes = await lol.runePages(opts);
      items = await lol.itemBuild(opts, isBoot);
      try { u = await ugg.overview({ patch: await dd.lolalyticsPatch(), championId: me.id, lane, tier: settings.tier }); }
      catch (e) { u = null; log("u.gg (spells/skills) niet beschikbaar: " + e.message); }
      items.starters = u?.starters?.length ? u.starters : fallbackStarters(me, lane);
      const perkInfo = {};
      for (const p of runes.pages) for (const id of [...p.pri, ...p.sec]) { perkInfo[id] = await dd.perkInfo(id); if (perkInfo[id]) perkInfo[perkInfo[id].style] = await dd.perkInfo(perkInfo[id].style); }
      state.champUrl = urls.champion("");
      state.runes = { ...runes, perkInfo, shards: dd.SHARDS };
      state.ugg = u;
      state.skills = u ? { order: u.skillOrder, priority: u.skillPriority } : null;
    }
    const spellIds = u ? orderSpells(u.spells) : [];
    state.spells = u ? { ids: spellIds, names: spellIds.map((id) => ugg.SPELL_NAMES[id] || id), imgs: spellIds.map((id) => `${urls.champion("").replace("/champion/", "/spell/")}${ugg.SPELL_IMG[id] || ""}.png`) } : null;

    // Matchup-laag: team-build, guide, situationele items (verandert als tegenstanders bijkomen).
    const tb = an.teamBuild({ me, core: items.core, situational: items.situational, options: u?.itemOptions, itemData, team: state.team, laner: state.enemy, defaultBoot: items.boot, isBoot });
    state.teamBuild = { ...tb, bootsName: itemNames[tb.boots.id] };
    state.guide = guide.build({ me, enemy: state.enemy, counterRow: laner?.row || null, runePage: runes.pages[settings.runeChoice === "win" && runes.pages[1] ? 1 : 0], itemBuild: items, itemNames, itemData, team: state.team, teamBuild: state.teamBuild, spells: state.spells, skills: state.skills });
    state.items = { ...items, situational: state.guide.situationalIds || items.situational, names: itemNames, gold: itemGold, itemUrl: urls.item("").replace(/\.png$/, ""), options: u?.itemOptions || null };
    push();

    const title = `${me.name}${state.enemy ? " vs " + state.enemy.name : ""}`;
    if (settings.autoRunes && (!sameChamp || enemyChanged || !state.applied.runes)) {
      const page = runes.pages[settings.runeChoice === "win" && runes.pages[1] ? 1 : 0];
      try { await apply.applyRunes(lcu, page, title); state.applied.runes = title; log("Runes gezet: " + title); }
      catch (e) { log("Runes zetten mislukt: " + e.message); }
    }
    if (settings.autoItems) {
      try {
        await apply.applyItemSets(lcu, { championId: me.id, champName: me.name, build: state.items, teamBuild: state.teamBuild, vsName: state.enemy?.name, teamNote: state.team?.notes?.[0] });
        state.applied.items = title; log("Item sets gezet: " + title + (state.teamBuild.changed ? " (+ vs team)" : ""));
      } catch (e) { log("Item set mislukt: " + e.message); }
    }
    if (settings.autoSpells && u?.spells?.length === 2 && (!sameChamp || !state.applied.spells)) {
      try { await lcu.patch("/lol-champ-select/v1/session/my-selection", { spell1Id: spellIds[0], spell2Id: spellIds[1] }); state.applied.spells = state.spells.names.join(" + "); log("Spells gezet: " + state.applied.spells); }
      catch (e) { log("Spells zetten mislukt: " + e.message); }
    }
  } catch (e) {
    log("Fout: " + e.message); lastKey = "";
  } finally { busy = false; push(); }
}

// ---------- automatisch hoveren ----------
// Hoveren is een PATCH zonder completed: true. Locken of bannen bevestigen doet de speler altijd zelf.
const myAction = (session, type) => (session.actions || []).flat().find((a) => a.type === type && a.actorCellId === session.localPlayerCellId && !a.completed);
const hoverChamp = (action, championId) => lcu.patch(`/lol-champ-select/v1/session/actions/${action.id}`, { championId });

async function tryHover(action, championId, label) {
  const attempt = `${action.id}:${championId}`;
  if (attempt === autoTried) return false; // niet elke tick opnieuw proberen als de client weigert
  autoTried = attempt;
  try { await hoverChamp(action, championId); log(label); return true; }
  catch (e) { log(`Hoveren mislukt: ${e.message}`); return false; }
}

async function autoHoverPick(session, champs) {
  if (!settings.autoHover || state.locked || !state.picks) return;
  const action = myAction(session, "pick");
  if (!action) return;
  const meRow = (session.myTeam || []).find((p) => p.cellId === session.localPlayerCellId);
  const current = action.championId || meRow?.championPickIntent || 0;
  if (current && current !== autoPickId) return; // eigen keuze gaat altijd voor
  const best = state.picks.pool.find((r) => !r.taken && r.wr != null);
  if (!best || best.champ.id === current) return;
  const why = state.picks.enemy ? `tegen ${state.picks.enemy.name}` : "blind pick";
  if (await tryHover(action, best.champ.id, `Gehoverd: ${best.champ.name} (${why}, ${best.wr}%)`)) autoPickId = best.champ.id;
}

async function autoHoverBan(session) {
  if (!settings.autoHover || !state.bans?.list?.length) return;
  const action = myAction(session, "ban");
  if (!action?.isInProgress) return;
  if (action.championId && action.championId !== autoBanId) return; // eigen keuze gaat altijd voor
  const allies = new Set((session.myTeam || []).map((p) => p.championPickIntent || p.championId).filter(Boolean));
  const best = state.bans.list.find((x) => !allies.has(x.cid) && !state.bans.pool.includes(x.champ?.lolaSlug));
  if (!best || best.cid === action.championId) return;
  if (await tryHover(action, best.cid, `Ban gehoverd: ${best.champ.name}`)) autoBanId = best.cid;
}

async function processChampSelect(session) {
  const champs = await dd.champions();
  if (settings.tier === "all") settings.tier = "gold_plus";
  const patch = await refreshData();
  if (!state.champUrl) { const urls = await dd.imageUrls(); state.champUrl = urls.champion(""); }
  const actions = (session.actions || []).flat();
  const bansOpen = actions.some((a) => a.type === "ban" && !a.completed);
  const inBan = session.timer?.phase === "PLANNING" || (session.timer?.phase === "BAN_PICK" && bansOpen);
  if (inBan !== state.inBan) { state.inBan = inBan; push(); }
  if (inBan) await processBans(session, champs, patch);
  await processCounterPicks(session, champs, patch);
  await autoHoverBan(session);
  await autoHoverPick(session, champs);
  await processPick(session, champs, patch);
}

// ---------- post-game ----------
async function processEndOfGame() {
  try {
    const eog = await lcu.get("/lol-end-of-game/v1/eog-stats-block");
    if (!eog || eog.gameId === eogShown) return;
    eogShown = eog.gameId;
    const me = eog.localPlayer || {};
    const s = me.stats || {};
    const mins = Math.max(1, (eog.gameLength || 0) / 60);
    const cs = (s.MINIONS_KILLED || 0) + (s.NEUTRAL_MINIONS_KILLED || 0);
    const champs = await dd.champions();
    const champ = champs[me.championId];
    const tips = [];
    const csm = cs / mins;
    if (csm < 5) tips.push(`CS ${csm.toFixed(1)}/min: doel is 6+. Laat geen waves vallen voor een roam die niets oplevert.`);
    if ((s.NUM_DEATHS || 0) >= 7) tips.push(`${s.NUM_DEATHS} deaths: te veel. Na 2 deaths in lane: alleen nog farmen onder tower tot jungle komt.`);
    if ((s.VISION_SCORE || 0) / mins < 0.8) tips.push("Weinig vision: zet je trinket elke keer als hij klaar is, river-bush bij 2:45.");
    if (!tips.length) tips.push("Nette stats. Werkpunt blijft: games afsluiten als je voor staat (Baron/torens, geen chases).");
    state.postgame = { champ: champ?.name, win: eog.gameLength && (eog.teams || []).find((t) => t.isPlayerTeam)?.isWinningTeam, kda: `${s.CHAMPIONS_KILLED || 0}/${s.NUM_DEATHS || 0}/${s.ASSISTS || 0}`, cs, csm: csm.toFixed(1), mins: Math.round(mins), vision: s.VISION_SCORE || 0, tips };
    log(`Game klaar: ${champ?.name || "?"} ${state.postgame.kda}, ${state.postgame.csm} cs/min`);
    push();
  } catch { /* geen eog-data */ }
}

// ---------- hoofdlus ----------
async function tick() {
  if (!lcu.connected) {
    const ok = await lcu.connect();
    state.client = ok ? "verbonden" : "zoeken";
    if (ok) { log("Verbonden met League-client"); refreshMyStats(); }
    push();
    if (!ok) return;
  }
  const phase = await lcu.gameflowPhase();
  if (phase === "None" && !(await lcu.connect())) { state.client = "zoeken"; lastKey = ""; lastBanKey = ""; lastPickKey = ""; push(); return; }
  if (phase !== state.phase) {
    state.phase = phase;
    if (phase === "ChampSelect") { Object.assign(state, blank()); state.postgame = null; autoPickId = 0; autoBanId = 0; autoTried = ""; refreshMyStats(); lastKey = ""; lastBanKey = ""; lastPickKey = ""; }
    if (phase === "Lobby" || phase === "Matchmaking") { lastKey = ""; lastBanKey = ""; lastPickKey = ""; }
    push();
  }
  if (phase === "ReadyCheck" && settings.autoAccept) {
    try {
      const rc = await lcu.get("/lol-matchmaking/v1/ready-check");
      if (rc?.state === "InProgress" && rc.playerResponse === "None" && acceptedId !== rc.timer) { await lcu.post("/lol-matchmaking/v1/ready-check/accept"); acceptedId = rc.timer; log("Ready check geaccepteerd"); }
    } catch { /* ok */ }
  }
  if (phase === "ChampSelect") { const s = await lcu.champSelect(); if (s) await processChampSelect(s); }
  if (phase === "EndOfGame" || phase === "PreEndOfGame") await processEndOfGame();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1040, height: 760, minWidth: 720, minHeight: 520, title: "LoL Tool", backgroundColor: "#010a13",
    alwaysOnTop: !!settings.alwaysOnTop,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.on("closed", () => { win = null; });
}

ipcMain.handle("get-state", () => ({ ...state, settings }));
ipcMain.handle("set-settings", (_e, patch) => {
  settings = { ...settings, ...patch }; saveSettings();
  if ("alwaysOnTop" in patch && win) win.setAlwaysOnTop(!!settings.alwaysOnTop, "floating");
  if ("tier" in patch) refreshData().then(push).catch(() => {});
  if ("tier" in patch || "profile" in patch || "runeChoice" in patch || "flashKey" in patch) { lastKey = ""; lastBanKey = ""; lastPickKey = ""; state.applied = { runes: null, items: null, spells: null }; }
  push(); return settings;
});
ipcMain.handle("hover", async (_e, type, championId) => {
  const session = await lcu.champSelect();
  const action = session && myAction(session, type === "ban" ? "ban" : "pick");
  if (!action || !Number.isInteger(championId)) return false;
  try { await hoverChamp(action, championId); return true; }
  catch (e) { log(`Hoveren mislukt: ${e.message}`); return false; }
});
ipcMain.handle("reapply", async () => { lastKey = ""; lastBanKey = ""; lastPickKey = ""; state.applied = { runes: null, items: null, spells: null }; await tick(); return true; });

app.whenReady().then(async () => {
  dd.setCacheDir(path.join(app.getPath("userData"), "ddragon"));
  loadSettings();
  createWindow();
  try { log("Data Dragon " + (await dd.version())); await refreshData(); push(); } catch (e) { log("Data niet bereikbaar: " + e.message); }
  checkUpdate();
  setInterval(() => tick().catch((e) => log("tick: " + e.message)), 1500);
  setInterval(() => refreshData().then(push).catch(() => {}), 60 * 60 * 1000);
  setInterval(checkUpdate, 6 * 60 * 60 * 1000);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { app.quit(); });
