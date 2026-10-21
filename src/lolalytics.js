// Live build-data van lolalytics (onofficiële JSON-endpoint die de site zelf
// gebruikt). Werkt met de champion-slug, niet het id.
//   ep=rune           runes (most played + highest winrate), optioneel vs=<slug>
//   ep=build-itemset  itemSet1..5 (starters .. volledige 5-item builds), itemBootSet
//   ep=counter        matchups: per tegenstander vsWr, n, defaultLane
// Geldige tiers: bronze, silver, gold, gold_plus, platinum_plus, emerald_plus, all.

const BASE = "https://a1.lolalytics.com/mega/";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
  Referer: "https://lolalytics.com/",
  Origin: "https://lolalytics.com",
};

const memo = new Map();
const TTL = 30 * 60 * 1000;

async function call(params) {
  const key = new URLSearchParams(params).toString();
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const r = await fetch(`${BASE}?${key}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`lolalytics ${r.status} (${key})`);
  const v = await r.json();
  if (v && v.status && Object.keys(v).length <= 2) throw new Error(`lolalytics status ${v.status} (${key})`);
  memo.set(key, { t: Date.now(), v });
  return v;
}

// Let op: lolalytics' JSON-endpoint negeert matchup-parameters (getest 20-10-2026);
// runes/items zijn dus per champion+lane+tier, de matchup komt uit ep=counter.
function base(ep, { patch, slug, lane, tier }) {
  return { ep, v: "1", patch, c: slug, lane, tier, queue: "ranked", region: "all" };
}

async function runePages(opts) {
  const d = await call(base("rune", opts));
  const r = d?.summary?.runes;
  if (!r?.pick?.set) throw new Error("geen rune-data");
  const mk = (x, label) => x?.set && ({
    label, wr: x.wr, n: x.n,
    pri: (x.set.pri || []).map(Number), sec: (x.set.sec || []).map(Number), mod: (x.set.mod || []).map(Number),
  });
  const pages = [mk(r.pick, "Meest gespeeld")];
  if (r.win && r.win !== r.pick) pages.push(mk(r.win, "Hoogste winrate"));
  return { pages: pages.filter(Boolean), analysed: d.analysed, avgWr: d.avgWinRate, header: d.header };
}

const ids = (entry) => String(entry[0]).split("_").map(Number).filter(Number.isFinite);

async function itemBuild(opts, isBoot) {
  const d = await call(base("build-itemset", opts));
  const s = d?.itemSets || {};
  const starters = [...new Set((s.itemSet1 || []).slice(0, 4).flatMap(ids))].slice(0, 3);
  const boot = [...new Set((s.itemBootSet1 || []).slice(0, 8).flatMap(ids))].find(isBoot) || null;
  const full = (s.itemSet5 || []).map((e) => ({ items: ids(e), picks: Number(e[1]) || 0, wins: Number(e[2]) || 0 }))
    .map((b) => ({ ...b, wr: b.picks ? Math.round((b.wins / b.picks) * 1000) / 10 : 0 }));
  const core = full[0]?.items || [];
  const ordered = core.length ? [core[0], ...(boot ? [boot] : []), ...core.slice(1)] : boot ? [boot] : [];
  const freq = new Map();
  for (const b of full.slice(1, 10)) for (const id of b.items) if (!isBoot(id) && !core.includes(id)) freq.set(id, (freq.get(id) || 0) + b.picks);
  const situational = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 6);
  return { starters, boot, core: ordered, situational, builds: full.slice(0, 8) };
}

async function counters(opts) {
  const d = await call(base("counter", opts));
  return { stats: d?.stats || null, list: Array.isArray(d?.counters) ? d.counters : [] };
}

// Welke patch-waarde heeft genoeg data? Direct na een nieuwe patch is de nieuwe
// bijna leeg; dan nemen we de vorige of "30" (laatste 30 dagen).
const patchMemo = new Map();
async function resolvePatch(ddPatch, slug, lane, tier) {
  const key = `${ddPatch}|${tier}`;
  if (patchMemo.has(key) && Date.now() - patchMemo.get(key).t < 60 * 60 * 1000) return patchMemo.get(key).v;
  const [maj, min] = ddPatch.split(".").map(Number);
  const candidates = [ddPatch, `${maj}.${min - 1}`, "30"];
  let best = { patch: "30", n: 0 };
  for (const patch of candidates) {
    try {
      const d = await call(base("rune", { patch, slug, lane, tier }));
      const n = d?.summary?.runes?.pick?.n || 0;
      if (n >= 50000) { best = { patch, n }; break; }
      if (n > best.n) best = { patch, n };
    } catch { /* volgende */ }
  }
  patchMemo.set(key, { t: Date.now(), v: best.patch });
  return best.patch;
}

// Lane-verdeling van een champion (uit de rune-header): om de tegenstander in jouw lane te vinden.
async function defaultLane(opts) {
  try { const d = await call(base("rune", opts)); return d?.header?.defaultLane || null; } catch { return null; }
}

module.exports = { runePages, itemBuild, counters, resolvePatch, defaultLane };
