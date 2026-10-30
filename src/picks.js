// Pick-advies voordat je lockt: counter picks zodra de tegenstander in jouw lane
// bekend is, anders de veiligste blind pick uit je pool.
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

async function counterAdvice({ enemy, lane, pool, taken, champs, patch, tier }) {
  const opts = { lane, patch, tier };
  const poolRows = await Promise.all(pool.map(async (c) => ({ champ: c, taken: taken.has(c.id), ...(await vsEnemy({ ...opts, slug: c.lolaSlug, enemyId: enemy.id })) })));
  const { list } = await lol.counters({ ...opts, slug: enemy.lolaSlug });
  const inPool = new Set(pool.map((c) => c.id));
  const candidates = list
    .filter((r) => r.defaultLane === lane && r.n >= MIN_GAMES && !taken.has(r.cid) && !inPool.has(r.cid) && champs[r.cid])
    .sort((a, b) => a.vsWr - b.vsWr).slice(0, CANDIDATES);
  const best = await Promise.all(candidates.map(async (r) => ({ champ: champs[r.cid], ...((await vsEnemy({ ...opts, slug: champs[r.cid].lolaSlug, enemyId: enemy.id })) || { wr: round1(100 - r.vsWr), n: r.n }) })));
  const byWr = (a, b) => (b.wr ?? -1) - (a.wr ?? -1);
  return { mode: "counter", lane, enemy, pool: poolRows.sort(byWr), best: best.sort(byWr).slice(0, SHOW) };
}

// Geen tegenstander bekend: verwachte winrate over alle matchups in de lane, gewogen
// naar hoe vaak je ze tegenkomt, plus de matchups waar je het meest van moet vrezen.
async function blindAdvice({ lane, pool, taken, champs, patch, tier }) {
  const rows = await Promise.all(pool.map(async (c) => {
    let list = [];
    try { list = (await lol.counters({ patch, slug: c.lolaSlug, lane, tier })).list; } catch { /* lege rij */ }
    const matchups = list.filter((r) => r.defaultLane === lane && r.n >= MIN_GAMES);
    const games = matchups.reduce((s, r) => s + r.n, 0);
    const wr = games ? round1(matchups.reduce((s, r) => s + r.vsWr * r.n, 0) / games) : null;
    const worst = [...matchups].sort((a, b) => a.vsWr - b.vsWr).slice(0, 3).map((r) => ({ name: champs[r.cid]?.name || "?", wr: r.vsWr }));
    return { champ: c, taken: taken.has(c.id), wr, n: games, worst };
  }));
  return { mode: "blind", lane, enemy: null, pool: rows.sort((a, b) => (b.wr ?? -1) - (a.wr ?? -1)), best: [] };
}

async function advice({ enemy, ...rest }) {
  return enemy ? counterAdvice({ enemy, ...rest }) : blindAdvice(rest);
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
