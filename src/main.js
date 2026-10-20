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

const lcu = new LcuClient();
let win = null;

const PROFILES = {
  ayoub: { name: "Ayoub", lane: "top", pool: ["irelia", "teemo", "jax"] },
  danny: { name: "Danny", lane: "middle", pool: ["galio", "ziggs", "veigar"] },
};

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
let settings = { profile: "ayoub", tier: "gold_plus", autoRunes: true, autoItems: true, autoSpells: false, autoAccept: false, alwaysOnTop: false, runeChoice: "pick" };
function loadSettings() { try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) }; } catch { /* defaults */ } }
function saveSettings() { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); }

const blank = () => ({
  me: null, lane: null, enemy: null, enemies: [], team: null, bans: null,
  runes: null, items: null, teamBuild: null, spells: null, skills: null, guide: null,
  applied: { runes: null, items: null, spells: null },
});
const state = { client: "zoeken", phase: "None", ...blank(), postgame: null, profiles: PROFILES, log: [] };
let lastKey = "", lastBanKey = "", busy = false, acceptedId = null, eogShown = null;

function log(msg) { state.log = [`${new Date().toLocaleTimeString("nl-NL")}  ${msg}`, ...state.log].slice(0, 60); push(); }
function push() { if (win && !win.isDestroyed()) win.webContents.send("state", { ...state, settings }); }

const LANE = { top: "top", jungle: "jungle", middle: "middle", bottom: "bottom", utility: "support" };
const BOOTS = new Set([1001, 3005, 3006, 3009, 3010, 3020, 3047, 3111, 3117, 3158]);
const isBoot = (id) => BOOTS.has(Number(id));

async function countersFor(slug, lane, patch) {
  try { return (await lol.counters({ patch, slug, lane, tier: settings.tier })).list; } catch { return []; }
}

// ---------- ban-fase ----------
async function processBans(session, champs, patch) {
  const myCell = session.localPlayerCellId;
  const meRow = (session.myTeam || []).find((p) => p.cellId === myCell);
  const lane = LANE[meRow?.assignedPosition] || PROFILES[settings.profile].lane;
  const taken = new Set();
  for (const a of (session.actions || []).flat()) if (a.completed && a.championId > 0) taken.add(a.championId);
  for (const p of [...(session.myTeam || []), ...(session.theirTeam || [])]) if (p.championId > 0) taken.add(p.championId);
  const hovers = (session.theirTeam || []).map((p) => p.championPickIntent || p.championId).filter((x) => x > 0);
  const key = `${lane}|${[...taken].sort().join(",")}|${hovers.join(",")}`;
  if (key === lastBanKey) return;
  lastBanKey = key;
  const pool = PROFILES[settings.profile].pool;
  const poolCounters = [];
  for (const slug of pool) poolCounters.push({ slug, list: await countersFor(slug, lane, patch) });
  state.bans = { lane, ...an.banAdvice({ poolCounters, lane, taken, champs, enemyHovers: hovers }), pool };
  state.lane = lane;
  push();
}

// ---------- pick-fase ----------
async function resolveEnemyLaner(meSlug, lane, enemyIds, champs, patch) {
  if (!enemyIds.length) return null;
  const list = await countersFor(meSlug, lane, patch);
  const rows = list.filter((r) => enemyIds.includes(r.cid));
  const inLane = rows.filter((r) => r.defaultLane === lane).sort((a, b) => b.n - a.n);
  const row = inLane[0] || null;
  return row ? { champ: champs[row.cid], row } : null;
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
    if (laner && enemyChanged) log(`Tegenstander in lane: ${laner.champ.name} (${laner.row.vsWr}% wr)`);
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
      try { u = await ugg.overview({ patch, championId: me.id, lane, tier: settings.tier }); }
      catch (e) { u = null; log("u.gg (spells/skills) niet beschikbaar: " + e.message); }
      if (u?.starters?.length) items.starters = u.starters;
      const perkInfo = {};
      for (const p of runes.pages) for (const id of [...p.pri, ...p.sec]) { perkInfo[id] = await dd.perkInfo(id); if (perkInfo[id]) perkInfo[perkInfo[id].style] = await dd.perkInfo(perkInfo[id].style); }
      state.champUrl = urls.champion("");
      state.runes = { ...runes, perkInfo, shards: dd.SHARDS };
      state.ugg = u;
      state.spells = u ? { ids: u.spells, names: u.spells.map((id) => ugg.SPELL_NAMES[id] || id), imgs: u.spells.map((id) => `${urls.champion("").replace("/champion/", "/spell/")}${ugg.SPELL_IMG[id] || ""}.png`) } : null;
      state.skills = u ? { order: u.skillOrder, priority: u.skillPriority } : null;
    }

    // Matchup-laag: team-build, guide, situationele items (verandert als tegenstanders bijkomen).
    const tb = an.teamBuild({ me, core: items.core, situational: items.situational, options: u?.itemOptions, itemData, team: state.team, laner: state.enemy, defaultBoot: items.boot, isBoot });
    state.teamBuild = { ...tb, bootsName: itemNames[tb.boots.id] };
    state.guide = guide.build({ me, enemy: state.enemy, counterRow: laner?.row || null, runePage: runes.pages[settings.runeChoice === "win" && runes.pages[1] ? 1 : 0], itemBuild: items, itemNames, itemData, team: state.team, teamBuild: state.teamBuild, spells: state.spells, skills: state.skills });
    state.items = { ...items, situational: state.guide.situationalIds || items.situational, names: itemNames, gold: itemGold, itemUrl: urls.item("").replace(/\.png$/, ""), options: u?.itemOptions || null };
    push();

    const title = `${me.name}${state.enemy ? " vs " + state.enemy.name : ""}`;
    if (settings.autoRunes && (!sameChamp || !state.applied.runes)) {
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
    if (settings.autoSpells && u?.spells?.length === 2 && !state.applied.spells) {
      try { await lcu.patch("/lol-champ-select/v1/session/my-selection", { spell1Id: u.spells[0], spell2Id: u.spells[1] }); state.applied.spells = state.spells.names.join(" + "); log("Spells gezet: " + state.applied.spells); }
      catch (e) { log("Spells zetten mislukt: " + e.message); }
    }
  } catch (e) {
    log("Fout: " + e.message); lastKey = "";
  } finally { busy = false; push(); }
}

async function processChampSelect(session) {
  const champs = await dd.champions();
  const patch = await dd.lolalyticsPatch();
  const inBan = session.timer?.phase === "BAN_PICK" && (session.actions || []).flat().some((a) => a.type === "ban" && !a.completed && a.isInProgress);
  if (inBan || session.timer?.phase === "PLANNING") await processBans(session, champs, patch);
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
    if (ok) log("Verbonden met League-client");
    push();
    if (!ok) return;
  }
  const phase = await lcu.gameflowPhase();
  if (phase === "None" && !(await lcu.connect())) { state.client = "zoeken"; lastKey = ""; lastBanKey = ""; push(); return; }
  if (phase !== state.phase) {
    state.phase = phase;
    if (phase === "ChampSelect") { Object.assign(state, blank()); state.postgame = null; lastKey = ""; lastBanKey = ""; }
    if (phase === "Lobby" || phase === "Matchmaking") { lastKey = ""; lastBanKey = ""; }
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
  if ("tier" in patch || "profile" in patch || "runeChoice" in patch) { lastKey = ""; lastBanKey = ""; state.applied = { runes: null, items: null, spells: null }; }
  push(); return settings;
});
ipcMain.handle("reapply", async () => { lastKey = ""; lastBanKey = ""; state.applied = { runes: null, items: null, spells: null }; await tick(); return true; });

app.whenReady().then(async () => {
  dd.setCacheDir(path.join(app.getPath("userData"), "ddragon"));
  loadSettings();
  createWindow();
  try { log("Data Dragon " + (await dd.version())); } catch (e) { log("Data Dragon niet bereikbaar: " + e.message); }
  setInterval(() => tick().catch((e) => log("tick: " + e.message)), 1500);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { app.quit(); });
