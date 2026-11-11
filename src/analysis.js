// Team-analyse, boots-keuze, "vs dit team"-build en ban-advies.
// Alles op basis van Data Dragon-tags + lolalytics counters; geen magie,
// gewoon de regels die een goede speler ook toepast.

const HEALERS = new Set(["aatrox", "drmundo", "fiddlesticks", "illaoi", "irelia", "jax", "kayn", "maokai", "mordekaiser", "nasus", "olaf", "renekton", "sett", "soraka", "swain", "sylas", "tryndamere", "vladimir", "volibear", "warwick", "yone", "yuumi", "zac", "briar", "ambessa", "garen", "darius", "nami", "sona", "senna", "kindred", "rengar", "vayne"]);
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
  return { ad: ad.map((c) => c.name), ap: ap.map((c) => c.name), tanks: tanks.map((c) => c.name), healers: healers.map((c) => c.name), cc: cc.map((c) => c.name), assassins: assassins.map((c) => c.name), notes, count: list.length };
}

// Boots op basis van team en jouw klasse.
const BOOTS = { steelcaps: 3047, mercs: 3111, ionian: 3158, berserker: 3006, sorc: 3020, swifties: 3009, symbiotic: 3010 };
function chooseBoots({ me, team, laner, defaultBoot, cls }) {
  const myAP = cls ? cls === "mage" : dmgType(me) === "AP";
  const marksman = cls ? cls === "marksman" : me.tags?.includes("Marksman");
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

// Jouw klasse bepaalt welke items een dreiging oplossen (een mage koopt geen Randuin's).
// De build zelf gaat voor de tags: AP-Shaco bouwt Liandry's, dus dan mage-items.
function myClass(me, core = [], itemData = {}) {
  const t = me?.tags || [];
  const items = core.map((id) => itemData[id]).filter((i) => i && !i.tags.includes("Boots"));
  const ap = items.filter((i) => i.tags.includes("SpellDamage")).length;
  const ad = items.filter((i) => i.tags.includes("Damage") || i.tags.includes("CriticalStrike")).length;
  const tank = items.filter((i) => !i.tags.includes("SpellDamage") && !i.tags.includes("Damage") && (i.tags.includes("Armor") || i.tags.includes("SpellBlock") || i.tags.includes("Health"))).length;
  if (items.length >= 3) {
    if (tank > items.length / 2) return "tank";
    if (ap > ad) return "mage";
  }
  if (t[0] === "Tank") return "tank";
  if (t[0] === "Marksman") return "marksman";
  if (!items.length && dmgType(me) === "AP") return "mage";
  if (ap > ad) return "mage";
  if (t[0] === "Assassin") return "assassin";
  return "fighter";
}

// Welke items een dreiging oplossen komt uit de data: de items die jouw champ zelf bouwt
// (lolalytics, per patch) met de juiste eigenschap volgens Riot's item-data. Geen vaste item-lijstjes.
const THREAT_MATCH = {
  armor: (it) => it.tags.includes("Armor"),
  mr: (it) => it.tags.includes("SpellBlock"),
  antiheal: (it) => !!it.gw,
  tanks: (it) => !!it.pctPen,
  burst: (it) => it.tags.includes("Armor") && it.tags.includes("Active"), // Zhonya's e.d.
  cc: (it) => it.tags.includes("Tenacity"),
};

// Speelstijlen uit de data: de meest gebouwde "full damage"- en "tank"-build van deze champ.
// Een item telt als tank-item als het volgens Riot geen damage-stats heeft maar wel health/armor/MR.
const DMG_TAGS = ["SpellDamage", "Damage", "CriticalStrike", "AttackSpeed"];
const DEF_TAGS = ["Health", "Armor", "SpellBlock"];
const isTankItem = (it) => !!it && !it.tags.some((t) => DMG_TAGS.includes(t)) && it.tags.some((t) => DEF_TAGS.includes(t));
// damage = hooguit één item met wat defensie erbij (Zhonya's), tank = minstens twee pure tank-items.
function styleOf(ids, itemData) {
  const first = ids.slice(0, 3).map((id) => itemData[id]);
  const tank = first.filter(isTankItem).length;
  const hybrid = first.filter((it) => it && !isTankItem(it) && it.tags.some((t) => DEF_TAGS.includes(t))).length;
  return tank >= 2 ? "tank" : tank === 0 && hybrid <= 1 ? "damage" : "mixed";
}
const STYLE_LABEL = { damage: "Full damage", tank: "Tank" };
function styles({ builds, itemData }) {
  const list = (builds || []).filter((b) => b.items.length >= 3 && b.items.every((id) => itemData[id]));
  const total = list.reduce((s, b) => s + b.picks, 0) || 1;
  const std = list[0] ? styleOf(list[0].items, itemData) : null;
  const out = {};
  for (const key of ["damage", "tank"]) {
    if (key === std) continue; // de standaard-build ís al deze stijl
    const group = list.filter((b) => styleOf(b.items, itemData) === key);
    const picks = group.reduce((s, b) => s + b.picks, 0);
    const top = group[0]; // builds staan op aantal games
    if (!top || top.picks < 50 || picks / total < 0.02) continue;
    out[key] = { ...top, key, label: STYLE_LABEL[key], share: Math.round((picks / total) * 100) };
  }
  return out;
}

// Wanneer een andere stijl dan de standaard beter past: jullie hebben geen frontline → tank,
// hun team heeft geen tank → full damage. Alleen als de champ die stijl echt speelt (zie styles).
function pickStyle({ styles: st, team, allies }) {
  const mates = (allies || []).filter(Boolean);
  if (st?.tank && mates.length >= 4 && !mates.some((c) => c.tags?.includes("Tank"))) return { ...st.tank, why: "jullie team heeft geen frontline" };
  if (st?.damage && team.count >= 4 && team.tanks.length === 0) return { ...st.damage, why: "hun team is squishy (geen tank)" };
  return null;
}

// Wat dit team gevaarlijk maakt, met een gewicht (hoe hoger, hoe eerder het item).
function threats(team, laner) {
  const l = laner ? dmgType(laner) : null;
  const out = [];
  const add = (key, w, min, why) => { if (w >= min) out.push({ key, w, why }); };
  add("antiheal", team.healers.length * 1.5 + (laner && HEALERS.has(laner.lolaSlug) ? 1 : 0), 2, `veel healing (${team.healers.join(", ") || laner?.name})`);
  add("armor", team.ad.length + (l === "AD" ? 1 : 0), 3, `${team.ad.length} AD-champions${l === "AD" ? `, ${laner.name} in jouw lane` : ""}`);
  add("mr", team.ap.length + (l === "AP" ? 1 : 0), 3, `${team.ap.length} AP-champions${l === "AP" ? `, ${laner.name} in jouw lane` : ""}`);
  add("tanks", team.tanks.length * 1.2, 2.4, `${team.tanks.length} tanks (${team.tanks.join(", ")})`);
  add("burst", (team.assassins?.length || 0) * 1.2, 2.4, `burst/assassins (${(team.assassins || []).join(", ")})`);
  add("cc", team.cc.length - 1, 2, `veel CC (${team.cc.join(", ")})`);
  return out.sort((a, b) => b.w - a.w);
}

// "vs dit team"-build: 1e en 2e core-item blijven, boots en de items daarna worden
// gekozen op wat dit team gevaarlijk maakt (max. 2 counter-items, per dreiging het beste).
function teamBuild({ me, core, situational, options, itemData, team, laner, defaultBoot, isBoot, style }) {
  const cls = myClass(me, core, itemData);
  const boots = chooseBoots({ me, team, laner, defaultBoot, cls });
  // Hoe vaker jouw champ een item koopt, hoe lager de rank: core, dan situationeel, dan u.gg-opties.
  const order = [...core, ...situational, ...[4, 5, 6].flatMap((k) => [...(options?.[k] || [])].sort((a, b) => b.games - a.games).map((o) => o.id))];
  const coreNoBoots = core.filter((id) => !isBoot(id));
  const picked = [];
  for (const t of threats(team, laner)) {
    // Kandidaten: wat jouw champ echt bouwt (order), met de eigenschap die deze dreiging oplost.
    // In een full damage-build komen geen pure tank-items.
    const ids = [...new Set(order)].filter((id) => itemData[id] && !isBoot(id) && THREAT_MATCH[t.key](itemData[id]) && !(style === "damage" && isTankItem(itemData[id])));
    const already = ids.find((id) => coreNoBoots.slice(0, 3).includes(id) || picked.some((p) => p.id === id));
    if (already) {
      const p = picked.find((x) => x.id === already);
      if (p) p.why += ` en ${t.why}`; else picked.push({ id: already, why: t.why, key: t.key, inCore: true });
      continue;
    }
    const id = ids[0];
    if (id) picked.push({ id, why: t.why, key: t.key });
  }
  const counters = picked.filter((p) => !p.inCore).slice(0, 2);
  const build = [coreNoBoots[0], boots.id, coreNoBoots[1]].filter(Boolean);
  for (const p of counters) if (!build.includes(p.id)) build.push(p.id);
  for (const id of coreNoBoots.slice(2)) if (!build.includes(id) && build.length < 6) build.push(id);
  // Defensief/alternatief: overige counter-items + wat de data als situationeel geeft.
  const defensive = [...new Set([...picked.slice(2).map((p) => p.id), ...situational.filter((id) => !build.includes(id))])].filter((id) => !build.includes(id) && itemData[id]).slice(0, 3);
  const why = Object.fromEntries(picked.map((p) => [p.id, p.why]));
  return { build: build.slice(0, 6), boots, defensive, why, threats: picked.map((p) => p.why), changed: JSON.stringify(build.slice(0, 6)) !== JSON.stringify(core) };
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

module.exports = { styles, styleOf, pickStyle, myClass, threats, analyseTeam, chooseBoots, teamBuild, banAdvice, dmgType, BOOTS };
