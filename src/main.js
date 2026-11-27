// Electron hoofdproces: verbindt met de League-client, volgt ban/pick-fase,
// haalt runes/items/spells/matchup op en zet alles automatisch in de client.

const { app, BrowserWindow, ipcMain, shell, screen, globalShortcut } = require("electron");
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
const goals = require("./goals");
const live = require("./live");
const fg = require("./foreground");

const lcu = new LcuClient();
let win = null;

const PROFILES = {
  // pool: je eigen champs (eerste = main). backups: pas als de pool weg is (gebanned/gepakt).
  // oneTrick: de main altijd bovenaan zolang hij vrij is. comp: champ uit je pool die beter past
  // bij hun team (Irelia tegen een AD-team). duo: met wie je speelt en in welke lane hij staat.
  // Ayoub (sinds 27-11-2026, middag): mid, Galio sowieso; Irelia alleen als Galio weg is.
  ayoub: { name: "Ayoub", lane: "middle", pool: ["galio", "irelia"], favorite: "galio", oneTrick: true, teamPick: true,
    duo: { name: "Danny", lane: "jungle", riotName: "EversD" } },
  // Danny (sinds 27-11-2026, middag): jungle, Shaco main; Fiddlesticks en Gwen als Shaco weg is of slecht past.
  danny: { name: "Danny", lane: "jungle", pool: ["shaco", "fiddlesticks", "gwen"], favorite: "shaco", teamPick: true,
    backups: [],
    duo: { name: "Ayoub", lane: "middle", riotName: "Qyoub" } },
};

// Profiel met de eigen aanpassingen uit de instellingen (pool/backups/duo-naam).
function prof(key = settings.profile) {
  const base = PROFILES[key] || PROFILES.ayoub;
  const own = settings.pools?.[key] || {};
  const pool = own.pool?.length ? own.pool : base.pool;
  return {
    ...base, pool, backups: own.backups ?? base.backups ?? [],
    favorite: own.pool?.length ? own.pool[0] : base.favorite,
    duo: { ...base.duo, ...(settings.duoNames?.[key] != null ? { riotName: settings.duoNames[key] } : {}) },
  };
}

// Pool voor de lane die je in champ select krijgt; buiten je eigen lane geen vaste pool
// (dan telt alleen wat je hovert, plus de beste counter picks).
const poolFor = (lane) => { const p = prof(); return lane === p.lane ? p.pool : p.pools?.[lane] || p.pool; };
const backupsFor = (lane) => { const p = prof(); return lane === p.lane ? p.backups : []; };

// Data van spelers op jouw niveau: lolalytics heeft bronze/silver/gold_plus/emerald_plus.
// Iron en unranked vallen onder Bronze (Iron heeft te weinig games voor betrouwbare data).
let myRank = null;
const RANK_TIER = { IRON: "bronze", BRONZE: "bronze", SILVER: "silver", GOLD: "gold_plus", PLATINUM: "gold_plus", EMERALD: "emerald_plus", DIAMOND: "emerald_plus", MASTER: "emerald_plus", GRANDMASTER: "emerald_plus", CHALLENGER: "emerald_plus" };
const tierNow = () => settings.tier && settings.tier !== "auto" ? settings.tier : RANK_TIER[myRank] || "bronze";
async function refreshRank() {
  try {
    const r = await lcu.get("/lol-ranked/v1/current-ranked-stats");
    const q = r?.queueMap?.RANKED_SOLO_5x5;
    const t = q?.tier && q.tier !== "NONE" ? q.tier : r?.highestRankedEntrySR?.tier;
    if (t && t !== "NONE" && t !== myRank) { myRank = t; if (settings.tier === "auto") log(`Rank ${t[0] + t.slice(1).toLowerCase()}: data van ${tierNow()}`); }
  } catch { /* geen rank */ }
}

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
let settings = { profile: "ayoub", tier: "auto", autoRunes: true, autoItems: true, autoSpells: false, autoHover: true, autoBan: false, autoLock: false, autoAccept: false, alwaysOnTop: false, runeChoice: "pick", flashKey: "d", overlay: true, overlayPos: "right", overlayCompact: false, overlayDuo: true, overlaySpikes: true, overlayCoach: true };
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) }; } catch { /* defaults */ }
  // v0.1.15: oude standaard Gold+ paste niet bij jullie elo; eenmalig naar automatisch.
  if (!settings.tierMigrated) { if (settings.tier === "gold_plus") settings.tier = "auto"; settings.tierMigrated = true; try { saveSettings(); } catch { /* later */ } }
}
function saveSettings() { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); }

const blank = () => ({
  me: null, lane: null, enemy: null, enemies: [], team: null, bans: null, inBan: false, picks: null, locked: false,
  runes: null, items: null, teamBuild: null, spells: null, skills: null, guide: null, theirTeam: [], enemyManual: false,
  applied: { runes: null, items: null, spells: null },
});
const state = { client: "zoeken", phase: "None", ...blank(), postgame: null, profiles: PROFILES, log: [], data: null, update: null, myStats: {}, goals: null };
let autoPickId = 0, autoBanId = 0, autoTried = "", lockTried = "";
// Zelf gekozen tegenstander in jouw lane (klik in de app); 0 = de tool schat het zelf.
let manualEnemyId = 0;
// Automatisch bannen/locken gebeurt pas in de laatste seconden van je beurt, zodat je zelf
// nog iets anders kunt kiezen. De tool lockt wat er gehoverd staat (jouw keuze gaat voor).
const LOCK_AT_MS = 10000;
// Handmatige keuze in de app (klik op een rune page of build); null = standaard uit de instellingen.
// runeKey = label van de gekozen page, zodat de keuze blijft staan als de lijst verandert.
let lastStyleKey = "";
let runeKey = null, buildIdx = null, baseItems = null, baseRunes = null;
const activeRuneIdx = (pages) => {
  const chosen = runeKey ? pages.findIndex((p) => p.label === runeKey) : -1;
  if (chosen >= 0) return chosen;
  const vs = pages.findIndex((p) => p.vs); // runes tegen je tegenstander gaan voor
  if (vs >= 0) return settings.runeChoice === "win" && pages[vs + 1]?.vs ? vs + 1 : vs;
  return settings.runeChoice === "win" && pages[1] ? 1 : 0;
};
const MIN_VS_RUNE_GAMES = 200;
const MIN_VS_ITEM_GAMES = 200; // eerste item tegen deze tegenstander: minder games = ruis, dan de algemene build
const SHRINK = 100;            // winrate van een item-optie trekken we 100 games richting het gemiddelde
let lastKey = "", lastBanKey = "", lastPickKey = "", busy = false, acceptedId = null, eogShown = null;

function log(msg) {
  const line = `${new Date().toLocaleTimeString("nl-NL")}  ${msg}`;
  state.log = [line, ...state.log].slice(0, 60); push();
  // Ook naar een bestand, zodat we achteraf kunnen zien waarom iets misging (max ~200 kB).
  try {
    const f = path.join(app.getPath("userData"), "log.txt");
    if (fs.existsSync(f) && fs.statSync(f).size > 200000) fs.renameSync(f, f + ".old");
    fs.appendFileSync(f, `${new Date().toISOString().slice(0, 10)} ${line}
`);
  } catch { /* geen log */ }
}
// Namen bij de slugs (voor de instellingen); gevuld zodra Data Dragon geladen is.
let slugNames = {};
const named = (slugs) => (slugs || []).map((sl) => slugNames[sl] || sl);
const view = () => ({ ...state, settings, manualEnemyId, profiles: Object.fromEntries(Object.keys(PROFILES).map((k) => { const p = prof(k); return [k, { ...p, poolNames: named(p.pool), backupNames: named(p.backups) }]; })) });
function push() { if (win && !win.isDestroyed()) win.webContents.send("state", view()); }

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
  try { return (await lol.counters({ patch, slug, lane, tier: tierNow() })).list; } catch { return []; }
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
  const { patch, n } = await lol.resolvePatch(latest, "irelia", "top", tierNow());
  state.data = { patch, latest, games: n, tier: tierNow(), auto: settings.tier === "auto", rank: myRank };
  return patch;
}

async function refreshMyStats() {
  let history = null;
  try { history = await lcu.get("/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=99"); state.myStats = picks.myStats(history); push(); }
  catch { /* geen historie: rijen tonen dan alleen de data */ }
  if (history) refreshGoals(history).catch((e) => log("Doelen niet bijgewerkt: " + e.message));
}

// Gemiddelde deaths / KP / control wards / CS per min over je laatste 20 games.
// Per game één extra request (voor de kills van je team); die blijven bewaard.
const gameCache = new Map();
async function refreshGoals(history) {
  const me = await lcu.currentSummoner();
  const lines = [];
  for (const g of goals.riftGames(history, 40)) {
    let line = gameCache.get(g.gameId);
    if (!line) {
      try { line = goals.fromGame(await lcu.get(`/lol-match-history/v1/games/${g.gameId}`), me.puuid); } catch { line = null; }
      if (line) gameCache.set(g.gameId, line);
    }
    if (line) lines.push(line);
  }
  const champs = await dd.champions();
  const pr = prof();
  const mainId = Object.values(champs).find((c) => c.lolaSlug === pr.favorite)?.id || null;
  const names = Object.fromEntries(Object.values(champs).map((c) => [c.id, c.name]));
  // Eigen record per tegenstander in jouw lane (laatste 40 games): wins, losses, gem. deaths.
  const vs = {};
  for (const l of lines) {
    if (!l.opp) continue;
    const r = vs[l.opp] ||= { w: 0, l: 0, deaths: 0, champs: {} };
    r[l.win ? "w" : "l"]++; r.deaths += l.deaths || 0;
    const cn = champs[l.championId]?.name || "?"; r.champs[cn] = (r.champs[cn] || 0) + 1;
  }
  for (const r of Object.values(vs)) r.deaths = Math.round((r.deaths / (r.w + r.l)) * 10) / 10;
  state.vsRecord = vs;
  const recent = lines.slice(0, 20);
  state.goals = {
    targets: goals.targetsFor(pr.lane), avg: goals.average(recent),
    recent: recent.slice(0, 10).map((l) => ({ ...l, champ: champs[l.championId]?.name || "?" })),
    analysis: goals.analysis(recent, { lane: pr.lane, mainId, names }),
    streak: lossStreak(recent),
  };
  push();
}

// Verliesreeks in deze speelsessie (games die binnen 3 uur na elkaar gestart zijn).
// Na 3 verloren op rij laat de app een pauze-melding zien: met tilt speel je slechter.
const SESSION_GAP = 3 * 60 * 60 * 1000;
function lossStreak(lines) {
  let n = 0, prev = null;
  for (const l of lines) {
    if (l.win) break;
    if (prev && l.created && prev - l.created > SESSION_GAP) break;
    n++; prev = l.created || prev;
  }
  const last = lines[0]?.created || null;
  return { losses: n, recent: !!last && Date.now() - last < SESSION_GAP };
}

async function checkUpdate() {
  try { state.update = await update.check(app.getVersion()); push(); } catch { /* offline */ }
}

// ---------- ban-fase ----------
async function processBans(session, champs, patch) {
  const myCell = session.localPlayerCellId;
  const meRow = (session.myTeam || []).find((p) => p.cellId === myCell);
  const lane = LANE[meRow?.assignedPosition] || prof().lane;
  const taken = takenIds(session);
  const hovers = (session.theirTeam || []).map((p) => p.championPickIntent || p.championId).filter((x) => x > 0);
  const key = `${lane}|${[...taken].sort().join(",")}|${hovers.join(",")}|${meRow?.championPickIntent || 0}`;
  if (key === lastBanKey) return;
  lastBanKey = key;
  const p = prof();
  const pool = [...poolFor(lane)];
  // Hover je een champ buiten je pool, dan telt die mee (zodat het ook werkt als je iets anders speelt).
  const myHover = champs[meRow?.championPickIntent || meRow?.championId || 0];
  if (myHover && !pool.includes(myHover.lolaSlug)) pool.unshift(myHover.lolaSlug);
  // One-trick: bannen voor je main of wat je hovert (je backups speel je alleen als hij weg is).
  const banPool = p.oneTrick && lane === p.lane ? [pool[0]] : pool;
  const poolCounters = [];
  for (const slug of banPool) poolCounters.push({ slug, list: await countersFor(slug, lane, patch) });
  const own = [...pool, ...backupsFor(lane)];
  state.bans = { lane, ...an.banAdvice({ poolCounters, lane, taken: new Set([...taken, ...own.map((sl) => Object.values(champs).find((c) => c.lolaSlug === sl)?.id).filter(Boolean)]), champs, enemyHovers: hovers }), pool: own };
  state.lane = lane;
  push();
}

// Je duo in champ select: op naam (als de client die laat zien), anders op zijn lane.
const POS = { top: "top", jungle: "jungle", middle: "middle", bottom: "bottom", utility: "support" };
function findDuo(session, champs) {
  const d = prof().duo;
  if (!d) return null;
  const mates = (session.myTeam || []).filter((p) => p.cellId !== session.localPlayerCellId);
  const name = String(d.riotName || "").toLowerCase();
  const row = (name && mates.find((p) => String(p.gameName || "").toLowerCase().startsWith(name))) || mates.find((p) => POS[p.assignedPosition] === d.lane);
  if (!row) return null;
  const champ = champs[row.championId || row.championPickIntent || 0] || null;
  return { name: d.name, lane: POS[row.assignedPosition] || d.lane, champ };
}

// ---------- pick-fase ----------
// Zelf gekozen tegenstander gaat voor, zolang hij nog in hun team staat.
async function laneEnemy(enemyIds, lane, champs, patch) {
  if (manualEnemyId && enemyIds.includes(manualEnemyId) && champs[manualEnemyId]) return champs[manualEnemyId];
  return picks.laneOpponent({ enemyIds, lane, champs, patch, tier: tierNow() });
}

async function resolveEnemyLaner(meSlug, lane, enemyIds, champs, patch) {
  const champ = await laneEnemy(enemyIds, lane, champs, patch);
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
  const lane = LANE[meRow.assignedPosition] || prof().lane;
  const taken = takenIds(session);
  taken.delete(myHoverId);
  const enemyIds = (session.theirTeam || []).map((p) => p.championId || p.championPickIntent || 0).filter((x) => x > 0);
  const bySlug = (slug) => Object.values(champs).find((c) => c.lolaSlug === slug);
  const pool = poolFor(lane).map(bySlug).filter(Boolean);
  const backups = backupsFor(lane).map(bySlug).filter((c) => c && !pool.includes(c));
  const hovered = champs[myHoverId];
  if (hovered && !pool.includes(hovered) && !backups.includes(hovered)) pool.unshift(hovered);
  const key = `${lane}|${patch}|${enemyIds.slice().sort().join(",")}|${[...taken].sort().join(",")}|${pool.map((c) => c.id).join(",")}|${backups.map((c) => c.id).join(",")}|${manualEnemyId}`;
  if (key === lastPickKey) return;
  lastPickKey = key;
  try {
    const opts = { lane, champs, patch, tier: tierNow() };
    const enemy = await laneEnemy(enemyIds, lane, champs, patch);
    const p = prof();
    const own = lane === p.lane;
    state.picks = await picks.advice({ enemy, enemyIds: p.teamPick ? enemyIds : [], pool, backups, taken, favorite: own ? p.favorite : null, oneTrick: own && p.oneTrick && !(hovered && hovered.lolaSlug !== p.favorite && !backups.includes(hovered)), compRules: own ? p.comp : null, compStrict: own && !!p.compStrict, dmgType: an.dmgType, ...opts });
    push();
  } catch (e) { lastPickKey = ""; log("Counter picks mislukt: " + e.message); }
}

const samePage = (a, b) => JSON.stringify([a.pri, a.sec, a.mod]) === JSON.stringify([b.pri, b.sec, b.mod]);

// u.gg geeft één page (perks door elkaar): sorteren op tree en slot zoals de client het wil.
async function uggPage(u) {
  const r = u?.runes;
  if (!r?.perks?.length || u.shards?.length !== 3) return null;
  const pri = [], sec = [];
  for (const id of r.perks) ((await dd.perkStyle(id)) === r.pri ? pri : sec).push(id);
  const bySlot = async (ids) => { const s = await Promise.all(ids.map((id) => dd.perkSlot(id))); return ids.map((id, i) => [id, s[i]]).sort((a, b) => a[1] - b[1]).map(([id]) => id); };
  if (pri.length !== 4 || sec.length !== 2) return null;
  const games = u.games || 0;
  return { label: "u.gg aanbevolen", wr: games ? Math.round((u.wins / games) * 1000) / 10 : null, n: games, pri: await bySlot(pri), sec: await bySlot(sec), mod: u.shards };
}

// Variant van de beste page op dit team: veel CC → Tenacity, veel burst → Health als laatste shard.
function teamPage(page, team) {
  if (!page || !team || team.count < 3) return null;
  const mod = [...page.mod];
  let why = null;
  if (team.cc.length >= 3 && mod[2] !== 5013) { mod[2] = 5013; why = `Tenacity: ${team.cc.length}x CC`; }
  else if ((team.assassins?.length || 0) >= 2 && mod[2] !== 5011) { mod[2] = 5011; why = "Health: veel burst"; }
  return why ? { ...page, mod, label: "Vs dit team", note: why, wr: null, n: null, team: true } : null;
}

// Startitems als u.gg niet bereikbaar is: op klasse.
// Build tegen de tegenstander in jouw lane (lolalytics vs-pagina). Item 1-3: wat het meest
// gekocht wordt tegen hem (betrouwbaar, duizenden games). Item 4-6: de optie met de beste
// winrate, maar "gekrompen" naar het gemiddelde zodat 76% over 25 games niet wint van
// 56% over 1200 games: (wr*n + gem*SHRINK) / (n + SHRINK).
function matchupBuild(vs) {
  const b = vs?.pick;
  if (!b?.core?.length || b.core[0].n < MIN_VS_ITEM_GAMES) return null;
  const out = b.core.map((x) => x.id);
  const options = {};
  for (const k of [4, 5, 6]) {
    const list = b.options[k] || [];
    options[k] = list.map((o) => ({ id: o.id, wr: o.wr, games: o.n }));
    const total = list.reduce((a, o) => a + o.n, 0);
    if (!total) continue;
    const avg = list.reduce((a, o) => a + o.wr * o.n, 0) / total;
    const score = (o) => (o.wr * o.n + avg * SHRINK) / (o.n + SHRINK);
    const best = list.filter((o) => !out.includes(o.id) && !isBoot(o.id)).sort((x, y) => score(y) - score(x))[0];
    if (best) out.push(best.id);
  }
  return { core: out, options, starters: b.start.n >= MIN_VS_ITEM_GAMES ? b.start.ids : null, n: b.core[0].n };
}

// lolalytics heeft na het 3e/4e item vaak te weinig games om de build te volgen;
// dan vullen we aan met u.gg's meest gekochte 4e, 5e en 6e item (tot 5 items + boots).
function fillBuild(list, options) {
  const out = [...list];
  for (const k of [4, 5, 6]) {
    if (out.filter((id) => !isBoot(id)).length >= 5) break;
    const best = [...(options?.[k] || [])].sort((a, b) => b.games - a.games).find((o) => !out.includes(o.id) && !isBoot(o.id));
    if (best) out.push(best.id);
  }
  return out;
}

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
  const lane = LANE[meRow.assignedPosition] || prof().lane;
  const locked = meRow.championId > 0;
  const enemyIds = (session.theirTeam || []).map((p) => p.championId || p.championPickIntent || 0).filter((x) => x > 0);
  const allyIds = (session.myTeam || []).filter((p) => p.cellId !== myCell).map((p) => p.championId || p.championPickIntent || 0).filter((x) => x > 0);
  const key = `${myChampId}|${lane}|${locked}|${enemyIds.slice().sort().join(",")}|${manualEnemyId}|${allyIds.slice().sort().join(",")}`;
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
    state.enemyManual = !!manualEnemyId && state.enemy?.id === manualEnemyId;
    if (laner && enemyChanged) log(`Tegenstander in lane: ${laner.champ.name}${laner.row ? ` (${laner.row.vsWr}% wr)` : ""}`);
    state.duo = findDuo(session, champs);
    let roles = {};
    try { roles = await picks.enemyRoles({ enemyIds, champs, patch, tier: tierNow(), lane }); } catch { /* alleen tags */ }
    state.enemyRoles = roles;
    state.team = an.analyseTeam(state.enemies, roles);

    const opts = { patch, slug, lane, tier: tierNow() };
    const itemData = await dd.items();
    const itemNames = Object.fromEntries(Object.values(itemData).map((i) => [i.id, i.name]));
    const itemGold = Object.fromEntries(Object.values(itemData).map((i) => [i.id, i.gold]));
    const urls = await dd.imageUrls();

    let runes = baseRunes, items = baseItems, u = state.ugg;
    if (!sameChamp || !runes || !items) {
      runeKey = null; buildIdx = null;
      runes = await lol.runePages(opts);
      items = await lol.itemBuild(opts, isBoot);
      baseItems = items;
      try { u = await ugg.overview({ patch: await dd.lolalyticsPatch(), championId: me.id, lane, tier: tierNow() }); }
      catch (e) { u = null; log("u.gg (spells/skills) niet beschikbaar: " + e.message); }
      items.starters = u?.starters?.length ? u.starters : fallbackStarters(me, lane);
      items.core = fillBuild(items.core, u?.itemOptions);
      items.builds = (items.builds || []).slice(0, 3).map((b) => ({ ...b, items: fillBuild(b.items, u?.itemOptions) }));
      // Speelstijlen uit de data (full damage / tank) als extra klikbare builds.
      items.styles = an.styles({ builds: items.allBuilds, itemData });
      for (const st of Object.values(items.styles)) {
        st.items = fillBuild(st.items, u?.itemOptions);
        const at = items.builds.findIndex((b) => b.items.slice(0, 3).join() === st.items.slice(0, 3).join());
        if (at >= 0) { items.builds[at].label = st.label; st.idx = at; } else { st.idx = items.builds.length; items.builds.push({ items: st.items, picks: st.picks, wins: st.wins, wr: st.wr, label: st.label }); }
      }
      const up = await uggPage(u).catch(() => null);
      if (up && !runes.pages.some((p) => samePage(p, up))) runes.pages.push(up);
      baseRunes = runes;
      state.champUrl = urls.champion("");
      state.ugg = u;
      state.skills = u ? { order: u.skillOrder, priority: u.skillPriority } : null;
    }
    // Runes tegen de tegenstander in jouw lane (in jungle: de vijandelijke jungler) bovenaan.
    let pages = [...runes.pages];
    if (state.enemy) {
      try {
        const vsPages = (await lol.vsRunePages({ ...opts, vs: state.enemy.lolaSlug }))
          .filter((p) => p.n >= MIN_VS_RUNE_GAMES)
          .map((p, i) => ({ ...p, vs: true, label: `Tegen ${state.enemy.name}${i ? " · hoogste winrate" : ""}` }))
          .filter((p, i, a) => !i || !samePage(p, a[0]));
        pages = [...vsPages, ...pages.filter((p) => !vsPages.some((v) => samePage(v, p)))];
        if (vsPages.length && enemyChanged) log(`Runes tegen ${state.enemy.name}: ${vsPages[0].n} games`);
      } catch (e) { if (enemyChanged) log(`Runes tegen ${state.enemy.name} niet beschikbaar: ${e.message}`); }
    }
    // Team-variant opnieuw bepalen als tegenstanders bijkomen.
    const tp = teamPage(pages[0], state.team);
    if (tp && !pages.some((p) => samePage(p, tp))) pages.push(tp);
    runes = { ...runes, pages };
    const perkInfo = {};
    for (const p of pages) for (const id of [...p.pri, ...p.sec]) { perkInfo[id] ||= await dd.perkInfo(id); if (perkInfo[id]) perkInfo[perkInfo[id].style] ||= await dd.perkInfo(perkInfo[id].style); }
    state.runes = { ...runes, perkInfo, shards: dd.SHARDS };
    const spellIds = u ? orderSpells(u.spells) : [];
    state.spells = u ? { ids: spellIds, names: spellIds.map((id) => ugg.SPELL_NAMES[id] || id), imgs: spellIds.map((id) => `${urls.champion("").replace("/champion/", "/spell/")}${ugg.SPELL_IMG[id] || ""}.png`) } : null;

    // Build tegen jouw tegenstander in plaats van de algemene (tenzij je zelf een build koos).
    // Past een andere speelstijl bij de teams (squishy tegenstanders → full damage, geen eigen
    // frontline → tank), dan gaat die voor de matchup-build.
    let vsOptions = null;
    const style = buildIdx == null ? an.pickStyle({ styles: items.styles, team: state.team, allies: allyIds.map((id) => champs[id]) }) : null;
    const styleKey = style ? `${style.key}|${me.id}` : "";
    if (style) {
      const b = style.items;
      items = { ...items, core: [b[0], ...(items.boot ? [items.boot] : []), ...b.slice(1)], situational: items.situational.filter((id) => !b.includes(id)), style: { key: style.key, label: style.label, why: style.why, picks: style.picks, wr: style.wr, idx: style.idx } };
      if (styleKey !== lastStyleKey) log(`${style.label}-build: ${style.why} (${style.picks} games, ${style.wr}%)`);
    }
    lastStyleKey = styleKey;
    if (state.enemy && buildIdx == null && !style) {
      try {
        const mb = matchupBuild(await lol.vsItems({ ...opts, vs: state.enemy.lolaSlug }));
        if (mb) {
          const core = fillBuild(mb.core, u?.itemOptions);
          items = { ...items, core, starters: mb.starters || items.starters, situational: items.situational.filter((id) => !core.includes(id)), vs: { name: state.enemy.name, n: mb.n } };
          vsOptions = mb.options;
          if (enemyChanged) log(`Build tegen ${state.enemy.name}: ${mb.n} games`);
        } else if (enemyChanged) log(`Te weinig games tegen ${state.enemy.name} voor een eigen build; algemene build`);
      } catch (e) { if (enemyChanged) log(`Build tegen ${state.enemy.name} niet beschikbaar: ${e.message}`); }
    }

    // Gekozen build (klik in de app) in plaats van de meest gespeelde.
    const pickedBuild = buildIdx != null ? items.builds?.[buildIdx] : null;
    if (pickedBuild) {
      const b = pickedBuild.items;
      items = { ...items, core: [b[0], ...(items.boot ? [items.boot] : []), ...b.slice(1)].filter((id, i, a) => a.indexOf(id) === i), situational: items.situational.filter((id) => !b.includes(id)) };
    }

    // Matchup-laag: team-build, guide, situationele items (verandert als tegenstanders bijkomen).
    const tb = an.teamBuild({ me, core: items.core, situational: items.situational, options: vsOptions || u?.itemOptions, itemData, team: state.team, laner: state.enemy, defaultBoot: items.boot, isBoot, style: items.style?.key });
    state.teamBuild = { ...tb, bootsName: itemNames[tb.boots.id] };
    let insights = null;
    if (state.enemy) { try { insights = await lol.vsInsights({ ...opts, vs: state.enemy.lolaSlug }); } catch { /* geen matchup-data */ } }
    const myVs = state.enemy ? state.vsRecord?.[state.enemy.id] || null : null;
    state.guide = guide.build({ duo: state.duo, me, enemy: state.enemy, insights, myVs, lane, counterRow: laner?.row || null, runePage: runes.pages[activeRuneIdx(runes.pages)], itemBuild: items, itemNames, itemData, team: state.team, teamBuild: state.teamBuild, spells: state.spells, skills: state.skills });
    state.items = { ...items, allBuilds: undefined, styles: undefined, situational: state.guide.situationalIds || items.situational, names: itemNames, gold: itemGold, itemUrl: urls.item("").replace(/\.png$/, ""), options: vsOptions || u?.itemOptions || null, buildIdx: pickedBuild ? buildIdx : null };
    state.runeIdx = activeRuneIdx(runes.pages);
    push();

    const title = `${me.name}${state.enemy ? " vs " + state.enemy.name : ""}`;
    if (settings.autoRunes && (!sameChamp || enemyChanged || !state.applied.runes)) {
      const page = runes.pages[activeRuneIdx(runes.pages)];
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

// ---------- automatisch hoveren, bannen en locken ----------
// Hoveren is een PATCH zonder completed: true; bannen/locken (instelling) is dezelfde PATCH met completed: true.
const myAction = (session, type) => (session.actions || []).flat().find((a) => a.type === type && a.actorCellId === session.localPlayerCellId && !a.completed);
const hoverChamp = (action, championId) => lcu.patch(`/lol-champ-select/v1/session/actions/${action.id}`, { championId });

let autoTriedAt = 0;
async function tryHover(action, championId, label) {
  const attempt = `${action.id}:${championId}`;
  if (attempt === autoTried && Date.now() - autoTriedAt < 3000) return false; // niet elke tick opnieuw als de client weigert
  autoTried = attempt; autoTriedAt = Date.now();
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
  const best = bestPickRow();
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

// Wat de tool zou bannen of picken als er niets gehoverd staat.
function bestBan(session) {
  const allies = new Set((session.myTeam || []).map((p) => p.championPickIntent || p.championId).filter(Boolean));
  return state.bans?.list?.find((x) => !allies.has(x.cid) && !state.bans.pool.includes(x.champ?.lolaSlug))?.cid || 0;
}
// Beste vrije champ uit de pool; is de hele pool weg (gebanned/gepakt), dan de beste counter pick.
function bestPickRow() {
  const p = state.picks;
  if (!p) return null;
  // Alleen de main (Danny: Shaco): geen andere champ hoveren of locken.
  const pr = prof();
  if (pr.onlyMain && !pr.backups.length && p.lane === pr.lane) return p.pool?.find((r) => !r.taken && pr.pool.includes(r.champ.lolaSlug)) || null;
  return p.pool?.find((r) => r.pick && !r.taken) || p.pool?.find((r) => !r.taken && r.wr != null) || p.pool?.find((r) => !r.taken) || p.best?.find((r) => r.wr != null) || null;
}
const bestPick = () => bestPickRow()?.champ.id || 0;

// adjustedTimeLeftInPhase is de resttijd op het moment internalNowInEpochMs; de client werkt
// dat getal alleen bij als er iets in champ select verandert. Zelf de verstreken tijd aftrekken,
// anders zakt hij nooit onder LOCK_AT_MS als niemand meer iets doet.
function timeLeft(timer) {
  const left = timer?.adjustedTimeLeftInPhase;
  if (!Number.isFinite(left) || timer.isInfinite) return Infinity;
  const at = Number(timer.internalNowInEpochMs);
  return Number.isFinite(at) && at > 0 ? left - Math.max(0, Date.now() - at) : left;
}

// Lock/ban: eerst de champ zetten, dan de actie afronden. Oudere clients doen dat in één PATCH
// met completed: true; nieuwere negeren completed en willen POST .../complete.
async function completeAction(action, championId) {
  const url = `/lol-champ-select/v1/session/actions/${action.id}`;
  if (action.championId !== championId) await lcu.patch(url, { championId });
  try { await lcu.post(`${url}/complete`); }
  catch { await lcu.patch(url, { championId, completed: true }); }
}

let lockTriedAt = 0, lockDebugged = "";
const lockDone = new Map(); // actionId -> tijd van gelukte lock; na 3 s nog open = opnieuw proberen
async function autoLock(session, champs) {
  const left = timeLeft(session.timer);
  // Eén keer per beurt loggen wat de tool ziet, zodat een mislukte lock te verklaren is.
  for (const type of ["ban", "pick"]) {
    const a = myAction(session, type);
    if (a?.isInProgress && lockDebugged !== `${a.id}`) { lockDebugged = `${a.id}`; log(`Jouw ${type}-beurt: ${Number.isFinite(left) ? Math.round(left / 1000) + "s" : "geen timer"}, fase ${session.timer?.phase || "?"}, gehoverd ${champs[a.championId]?.name || "niets"}`); }
  }
  if (left > LOCK_AT_MS || session.timer?.phase === "PLANNING") return; // in PLANNING kan bannen nog niet
  const taken = takenIds(session);
  for (const type of ["ban", "pick"]) {
    if (!(type === "ban" ? settings.autoBan : settings.autoLock)) continue;
    const action = myAction(session, type);
    if (!action?.isInProgress) continue;
    // Gehoverde champ die intussen gebanned/gepakt is kan niet meer: dan de beste vrije.
    let championId = action.championId;
    if (!championId || (type === "pick" && taken.has(championId) && !(session.myTeam || []).some((p) => p.cellId === session.localPlayerCellId && p.championId === championId))) {
      championId = type === "ban" ? bestBan(session) : bestPick();
    }
    if (!championId) { if (lockTried !== `${action.id}:none`) { lockTried = `${action.id}:none`; log(`Auto ${type}: geen champ om te ${type === "ban" ? "bannen" : "locken"} (data nog niet geladen?)`); } continue; }
    const attempt = `${action.id}:${championId}`;
    if (attempt === lockTried && Date.now() - lockTriedAt < 1500) continue; // client weigerde: even wachten
    if (lockDone.has(action.id) && Date.now() - lockDone.get(action.id) < 3000) continue; // al gelukt; de client werkt de session even later bij
    lockTried = attempt; lockTriedAt = Date.now();
    const name = champs[championId]?.name || championId;
    try {
      await completeAction(action, championId);
      lockDone.set(action.id, Date.now());
      log(type === "ban" ? `Automatisch gebanned: ${name}` : `Automatisch gelockt: ${name}`);
    } catch (e) { log(`${type === "ban" ? "Bannen" : "Locken"} mislukt (${name}): ${e.message}`); }
  }
}

async function processChampSelect(session) {
  const champs = await dd.champions();
  if (settings.tier === "all") settings.tier = "auto";
  const patch = await refreshData();
  if (!state.champUrl) { const urls = await dd.imageUrls(); state.champUrl = urls.champion(""); }
  const actions = (session.actions || []).flat();
  const bansOpen = actions.some((a) => a.type === "ban" && !a.completed);
  const myBan = actions.find((a) => a.type === "ban" && a.actorCellId === session.localPlayerCellId);
  const inBan = session.timer?.phase === "PLANNING" || (bansOpen && (session.timer?.phase === "BAN_PICK" || !session.timer?.phase || !!myBan?.isInProgress));
  if (inBan !== state.inBan) { state.inBan = inBan; push(); }
  // Hun team (ook gehoverd) voor de tegenstander-kiezer in de app.
  const theirIds = (session.theirTeam || []).map((p) => p.championId || p.championPickIntent || 0).filter((x) => x > 0);
  if (manualEnemyId && !theirIds.includes(manualEnemyId)) { manualEnemyId = 0; lastKey = ""; lastPickKey = ""; }
  if (theirIds.join(",") !== state.theirTeam.map((c) => c.id).join(",")) { state.theirTeam = theirIds.map((id) => champs[id]).filter(Boolean); push(); }
  if (inBan) await processBans(session, champs, patch);
  await processCounterPicks(session, champs, patch);
  await autoHoverBan(session);
  await autoHoverPick(session, champs);
  await processPick(session, champs, patch);
}

// Bannen/locken in een eigen, snelle lus: de gewone tick wacht soms seconden op lolalytics
// en mist dan de laatste 8 seconden van je beurt.
let lockBusy = false;
async function lockTick() {
  if (lockBusy || !lcu.connected || state.phase !== "ChampSelect" || !(settings.autoBan || settings.autoLock)) return;
  lockBusy = true;
  try { const s = await lcu.champSelect(); if (s) await autoLock(s, await dd.champions()); }
  catch (e) { log("auto ban/lock: " + e.message); }
  finally { lockBusy = false; }
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
    const line = goals.fromEog(eog);
    const tips = goals.tips(line, prof().lane);
    if (!tips.length) tips.push("Alle vier de doelen gehaald. Werkpunt blijft: games afsluiten als je voor staat (Baron/torens, geen chases).");
    state.postgame = { champ: champ?.name, win: eog.gameLength && (eog.teams || []).find((t) => t.isPlayerTeam)?.isWinningTeam, kda: line.kda, cs, csm: line.csm, deaths: line.deaths, kp: line.kp, cw: line.cw, mins: Math.round(mins), vision: s.VISION_SCORE || 0, tips };
    log(`Game klaar: ${champ?.name || "?"} ${line.kda}, KP ${line.kp ?? "?"}%, ${line.cw ?? "?"} control wards, ${line.csm} cs/min`);
    push();
    setTimeout(() => refreshMyStats(), 15000); // match history is pas even later bijgewerkt
  } catch { /* geen eog-data */ }
}

// ---------- in-game overlay ----------
// Klein, doorklikbaar paneel rechts in beeld. Werkt alleen als League in "Borderless" of
// "Windowed" staat (bij echt fullscreen tekent Windows niets over de game heen).
// Ctrl+Shift+L zet hem aan/uit.
let overlay = null, overlayHidden = false, liveBusy = false, liveFails = 0, lastFront = null, lastLiveErr = "";
const OVERLAY_W = 340, OVERLAY_H = 640;
function overlayBounds() {
  const b = screen.getPrimaryDisplay().bounds;
  const right = b.x + b.width - OVERLAY_W - 12, left = b.x + 12;
  const mid = b.y + Math.round(b.height * 0.24), up = b.y + Math.round(b.height * 0.06);
  const pos = { right: [right, mid], left: [left, mid], topright: [right, up], topleft: [left, up] }[settings.overlayPos] || [right, mid];
  return { x: pos[0], y: pos[1], width: OVERLAY_W, height: OVERLAY_H };
}
function ensureOverlay() {
  if (overlay && !overlay.isDestroyed()) return overlay;
  overlay = new BrowserWindow({
    ...overlayBounds(),
    frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, show: false,
    // Mac: een "panel" mag over een fullscreen-app (de game in zijn eigen Space) heen tekenen.
    ...(process.platform === "darwin" ? { type: "panel", fullscreenable: false } : {}),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setIgnoreMouseEvents(true);
  overlay.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  overlay.loadFile(path.join(__dirname, "overlay", "overlay.html"));
  overlay.on("closed", () => { overlay = null; });
  return overlay;
}
function hideOverlay() { if (overlay && !overlay.isDestroyed()) overlay.hide(); }

async function liveTick() {
  if (liveBusy) return;
  if (!settings.overlay || overlayHidden || state.phase !== "InProgress") { hideOverlay(); fg.stop(); return; }
  // Alleen tonen als de game zelf vooraan staat: niet in het laadscherm, de client of na alt-tab.
  const front = fg.gameInFront();
  if (fg.current() !== lastFront) { lastFront = fg.current(); log(`Overlay: voorgrond = ${lastFront || "?"} → ${front ? "tonen" : "verbergen"}`); }
  if (!front) { hideOverlay(); return; }
  liveBusy = true;
  try {
    const d = await live.allGameData();
    liveFails = 0; lastLiveErr = "";
    const [itemData, champs, urls] = await Promise.all([dd.items(), dd.champions(), dd.imageUrls()]);
    const opts = state.items?.options || {};
    const plan = {
      build: state.teamBuild?.build || state.items?.core || [],
      extra: [...(state.items?.situational || []), ...[4, 5, 6].flatMap((k) => (opts[k] || []).map((o) => o.id))],
    };
    const p = prof();
    const lane = state.lane || p.lane;
    const lv = live.analyse(d, {
      itemData, champs, plan, targets: goals.targetsFor(lane), vpmMin: goals.vpmTarget(lane),
      lane, laneEnemyId: state.enemy?.id || null, roles: state.enemyRoles || {}, duo: p.duo || null,
      show: { duo: settings.overlayDuo, spikes: settings.overlaySpikes, coach: settings.overlayCoach },
      tips: (state.guide?.sections || []).filter((x) => state.enemy && (x.title.startsWith("Tegen " + state.enemy.name) || x.title.startsWith("Deze matchup"))).flatMap((x) => x.items).filter((x) => !/^Jouw eigen games/.test(x)),
    });
    if (!lv || (d.gameData?.gameTime || 0) < 5) { hideOverlay(); return; } // laadscherm
    const o = ensureOverlay();
    if (lv) {
      o.webContents.send("live", { ...lv, compact: !!settings.overlayCompact, itemUrl: urls.item("").replace(/\.png$/, ""), champUrl: urls.champion("") });
      if (!o.isVisible()) o.showInactive();
      // De game zet zichzelf soms boven alles; elke keer opnieuw bovenop leggen.
      o.setAlwaysOnTop(true, "screen-saver", 1);
      o.moveTop();
    }
  } catch (e) {
    // Laadscherm of game net klaar: API nog/niet meer bereikbaar. Eén keer per soort fout loggen.
    if (e?.message !== lastLiveErr) { lastLiveErr = e?.message; log("Overlay: game-data niet bereikbaar (" + (e?.message || e) + ")"); }
    if (++liveFails > 3) hideOverlay();
  } finally { liveBusy = false; }
}

// ---------- hoofdlus ----------
async function tick() {
  if (!lcu.connected) {
    const ok = await lcu.connect();
    state.client = ok ? "verbonden" : "zoeken";
    if (ok) { log("Verbonden met League-client"); refreshMyStats(); refreshRank().then(() => refreshData()).then(push).catch(() => {}); }
    push();
    if (!ok) return;
  }
  const phase = await lcu.gameflowPhase();
  if (phase === "None" && !(await lcu.connect())) { state.client = "zoeken"; lastKey = ""; lastBanKey = ""; lastPickKey = ""; push(); return; }
  if (phase !== state.phase) {
    state.phase = phase;
    if (phase === "ChampSelect") { Object.assign(state, blank()); runeKey = null; buildIdx = null; baseItems = null; baseRunes = null; state.postgame = null; autoPickId = 0; autoBanId = 0; autoTried = ""; lockTried = ""; lockDone.clear(); manualEnemyId = 0; refreshMyStats(); lastKey = ""; lastBanKey = ""; lastPickKey = ""; }
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
  win.on("closed", () => { win = null; if (overlay && !overlay.isDestroyed()) overlay.destroy(); });
}

ipcMain.handle("get-state", () => view());
ipcMain.handle("set-settings", (_e, patch) => {
  settings = { ...settings, ...patch }; saveSettings();
  if ("alwaysOnTop" in patch && win) win.setAlwaysOnTop(!!settings.alwaysOnTop, "floating");
  if ("tier" in patch) refreshData().then(push).catch(() => {});
  if ("profile" in patch) refreshMyStats();
  if ("overlayPos" in patch && overlay && !overlay.isDestroyed()) overlay.setBounds(overlayBounds());
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
// Andere rune page of build kiezen: direct in de client zetten.
ipcMain.handle("choose-runes", async (_e, idx) => {
  const pages = state.runes?.pages;
  if (!state.me || !pages?.[idx]) return false;
  runeKey = pages[idx].label; state.runeIdx = idx;
  const title = `${state.me.name}${state.enemy ? " vs " + state.enemy.name : ""}`;
  try { await apply.applyRunes(lcu, pages[idx], title); state.applied.runes = title; log(`Runes gezet: ${pages[idx].label}`); }
  catch (e) { log("Runes zetten mislukt: " + e.message); }
  lastKey = ""; push(); return true;
});
ipcMain.handle("choose-build", (_e, idx) => {
  if (!state.me || !(idx === null || baseItems?.builds?.[idx])) return false;
  buildIdx = idx; lastKey = ""; push(); // volgende tick bouwt items/guide opnieuw en zet de item set
  log(idx === null ? "Build: meest gespeeld" : `Build gekozen: #${idx + 1}`);
  return true;
});
// Tegenstander in jouw lane zelf kiezen (0/null = weer automatisch).
ipcMain.handle("set-enemy", (_e, id) => {
  manualEnemyId = Number.isInteger(id) && id > 0 ? id : 0;
  lastKey = ""; lastPickKey = "";
  log(manualEnemyId ? `Tegenstander zelf gekozen: ${state.theirTeam.find((c) => c.id === manualEnemyId)?.name || manualEnemyId}` : "Tegenstander: weer automatisch");
  push(); return true;
});
// Eigen champion pool / backups instellen. Tekst met namen, gescheiden door komma's.
// Leeg = de standaard van het profiel.
const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, "");
ipcMain.handle("set-pool", async (_e, { profile, pool, backups }) => {
  const key = PROFILES[profile] ? profile : settings.profile;
  const champs = await dd.champions();
  const index = {};
  for (const c of Object.values(champs)) for (const k of [c.name, c.lolaSlug, c.slug]) index[norm(k)] = c.lolaSlug;
  const unknown = [];
  const parse = (text) => String(text || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)
    .map((x) => index[norm(x)] || (unknown.push(x), null)).filter((x, i, a) => x && a.indexOf(x) === i);
  const p = parse(pool), b = parse(backups).filter((x) => !p.includes(x));
  const own = { ...(settings.pools || {}) };
  if (!p.length && !b.length) delete own[key];
  else own[key] = { ...(p.length ? { pool: p } : {}), backups: b };
  settings = { ...settings, pools: own }; saveSettings();
  lastKey = ""; lastBanKey = ""; lastPickKey = "";
  log(`Pool ${PROFILES[key].name}: ${named(prof(key).pool).join(", ")}${prof(key).backups.length ? ` · backups ${named(prof(key).backups).join(", ")}` : ""}${unknown.length ? ` · onbekend: ${unknown.join(", ")}` : ""}`);
  push(); return { unknown };
});
ipcMain.handle("set-duo", (_e, { profile, name }) => {
  const key = PROFILES[profile] ? profile : settings.profile;
  settings = { ...settings, duoNames: { ...(settings.duoNames || {}), [key]: String(name || "").trim() } }; saveSettings();
  push(); return true;
});
ipcMain.handle("reapply", async () => { lastKey = ""; lastBanKey = ""; lastPickKey = ""; state.applied = { runes: null, items: null, spells: null }; await tick(); return true; });

app.whenReady().then(async () => {
  dd.setCacheDir(path.join(app.getPath("userData"), "ddragon"));
  loadSettings();
  createWindow();
  try { log("Data Dragon " + (await dd.version())); slugNames = Object.fromEntries(Object.values(await dd.champions()).map((c) => [c.lolaSlug, c.name])); await refreshData(); push(); } catch (e) { log("Data niet bereikbaar: " + e.message); }
  checkUpdate();
  setInterval(() => tick().catch((e) => log("tick: " + e.message)), 1500);
  setInterval(() => lockTick(), 500);
  setInterval(() => liveTick(), 2000);
  try {
    globalShortcut.register("CommandOrControl+Shift+L", () => { overlayHidden = !overlayHidden; if (overlayHidden) hideOverlay(); log(overlayHidden ? "Overlay verborgen (Ctrl+Shift+L)" : "Overlay weer aan"); });
  } catch { /* sneltoets bezet */ }
  setInterval(() => refreshData().then(push).catch(() => {}), 60 * 60 * 1000);
  setInterval(checkUpdate, 6 * 60 * 60 * 1000);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("will-quit", () => { try { globalShortcut.unregisterAll(); } catch { /* ok */ } fg.stop(); });
app.on("window-all-closed", () => { app.quit(); });
