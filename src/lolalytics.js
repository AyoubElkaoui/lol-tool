// Live build-data van lolalytics (onofficiële JSON-endpoint die de site zelf
// gebruikt). Werkt met de champion-slug, niet het id.
//   ep=rune           runes (most played + highest winrate), optioneel vs=<slug>
//   ep=build-itemset  itemSetN = eerste N voltooide items (ongesorteerd!), itemBootSetN = idem met boots
//                     (startitems zitten hier niet in: die komen van u.gg)
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
// ep=counter kent wel vslane: de matchups tegen wie in díé lane van het andere team staat.
function base(ep, { patch, slug, lane, tier, vslane }) {
  return { ep, v: "1", patch, c: slug, lane, ...(vslane && vslane !== lane ? { vslane } : {}), tier, queue: "ranked", region: "all" };
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
  // pick en win zijn vaak precies dezelfde page: dan niet twee keer tonen.
  if (r.win?.set && JSON.stringify(r.win.set) !== JSON.stringify(r.pick.set)) pages.push(mk(r.win, "Hoogste winrate"));
  return { pages: pages.filter(Boolean), analysed: d.analysed, avgWr: d.avgWinRate, header: d.header };
}

const ids = (entry) => String(entry[0]).split("_").map(Number).filter(Number.isFinite);
const rows = (list) => (list || []).map((e) => ({ items: ids(e), picks: Number(e[1]) || 0, wins: Number(e[2]) || 0 }))
  .filter((r) => r.items.length).sort((a, b) => b.picks - a.picks); // lolalytics levert ze ongesorteerd
const wr = (r) => (r.picks ? Math.round((r.wins / r.picks) * 1000) / 10 : 0);

// itemSetN = de eerste N voltooide items (zonder boots), in koopvolgorde. Een build volgen we
// stap voor stap: bij elke stap de meest gekochte voortzetting van wat er al ligt.
// Onder MIN_STEP games stoppen we; de rest vult main.js aan met u.gg's 4e-6e item.
const MIN_STEP = 30;
function extend(path, sets, from) {
  const out = [...path];
  for (let n = from; n <= 5; n++) {
    const list = sets[n] || [];
    const prefix = list.find((r) => r.items.length === n && out.every((id, i) => r.items[i] === id));
    // Geen exacte volgorde? Dan dezelfde items in een andere volgorde.
    const any = prefix || list.find((r) => r.items.length === n && out.every((id) => r.items.includes(id)));
    if (!any || any.picks < MIN_STEP) break;
    const next = any.items.find((id) => !out.includes(id));
    if (next == null) break;
    out.push(next);
  }
  return out;
}

async function itemBuild(opts, isBoot) {
  const d = await call(base("build-itemset", opts));
  const s = d?.itemSets || {};
  const sets = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, rows(s[`itemSet${n}`])]));
  if (!sets[1].length) throw new Error("geen item-data");

  // Boots: tel per boot de games over alle boot-sets (de eerste paar items + boots).
  const bootPicks = new Map();
  for (let n = 2; n <= 4; n++) for (const r of rows(s[`itemBootSet${n}`])) for (const id of r.items) if (isBoot(id)) bootPicks.set(id, (bootPicks.get(id) || 0) + r.picks);
  const boot = [...bootPicks.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Builds om uit te kiezen: de populairste eerste-3-items, elk doorgetrokken naar 5 items.
  const starts = sets[3].filter((r) => r.picks >= MIN_STEP).slice(0, 8);
  const builds = (starts.length ? starts : sets[2].slice(0, 4))
    .map((r) => ({ items: extend(r.items, sets, r.items.length + 1), picks: r.picks, wins: r.wins, wr: wr(r) }))
    .filter((b, i, a) => a.findIndex((x) => JSON.stringify(x.items) === JSON.stringify(b.items)) === i);
  const main = builds[0]?.items || extend([sets[1][0].items[0]], sets, 2);
  const core = [main[0], ...(boot ? [boot] : []), ...main.slice(1)];

  // Situationeel: wat in volle builds vaak gekocht wordt maar niet in de core zit.
  const freq = new Map();
  for (const n of [4, 5]) for (const r of sets[n]) for (const id of r.items) if (!isBoot(id) && !main.includes(id)) freq.set(id, (freq.get(id) || 0) + r.picks);
  for (const r of sets[1]) if (!main.includes(r.items[0])) freq.set(r.items[0], (freq.get(r.items[0]) || 0) + r.picks / 10); // andere eerste items
  const situational = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 6);
  return { starters: [], boot, core, situational, builds };
}

// Runes tegen één tegenstander. De JSON-endpoint negeert vs=, maar de vs-pagina van de site
// heeft ze wel: die rendert de data als Qwik-state (<script type="qwik/json">), met
// verwijzingen in base36 naar andere objecten. We zoeken de rune-sets {wr, n, page, set}.
const vsMemo = new Map();
async function vsRunePages({ patch, slug, lane, tier, vs, vslane }) {
  const url = `https://lolalytics.com/lol/${slug}/vs/${vs}/build/?lane=${lane}&vslane=${vslane || lane}&tier=${tier}&patch=${patch}`;
  const hit = vsMemo.get(url);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const r = await fetch(url, { headers: { "User-Agent": HEADERS["User-Agent"] } });
  if (!r.ok) throw new Error(`lolalytics vs ${r.status}`);
  const html = await r.text();
  const m = html.match(/<script type="qwik\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("lolalytics vs: geen data in pagina");
  const objs = JSON.parse(m[1]).objs || [];
  const ref = (v) => (typeof v === "string" && /^[0-9a-z]+$/.test(v) && parseInt(v, 36) < objs.length ? objs[parseInt(v, 36)] : v);
  const nums = (v) => { const a = ref(v); return Array.isArray(a) ? a.map(ref).map(Number).filter(Number.isFinite) : []; };
  const sets = [];
  for (const o of objs) {
    if (!o || typeof o !== "object" || Array.isArray(o) || !("set" in o && "wr" in o && "n" in o && "page" in o)) continue;
    const set = ref(o.set);
    if (!set || typeof set !== "object") continue;
    const page = { wr: Number(ref(o.wr)), n: Number(ref(o.n)), pri: nums(set.pri), sec: nums(set.sec), mod: nums(set.mod) };
    if (page.pri.length === 4 && page.sec.length === 2 && page.mod.length === 3 && Number.isFinite(page.n)) sets.push(page);
  }
  if (!sets.length) throw new Error("lolalytics vs: geen rune-data");
  // Eerste set = meest gespeeld, tweede = hoogste winrate (zelfde volgorde als ep=rune).
  const v = sets.slice(0, 2);
  vsMemo.set(url, { t: Date.now(), v });
  return v;
}

async function counters(opts) {
  const d = await call(base("counter", opts));
  return { stats: d?.stats || null, list: Array.isArray(d?.counters) ? d.counters : [] };
}

// Welke patch-waarde heeft genoeg data? Direct na een nieuwe patch is de nieuwe
// bijna leeg; dan nemen we de vorige of "30" (laatste 30 dagen).
// De grens moet ook lage tiers halen: Bronze/Silver hebben ca. 4x minder games dan Gold+.
const MIN_PATCH_GAMES = 15000;
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
      if (n >= MIN_PATCH_GAMES) { best = { patch, n }; break; }
      if (n > best.n) best = { patch, n };
    } catch { /* volgende */ }
  }
  patchMemo.set(key, { t: Date.now(), v: best });
  return best;
}

// Lane-verdeling van een champion (uit de rune-header): om de tegenstander in jouw lane te vinden.
async function defaultLane(opts) {
  try { const d = await call(base("rune", opts)); return d?.header?.defaultLane || null; } catch { return null; }
}

module.exports = { vsRunePages, runePages, itemBuild, counters, resolvePatch, defaultLane };
