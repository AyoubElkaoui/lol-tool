// Team-analyse, boots-keuze, "vs dit team"-build en ban-advies.
// Alles op basis van Data Dragon-tags + lolalytics counters; geen magie,
// gewoon de regels die een goede speler ook toepast.

const HEALERS = new Set(["aatrox", "drmundo", "fiddlesticks", "illaoi", "irelia", "jax", "kayn", "maokai", "mordekaiser", "nasus", "olaf", "renekton", "sett", "soraka", "swain", "sylas", "tryndamere", "vladimir", "volibear", "warwick", "yone", "yuumi", "zac", "briar", "ambessa", "garen", "darius", "nami", "sona", "senna", "kindred", "rengar", "aurelionsol", "vayne", "jinx"]);
const CC_HEAVY = new Set(["leona", "nautilus", "morgana", "lissandra", "sejuani", "amumu", "malphite", "ashe", "rell", "thresh", "blitzcrank", "alistar", "maokai", "zac", "ornn", "galio", "skarner", "veigar", "lux"]);
const AP_OVERRIDE = new Set(["kayle", "diana", "akali", "katarina", "ekko", "fizz", "gragas", "sylas", "mordekaiser", "singed", "rumble", "elise", "evelynn", "nidalee", "amumu", "fiddlesticks", "kennen", "teemo", "gwen", "lillia", "vladimir", "swain", "aurora", "mel", "hwei", "smolder"]);

function dmgType(ch) {
  if (!ch) return "AD";
  const s = ch.lolaSlug;
  if (AP_OVERRIDE.has(s)) return "AP";
  if (ch.tags?.includes("Mage")) return "AP";
  if (ch.tags?.includes("Support") && ch.partype === "Mana" && !ch.tags.includes("Marksman") && !ch.tags.includes("Fighter")) return "AP";
  return "AD";
}

function analyseTeam(enemies) {
  const list = enemies.filter(Boolean);
  const ad = list.filter((c) => dmgType(c) === "AD");
  const ap = list.filter((c) => dmgType(c) === "AP");
  const tanks = list.filter((c) => c.tags?.includes("Tank"));
  const healers = list.filter((c) => HEALERS.has(c.lolaSlug));
  const cc = list.filter((c) => CC_HEAVY.has(c.lolaSlug) || c.tags?.includes("Tank"));
  const assassins = list.filter((c) => c.tags?.includes("Assassin"));
  const notes = [];
  if (list.length >= 3) {
    if (ad.length >= 3) notes.push(`${ad.length} AD-champions → armor (2e/3e item) loont, Steelcaps als boots.`);
    if (ap.length >= 3) notes.push(`${ap.length} AP-champions → magic resist, Mercury's of Verdant/Maw.`);
    if (ad.length >= 2 && ap.length >= 2) notes.push("Gemengde damage → eerst damage, daarna één defensief item per type.");
    if (tanks.length >= 2) notes.push(`${tanks.length} tanks → %-hp damage (BotRK/Kraken) of penetratie.`);
    if (healers.length >= 2) notes.push("Veel healing → anti-heal vroeg (Executioner's/Bramble/Oblivion Orb).");
    if (cc.length >= 3) notes.push("Veel CC → Mercury's Treads of Tenacity-shard overwegen.");
    if (assassins.length >= 2) notes.push("Assassins → sta niet alleen, ward diep, Zhonya's/GA eerder.");
  }
  return { ad: ad.map((c) => c.name), ap: ap.map((c) => c.name), tanks: tanks.map((c) => c.name), healers: healers.map((c) => c.name), cc: cc.map((c) => c.name), notes, count: list.length };
}

// Boots op basis van team en jouw klasse.
const BOOTS = { steelcaps: 3047, mercs: 3111, ionian: 3158, berserker: 3006, sorc: 3020, swifties: 3009, symbiotic: 3010 };
function chooseBoots({ me, team, laner, defaultBoot }) {
  const myAP = dmgType(me) === "AP";
  const marksman = me.tags?.includes("Marksman");
  const l = laner ? dmgType(laner) : null;
  if (team.count >= 3) {
    if (team.ad.length >= 3 && !marksman) return { id: BOOTS.steelcaps, why: `${team.ad.length} AD in hun team` };
    if (team.ap.length >= 3 || (team.cc.length >= 3 && !marksman)) return { id: BOOTS.mercs, why: team.ap.length >= 3 ? `${team.ap.length} AP in hun team` : "veel CC" };
  }
  if (l === "AD" && !marksman && !myAP) return { id: BOOTS.steelcaps, why: `${laner.name} doet AD-damage` };
  if (l === "AP" && !marksman && !myAP) return { id: BOOTS.mercs, why: `${laner.name} doet AP-damage` };
  if (defaultBoot) return { id: defaultBoot, why: "meest gespeeld" };
  return { id: myAP ? BOOTS.sorc : marksman ? BOOTS.berserker : BOOTS.ionian, why: "standaard voor je klasse" };
}

// "vs dit team"-build: zelfde core, maar boots en 3e-6e item herschikt op wat tegen dit team werkt.
function teamBuild({ me, core, situational, options, itemData, team, laner, defaultBoot, isBoot }) {
  const boots = chooseBoots({ me, team, laner, defaultBoot });
  const want = new Set();
  if (team.ad.length >= 3 || (laner && dmgType(laner) === "AD" && team.ad.length >= 2)) want.add("Armor");
  if (team.ap.length >= 3 || (laner && dmgType(laner) === "AP" && team.ap.length >= 2)) want.add("SpellBlock");
  if (team.tanks.length >= 2) { want.add("ArmorPenetration"); want.add("MagicPenetration"); }
  const heal = team.healers.length >= 2 || (laner && HEALERS.has(laner.lolaSlug));
  const score = (id) => {
    const it = itemData[id]; if (!it) return 0;
    let s = 0;
    for (const t of it.tags) if (want.has(t)) s += 2;
    if (heal && /Thornmail|Bramble|Executioner|Mortal Reminder|Chempunk|Morellonomicon|Oblivion/i.test(it.name)) s += 3;
    return s;
  };
  const extra = heal ? (dmgType(me) === "AP" ? [3916] : [3123]) : []; // Oblivion Orb / Executioner's Calling als anti-heal-startpunt
  const pool = [...new Set([...situational, ...(options?.[4] || []).map((o) => o.id), ...(options?.[5] || []).map((o) => o.id), ...(options?.[6] || []).map((o) => o.id), ...extra])].filter((id) => !isBoot(id) && itemData[id]);
  const ranked = pool.map((id) => ({ id, s: score(id) })).sort((a, b) => b.s - a.s);
  const defensive = ranked.filter((r) => r.s > 0).map((r) => r.id).slice(0, 3);
  const coreNoBoots = core.filter((id) => !isBoot(id));
  // core: 1e item, boots, 2e item, dan 1 defensief item als dat nodig is, dan rest.
  const build = [coreNoBoots[0], boots.id, coreNoBoots[1]].filter(Boolean);
  if (defensive[0] && (want.size || heal)) build.push(defensive[0]);
  for (const id of coreNoBoots.slice(2)) if (!build.includes(id) && build.length < 6) build.push(id);
  for (const id of defensive) if (!build.includes(id) && build.length < 6) build.push(id);
  return { build, boots, defensive, changed: JSON.stringify(build) !== JSON.stringify(core) };
}

// Ban-advies: champs in mijn lane waar mijn pool het slechtst tegen doet.
function banAdvice({ poolCounters, lane, taken, champs, enemyHovers }) {
  const agg = new Map();
  for (const { slug, list } of poolCounters) {
    for (const r of list) {
      if (r.defaultLane !== lane || r.n < 150 || taken.has(r.cid)) continue;
      const a = agg.get(r.cid) || { cid: r.cid, score: 0, parts: [] };
      a.score += 50 - r.vsWr; // hoe lager mijn winrate, hoe hoger de score
      a.parts.push(`${slug}: ${r.vsWr}%`);
      agg.set(r.cid, a);
    }
  }
  const list = [...agg.values()].filter((a) => a.parts.length === poolCounters.length || a.score > 6).sort((a, b) => b.score - a.score).slice(0, 5)
    .map((a) => ({ ...a, champ: champs[a.cid] }));
  const hovers = enemyHovers.map((id) => champs[id]).filter(Boolean);
  return { list, hovers };
}

module.exports = { analyseTeam, chooseBoots, teamBuild, banAdvice, dmgType, BOOTS };
