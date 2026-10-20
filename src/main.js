// Electron hoofdproces: verbindt met de League-client, kijkt naar champ select,
// haalt runes/items/matchup op en zet ze automatisch in de client.

const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { LcuClient } = require("./lcu");
const dd = require("./ddragon");
const lol = require("./lolalytics");
const apply = require("./apply");
const guide = require("./guide");

const lcu = new LcuClient();
let win = null;
let tray = null;

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
let settings = { tier: "gold_plus", autoRunes: true, autoItems: true, runeChoice: "pick" };
function loadSettings() { try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) }; } catch { /* defaults */ } }
function saveSettings() { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); }

const state = {
  client: "zoeken",      // zoeken | verbonden
  phase: "None",
  me: null,              // {id,name,slug,image}
  lane: null,            // top|jungle|middle|bottom|support
  enemy: null,           // {id,name,slug,image} tegenstander in mijn lane
  enemies: [],           // alle vijandelijke picks
  runes: null, items: null, guide: null,
  applied: { runes: null, items: null },
  log: [],
};
let lastKey = "";
let busy = false;

function log(msg) {
  const line = `${new Date().toLocaleTimeString("nl-NL")}  ${msg}`;
  state.log = [line, ...state.log].slice(0, 40);
  push();
}
function push() { if (win && !win.isDestroyed()) win.webContents.send("state", { ...state, settings }); }

const LANE = { top: "top", jungle: "jungle", middle: "middle", bottom: "bottom", utility: "support" };

const BOOTS = new Set([1001, 3005, 3006, 3009, 3010, 3020, 3047, 3111, 3117, 3158]);
const isBoot = (id) => BOOTS.has(Number(id));

async function resolveEnemyLaner(meSlug, lane, enemyIds, champs, patch) {
  if (!enemyIds.length) return null;
  // Via counter-data: elke tegenstander heeft daar een defaultLane. Pak die in mijn lane.
  try {
    const c = await lol.counters({ patch, slug: meSlug, lane, tier: settings.tier });
    const rows = c.list.filter((r) => enemyIds.includes(r.cid));
    const inLane = rows.filter((r) => r.defaultLane === lane).sort((a, b) => b.n - a.n);
    const row = inLane[0] || null;
    if (row) return { champ: champs[row.cid], row };
  } catch (e) { log("counter-data mislukt: " + e.message); }
  return null;
}

async function processChampSelect(session) {
  const myCell = session.localPlayerCellId;
  const meRow = (session.myTeam || []).find((p) => p.cellId === myCell);
  if (!meRow || !meRow.championId) { return; }
  const lane = LANE[meRow.assignedPosition] || null;
  const enemyIds = (session.theirTeam || []).map((p) => p.championId).filter((x) => x > 0);
  const key = `${meRow.championId}|${lane}|${enemyIds.sort().join(",")}`;
  if (key === lastKey || busy) return;
  busy = true; lastKey = key;
  try {
    const champs = await dd.champions();
    const me = champs[meRow.championId];
    const patch = await dd.lolalyticsPatch();
    const slug = dd.lolalyticsSlug(me);
    const useLane = lane || "top";
    state.me = me; state.lane = useLane; state.enemies = enemyIds.map((id) => champs[id]).filter(Boolean);
    log(`Champ select: ${me.name} (${useLane})`);

    const laner = await resolveEnemyLaner(slug, useLane, enemyIds, champs, patch);
    state.enemy = laner?.champ || null;
    if (laner) log(`Tegenstander in lane: ${laner.champ.name} (${laner.row.vsWr}% wr)`);

    const opts = { patch, slug, lane: useLane, tier: settings.tier };
    const runes = await lol.runePages(opts);
    const items = await lol.itemBuild(opts, isBoot);

    const itemData = await dd.items();
    const itemNames = Object.fromEntries(Object.values(itemData).map((i) => [i.id, i.name]));
    const perkInfo = {};
    for (const p of runes.pages) for (const id of [...p.pri, ...p.sec]) perkInfo[id] = await dd.perkInfo(id);
    const urls = await dd.imageUrls();

    state.champUrl = urls.champion("");
    state.runes = { ...runes, perkInfo, shards: dd.SHARDS, runeUrl: urls.rune("") };
    const itemGold = Object.fromEntries(Object.values(itemData).map((i) => [i.id, i.gold]));
    state.items = { ...items, names: itemNames, gold: itemGold, itemUrl: urls.item("").replace(/\.png$/, "") };
    state.guide = guide.build({ me, enemy: state.enemy, counterRow: laner?.row || null, runePage: runes.pages[settings.runeChoice === "win" ? 1 : 0] || runes.pages[0], itemBuild: items, itemNames, itemData });
    items.situational = state.guide.situationalIds || items.situational;
    push();

    const title = `${me.name}${state.enemy ? " vs " + state.enemy.name : ""}`;
    if (settings.autoRunes) {
      const page = runes.pages[settings.runeChoice === "win" && runes.pages[1] ? 1 : 0];
      try { await apply.applyRunes(lcu, page, title); state.applied.runes = title; log("Runes gezet: " + title); }
      catch (e) { log("Runes zetten mislukt: " + e.message); }
    }
    if (settings.autoItems) {
      try { await apply.applyItemSet(lcu, { championId: me.id, title, build: items, vsName: state.enemy?.name }); state.applied.items = title; log("Item set gezet: " + title); }
      catch (e) { log("Item set mislukt: " + e.message); }
    }
  } catch (e) {
    log("Fout: " + e.message);
    lastKey = ""; // opnieuw proberen bij volgende poll
  } finally { busy = false; push(); }
}

async function tick() {
  if (!lcu.connected) {
    const ok = await lcu.connect();
    state.client = ok ? "verbonden" : "zoeken";
    if (ok) log("Verbonden met League-client");
    push();
    if (!ok) return;
  }
  const phase = await lcu.gameflowPhase();
  if (phase === "None" && !(await lcu.connect())) { state.client = "zoeken"; lastKey = ""; push(); return; }
  if (phase !== state.phase) { state.phase = phase; if (phase !== "ChampSelect") { lastKey = ""; } push(); }
  if (phase === "ChampSelect") {
    const s = await lcu.champSelect();
    if (s) await processChampSelect(s);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 720, minWidth: 760, minHeight: 520,
    title: "LoL Tool",
    backgroundColor: "#0b0f17",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.on("closed", () => { win = null; });
}

ipcMain.handle("get-state", () => ({ ...state, settings }));
ipcMain.handle("set-settings", (_e, patch) => { settings = { ...settings, ...patch }; saveSettings(); lastKey = ""; push(); return settings; });
ipcMain.handle("reapply", async () => { lastKey = ""; await tick(); return true; });

app.whenReady().then(async () => {
  dd.setCacheDir(path.join(app.getPath("userData"), "ddragon"));
  loadSettings();
  createWindow();
  try { await dd.version(); log("Data Dragon " + (await dd.version())); } catch (e) { log("Data Dragon niet bereikbaar: " + e.message); }
  setInterval(() => tick().catch((e) => log("tick: " + e.message)), 2000);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { app.quit(); });
