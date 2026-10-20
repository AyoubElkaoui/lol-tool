// Matchup-guide: korte, concrete tekst per (jouw champ, tegenstander).
// 1) Handgeschreven notities uit guides.json voor de eigen pool.
// 2) Data: winrate in de matchup (lolalytics counters) en de situationele
//    items uit de build, gesorteerd op wat tegen DIT type tegenstander past
//    (armor vs AD/fighters, MR vs mages, anti-heal vs healers, enz.).

const fs = require("fs");
const path = require("path");

let guides = null;
function load() {
  if (guides) return guides;
  try { guides = JSON.parse(fs.readFileSync(path.join(__dirname, "guides.json"), "utf8")); }
  catch { guides = {}; }
  return guides;
}

function level(wr) {
  if (wr == null) return null;
  if (wr >= 53) return { tag: "GOED", text: "Je staat statistisch voor in deze matchup." };
  if (wr >= 50) return { tag: "OK", text: "Gelijkwaardig, je eigen spel beslist." };
  if (wr >= 47) return { tag: "LASTIG", text: "Licht nadeel, speel veilig tot je eerste item." };
  return { tag: "MOEILIJK", text: "Duidelijke counter: niet sterven, boeren en wachten op jungle." };
}

// Champions met veel healing/shields → anti-heal is bijna altijd goed.
const HEALERS = new Set(["aatrox", "drmundo", "fiddlesticks", "illaoi", "irelia", "jax", "kayn", "maokai", "mordekaiser", "nasus", "olaf", "renekton", "sett", "soraka", "swain", "sylas", "tryndamere", "vladimir", "volibear", "warwick", "yone", "yuumi", "zac", "briar", "ambessa", "garen", "darius"]);
const AD_HEAVY = new Set(["Fighter", "Marksman", "Assassin"]);

// Welke item-tags passen tegen welk type tegenstander.
function wantedTags(enemy) {
  const tags = new Set();
  if (!enemy) return tags;
  const isAP = enemy.partype === "Mana" && enemy.tags.includes("Mage");
  const isAD = enemy.tags.some((t) => AD_HEAVY.has(t)) && !enemy.tags.includes("Mage");
  if (isAD) tags.add("Armor");
  if (isAP || enemy.tags.includes("Mage")) tags.add("SpellBlock");
  if (enemy.tags.includes("Tank")) { tags.add("ArmorPenetration"); tags.add("MagicPenetration"); }
  if (HEALERS.has(enemy.lolaSlug)) tags.add("GrievousWounds");
  return tags;
}

function rankSituational(ids, itemData, enemy) {
  const want = wantedTags(enemy);
  const score = (id) => {
    const it = itemData?.[id];
    if (!it) return 0;
    let s = 0;
    for (const t of it.tags) if (want.has(t)) s += 2;
    if (want.has("GrievousWounds") && /Thornmail|Bramble|Executioner|Mortal Reminder|Chempunk|Morellonomicon|Oblivion/i.test(it.name)) s += 3;
    return s;
  };
  return [...ids].sort((a, b) => score(b) - score(a));
}

function build({ me, enemy, counterRow, runePage, itemBuild, itemNames, itemData }) {
  const g = load();
  const own = g[me.lolaSlug] || g[me.slug?.toLowerCase()] || {};
  const specific = enemy ? own.vs?.[enemy.lolaSlug] : null;
  const lvl = counterRow ? level(counterRow.vsWr) : null;

  const lines = [];
  if (enemy) lines.push(`${me.name} vs ${enemy.name}${counterRow ? ` — ${counterRow.vsWr}% winrate (${counterRow.n} games)` : ""}`);
  else lines.push(`${me.name} — tegenstander nog niet bekend`);
  if (lvl) lines.push(`${lvl.tag}: ${lvl.text}`);

  const sections = [];
  if (own.algemeen?.length) sections.push({ title: "Zo speel je " + me.name, items: own.algemeen });
  if (specific) sections.push({ title: "Tegen " + enemy.name, items: specific });
  else if (enemy && own.fallback?.length) sections.push({ title: "Tegen " + enemy.name + " (algemeen)", items: own.fallback });

  let situationalIds = itemBuild?.situational || [];
  if (itemBuild) {
    const n = (id) => itemNames[id] || id;
    situationalIds = rankSituational(situationalIds, itemData, enemy);
    const data = [];
    if (itemBuild.core.length) data.push(`Build: ${itemBuild.core.map(n).join(" → ")}`);
    if (situationalIds.length) data.push(`${enemy ? "Tegen " + enemy.name + " eerst overwegen" : "Situationeel"}: ${situationalIds.slice(0, 3).map(n).join(", ")}`);
    if (enemy) {
      const w = wantedTags(enemy);
      const why = [];
      if (w.has("Armor")) why.push("hij doet vooral AD-damage → armor");
      if (w.has("SpellBlock")) why.push("hij doet magic damage → magic resist");
      if (w.has("GrievousWounds")) why.push("hij heelt veel → anti-heal vroeg");
      if (w.has("ArmorPenetration")) why.push("tank → penetratie/%-hp damage");
      if (why.length) data.push("Waarom: " + why.join("; "));
    }
    if (runePage) data.push(`Runes: ${runePage.label} (${runePage.wr}% over ${runePage.n.toLocaleString("nl-NL")} games)`);
    sections.push({ title: "Uit de data", items: data });
  }
  return { headline: lines, sections, level: lvl?.tag || null, situationalIds, counterRow: counterRow ? { vsWr: counterRow.vsWr, n: counterRow.n } : null };
}

module.exports = { build, load };
