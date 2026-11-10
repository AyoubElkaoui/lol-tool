// Test zonder League-client: haalt voor een champ de runes/items/matchup op.
// Gebruik: node scripts/test-data.mjs irelia top jax
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dd = require("../src/ddragon.js");
const lol = require("../src/lolalytics.js");
const guide = require("../src/guide.js");
const ugg = require("../src/ugg.js");

const [slug = "irelia", lane = "top", vs] = process.argv.slice(2);
const BOOTS = new Set([1001, 3005, 3006, 3009, 3010, 3020, 3047, 3111, 3117, 3158]);
const patch = await dd.lolalyticsPatch();
console.log("patch", patch, "ddragon", await dd.version());
const opts = { patch, slug, lane, tier: "gold_plus", vs };
const runes = await lol.runePages(opts);
for (const p of runes.pages) console.log("runes", p.label, p.wr + "%", p.n, "pri", p.pri, "sec", p.sec, "mod", p.mod, "style", await dd.perkStyle(p.pri[0]), await dd.perkStyle(p.sec[0]));
const isBoot = (id) => BOOTS.has(Number(id));
const items = await lol.itemBuild(opts, isBoot);
const names = Object.fromEntries(Object.values(await dd.items()).map((i) => [i.id, i.name]));
const champList = await dd.champions();
const meChamp = Object.values(champList).find((ch) => ch.lolaSlug === slug);
let u = null;
try { u = await ugg.overview({ patch, championId: meChamp.id, lane, tier: "gold_plus" }); } catch (e) { console.log("u.gg niet beschikbaar:", e.message); }
// Zelfde aanvulling als main.js (fillBuild).
const fill = (list) => { const out = [...list]; for (const k of [4, 5, 6]) { if (out.filter((id) => !isBoot(id)).length >= 5) break; const b = [...(u?.itemOptions?.[k] || [])].sort((a, c) => c.games - a.games).find((o) => !out.includes(o.id) && !isBoot(o.id)); if (b) out.push(b.id); } return out; };
items.starters = u?.starters || [];
items.core = fill(items.core);
items.builds = items.builds.map((b) => ({ ...b, items: fill(b.items) }));
console.log("start", items.starters.map((i) => names[i]));
console.log("core ", items.core.map((i) => names[i]).join(" -> "));
if (vs) {
  try {
    const v = await lol.vsItems({ ...opts, vs });
    const fmt = (b) => b.core.map((x) => `${names[x.id]} (${x.n})`).join(" -> ") + " | 4e: " + b.options[4].map((x) => `${names[x.id]} ${x.wr}% (${x.n})`).join(", ");
    console.log("vs   ", vs, "meest gespeeld:", fmt(v.pick));
    console.log("vs   ", vs, "hoogste wr:    ", fmt(v.win));
  } catch (e) { console.log("vs items niet beschikbaar:", e.message); }
}
for (const b of items.builds.slice(0, 4)) console.log("build", b.picks, b.wr + "%", b.items.map((i) => names[i]).join(" -> "));
console.log("situ ", items.situational.map((i) => names[i]));
const c = await lol.counters(opts);
const champs = await dd.champions();
const row = vs ? c.list.find((r) => champs[r.cid]?.lolaSlug === vs) : null;
console.log("counters top5 zwak:", c.list.filter((r) => r.n > 100).sort((a, b) => a.vsWr - b.vsWr).slice(0, 5).map((r) => `${champs[r.cid]?.name} ${r.vsWr}% (${r.defaultLane})`));
const me = Object.values(champs).find((ch) => ch.lolaSlug === slug);
const enemy = row ? champs[row.cid] : null;
console.log(JSON.stringify(guide.build({ me, enemy, counterRow: row, runePage: runes.pages[0], itemBuild: items, itemNames: names, itemData: await dd.items() }), null, 1));
