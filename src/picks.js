// Pick-advies voordat je lockt: counter picks zodra de tegenstander in jouw lane
// bekend is, anders de veiligste blind pick uit je pool. Zodra er tegenstanders bekend
// zijn telt het hele team mee (vslane), niet alleen de tegenstander in jouw lane.
// vsWr in ep=counter is de winrate van de opgevraagde champ; voor "wat counter X"
// halen we daarom de lijst van X op en daarna de eigen lijst van elke kandidaat.

const lol = require("./lolalytics");

const MIN_GAMES = 150;          // onder dit aantal is een matchup ruis
const MIN_LANE_SHARE = 15;      // % van de games in jouw lane om als laner te tellen
const CANDIDATES = 8;           // kandidaten waarvan we de eigen winrate ophalen
const SHOW = 5;

const round1 = (x) => Math.round(x * 10) / 10;

// Wie van de tegenstanders staat in jouw lane? Lane-percentages zijn beter dan
// defaultLane: ze werken ook als de champ geen counter-rij met jou heeft.
async function laneOpponent({ enemyIds, lane, champs, patch, tier }) {
  let best = null;
  for (const id of enemyIds) {
    const c = champs[id]; if (!c) continue;
    let share = 0;
    try { share = (await lol.counters({ patch, slug: c.lolaSlug, lane, tier })).stats?.lanes?.[lane] || 0; } catch { /* volgende */ }
    if (share >= MIN_LANE_SHARE && (!best || share > best.share)) best = { champ: c, share };
  }
  return best?.champ || null;
}

async function vsEnemy({ slug, enemyId, lane, patch, tier }) {
  try {
    const { list } = await lol.counters({ patch, slug, lane, tier });
    const row = list.find((r) => r.cid === enemyId);
    return row ? { wr: row.vsWr, n: row.n } : null;
  } catch { return null; }
}

const LANES = ["top", "jungle", "middle", "bottom", "support"];
const LANE_WEIGHT = 2;   // de directe tegenstander in jouw lane telt dubbel
const DOUBT = 1.0;       // binnen zoveel %-punt van de beste = twijfel → voorkeurs-champ

// Winrate van één pool-champ tegen elk bekend vijandelijk team-lid. Per tegenstander
// pakken we de lane waarin hij het vaakst tegen deze champ staat (vslane met de meeste games);
// de tegenstander in jouw eigen lane staat vast.
async function vsTeam({ slug, enemyIds, laneEnemyId, lane, patch, tier, champs }) {
  const lists = {};
  await Promise.all(LANES.map(async (vslane) => {
    try { lists[vslane] = (await lol.counters({ patch, slug, lane, vslane, tier })).list; } catch { lists[vslane] = []; }
  }));
  const vs = [];
  for (const id of enemyIds) {
    let best = null;
    for (const vslane of id === laneEnemyId ? [lane] : LANES) {
      const row = lists[vslane].find((r) => r.cid === id);
      if (row && row.n >= MIN_GAMES / 3 && (!best || row.n > best.n)) best = { ...row, vslane };
    }
    if (best) vs.push({ id, name: champs[id]?.name || "?", wr: best.vsWr, n: best.n, lane: best.vslane, laner: id === laneEnemyId });
  }
  const w = (v) => (v.laner ? LANE_WEIGHT : 1);
  const total = vs.reduce((s, v) => s + w(v), 0);
  const wr = total ? round1(vs.reduce((s, v) => s + v.wr * w(v), 0) / total) : null;
  return { wr, n: vs.reduce((s, v) => s + v.n, 0), vs };
}

// Bij twijfel (geen data of binnen DOUBT van de beste) gaat de voorkeurs-champ bovenaan.
function rank(rows, favorite) {
  const byWr = (a, b) => (b.wr ?? -1) - (a.wr ?? -1);
  rows.sort(byWr);
  if (!favorite) return rows;
  const fav = rows.find((r) => r.champ.lolaSlug === favorite && !r.taken);
  const top = rows.find((r) => !r.taken && r.wr != null);
  if (fav && (!top || fav.wr == null || top.wr - fav.wr <= DOUBT)) {
    fav.favorite = true;
    rows.splice(rows.indexOf(fav), 1);
    rows.unshift(fav);
  }
  return rows;
}

// Tegenstanders bekend: jouw pool gescoord tegen het hele bekende team; bij een bekende
// tegenstander in jouw lane ook de 5 beste champs in die lane tegen hem.
async function counterAdvice({ enemy, enemyIds, lane, pool, taken, champs, patch, tier, favorite }) {
  const opts = { lane, patch, tier };
  const ids = enemyIds?.length ? enemyIds : [enemy.id];
  const poolRows = await Promise.all(pool.map(async (c) => {
    const t = await vsTeam({ ...opts, slug: c.lolaSlug, enemyIds: ids, laneEnemyId: enemy?.id, champs });
    const laneRow = t.vs.find((v) => v.laner);
    return { champ: c, taken: taken.has(c.id), wr: t.wr, n: t.n, vs: t.vs, laneWr: laneRow?.wr ?? null };
  }));
  let best = [];
  if (enemy) {
    const { list } = await lol.counters({ ...opts, slug: enemy.lolaSlug });
    const inPool = new Set(pool.map((c) => c.id));
    const candidates = list
      .filter((r) => r.defaultLane === lane && r.n >= MIN_GAMES && !taken.has(r.cid) && !inPool.has(r.cid) && champs[r.cid])
      .sort((a, b) => a.vsWr - b.vsWr).slice(0, CANDIDATES);
    best = await Promise.all(candidates.map(async (r) => ({ champ: champs[r.cid], ...((await vsEnemy({ ...opts, slug: champs[r.cid].lolaSlug, enemyId: enemy.id })) || { wr: round1(100 - r.vsWr), n: r.n }) })));
    best = best.sort((a, b) => (b.wr ?? -1) - (a.wr ?? -1)).slice(0, SHOW);
  }
  return { mode: "counter", lane, enemy: enemy || null, enemies: ids.map((id) => champs[id]).filter(Boolean), pool: rank(poolRows, favorite), best };
}

// Geen tegenstander bekend: verwachte winrate over alle matchups in de lane, gewogen
// naar hoe vaak je ze tegenkomt, plus de matchups waar je het meest van moet vrezen.
async function blindAdvice({ lane, pool, taken, champs, patch, tier, favorite }) {
  const rows = await Promise.all(pool.map(async (c) => {
    let list = [];
    try { list = (await lol.counters({ patch, slug: c.lolaSlug, lane, tier })).list; } catch { /* lege rij */ }
    const matchups = list.filter((r) => r.defaultLane === lane && r.n >= MIN_GAMES);
    const games = matchups.reduce((s, r) => s + r.n, 0);
    const wr = games ? round1(matchups.reduce((s, r) => s + r.vsWr * r.n, 0) / games) : null;
    const worst = [...matchups].sort((a, b) => a.vsWr - b.vsWr).slice(0, 3).map((r) => ({ name: champs[r.cid]?.name || "?", wr: r.vsWr }));
    return { champ: c, taken: taken.has(c.id), wr, n: games, worst };
  }));
  return { mode: "blind", lane, enemy: null, pool: rank(rows, favorite), best: [] };
}

async function advice({ enemy, enemyIds, ...rest }) {
  return enemy || enemyIds?.length ? counterAdvice({ enemy, enemyIds, ...rest }) : blindAdvice(rest);
}

// Eigen record per champion uit de matchhistorie van de client (alleen Summoner's Rift).
const RIFT_QUEUES = new Set([400, 420, 430, 440, 490]);
function myStats(history) {
  const out = {};
  for (const g of history?.games?.games || []) {
    if (!RIFT_QUEUES.has(g.queueId)) continue;
    const p = g.participants?.[0];
    if (!p?.championId) continue;
    const s = (out[p.championId] ||= { wins: 0, games: 0 });
    s.games += 1;
    if (p.stats?.win) s.wins += 1;
  }
  return out;
}

module.exports = { laneOpponent, advice, myStats };
