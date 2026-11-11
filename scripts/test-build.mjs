// Test de build-keuze zonder League-client.
// Gebruik: node scripts/test-build.mjs galio middle yone "yone,zed,jinx,lux,leesin" "ahri,jinx,lulu,leesin"
//          (champ, lane, lane-tegenstander, hun team, jouw teamgenoten; alles lolalytics-slugs)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dd = require("../src/ddragon.js");
const lol = require("../src/lolalytics.js");
const an = require("../src/analysis.js");

const [slug = "galio", lane = "middle", vs = "", enemiesArg = "", alliesArg = "", tier = "gold_plus"] = process.argv.slice(2);
const BOOTS = new Set([1001, 3005, 3006, 3009, 3010, 3020, 3047, 3111, 3117, 3158]);
const isBoot = (id) => BOOTS.has(Number(id));
const champs = Object.values(await dd.champions());
const bySlug = (s) => champs.find((c) => c.lolaSlug === s);
const itemData = await dd.items();
const n = (id) => itemData[id]?.name || id;
const patch = (await lol.resolvePatch(await dd.lolalyticsPatch(), slug, lane, tier)).patch;
const opts = { patch, slug, lane, tier };

const me = bySlug(slug), laner = vs ? bySlug(vs) : null;
const enemies = enemiesArg.split(",").filter(Boolean).map(bySlug).filter(Boolean);
const allies = alliesArg.split(",").filter(Boolean).map(bySlug).filter(Boolean);
const team = an.analyseTeam(enemies);

let items = await lol.itemBuild(opts, isBoot);
const styles = an.styles({ builds: items.allBuilds, itemData });
console.log(`patch ${patch} · ${tier}`);
console.log("standaard  :", items.core.map(n).join(" → "), `(${items.builds[0].picks} games)`);
for (const st of Object.values(styles)) console.log(`${st.label.padEnd(11)}:`, st.items.map(n).join(" → "), `(${st.picks} games, ${st.wr}%, stijl in ${st.share}% van de builds)`);

const style = an.pickStyle({ styles, team, allies });
let label = "standaard";
if (style) {
  items = { ...items, core: [style.items[0], items.boot, ...style.items.slice(1)] };
  label = `${style.label}: ${style.why}`;
} else if (laner) {
  const v = (await lol.vsItems({ ...opts, vs })).pick;
  console.log(`vs ${laner.name.padEnd(8)}:`, v.core.map((x) => n(x.id)).join(" → "), `(${v.core[0]?.n} games)`);
  if (v.core[0]?.n >= 150) { items = { ...items, core: v.core.map((x) => x.id) }; label = `tegen ${laner.name}`; }
}
const tb = an.teamBuild({ me, core: items.core, situational: items.situational, itemData, team, laner, defaultBoot: items.boot, isBoot, style: style?.key });
console.log(`\nteam: ${team.ad.length} AD, ${team.ap.length} AP, ${team.tanks.length} tank · teamgenoten: ${allies.map((c) => c.name).join(", ") || "-"}`);
console.log("basis      :", label, "→", items.core.map(n).join(" → "));
console.log("vs dit team:", tb.build.map(n).join(" → "));
console.log("boots      :", n(tb.boots.id), "·", tb.boots.why);
for (const [id, w] of Object.entries(tb.why)) console.log("counter    :", n(id), "tegen", w);
