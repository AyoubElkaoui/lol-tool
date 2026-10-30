// Test zonder champ select: counter picks / blind pick met echte data.
// Gebruik: node scripts/test-picks.mjs top silver irelia,teemo,jax jax,leesin,zed,jinx,leona
//          (zonder vijf-lijst = blind pick)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dd = require("../src/ddragon.js");
const lol = require("../src/lolalytics.js");
const picks = require("../src/picks.js");

const [lane = "top", tier = "gold_plus", poolArg = "irelia,teemo,jax", enemyArg = ""] = process.argv.slice(2);
const champs = await dd.champions();
const bySlug = Object.fromEntries(Object.values(champs).map((c) => [c.lolaSlug, c]));
const ddPatch = await dd.lolalyticsPatch();
const { patch, n } = await lol.resolvePatch(ddPatch, "irelia", "top", tier);
console.log(`ddragon ${ddPatch} -> data-patch ${patch} (${n} games, ${tier})`);
const pool = poolArg.split(",").map((s) => bySlug[s]);
const enemyIds = enemyArg ? enemyArg.split(",").map((s) => bySlug[s].id) : [];
const enemy = await picks.laneOpponent({ enemyIds, lane, champs, patch, tier });
console.log("tegenstander in lane:", enemy?.name || "-");
const a = await picks.advice({ enemy, lane, pool, taken: new Set(), champs, patch, tier });
const line = (r) => `  ${r.champ.name.padEnd(14)} ${String(r.wr ?? "?").padStart(5)}%  ${r.n ?? 0} games${r.worst ? "  zwak: " + r.worst.map((w) => `${w.name} ${w.wr}%`).join(", ") : ""}`;
console.log(a.mode, "pool:"); a.pool.forEach((r) => console.log(line(r)));
if (a.best.length) { console.log("beste in lane:"); a.best.forEach((r) => console.log(line(r))); }
