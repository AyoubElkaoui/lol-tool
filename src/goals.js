// Werkpunten per game: deaths, kill participation (KP), control wards en CS/min.
// Bronnen: eog-stats-block (net gespeelde game) en de match history van de client
// (lijst = alleen jouw deelnemer; voor KP halen we per game het volledige potje op).

const TARGETS = {
  deaths: { max: 5, label: "Deaths", unit: "", hint: "onder 5" },
  kp: { min: 55, label: "Kill participation", unit: "%", hint: "55%+" },
  cw: { min: 1, label: "Control wards", unit: "", hint: "1+ per game" },
  csm: { min: 6.5, label: "CS/min", unit: "", hint: "6,5+" },
};
const RIFT_QUEUES = new Set([400, 420, 430, 440, 490]);
const MIN_SECONDS = 300; // remakes tellen niet mee

const round1 = (x) => Math.round(x * 10) / 10;
const ok = (key, v) => v == null ? null : TARGETS[key].max != null ? v <= TARGETS[key].max : v >= TARGETS[key].min;

function line({ kills, deaths, assists, teamKills, cs, cw, seconds }) {
  const mins = Math.max(1, seconds / 60);
  return {
    deaths,
    kp: teamKills > 0 ? Math.round(((kills + assists) / teamKills) * 100) : null,
    cw: cw ?? null,
    csm: round1(cs / mins),
    kda: `${kills}/${deaths}/${assists}`,
  };
}

// Net gespeelde game (eog-stats-block).
function fromEog(eog) {
  const s = eog?.localPlayer?.stats || {};
  const mine = (eog.teams || []).find((t) => t.isPlayerTeam);
  const teamKills = (mine?.players || []).reduce((a, p) => a + (p.stats?.CHAMPIONS_KILLED || 0), 0);
  return line({
    kills: s.CHAMPIONS_KILLED || 0, deaths: s.NUM_DEATHS || 0, assists: s.ASSISTS || 0, teamKills,
    cs: (s.MINIONS_KILLED || 0) + (s.NEUTRAL_MINIONS_KILLED || 0),
    cw: s.VISION_WARDS_BOUGHT_IN_GAME, seconds: eog.gameLength || 0,
  });
}

const SMITE = 11, TELEPORT = 12;

// Je directe tegenstander. De lane die de client opgeeft klopt vaak niet; Smite wel.
// Jungle: de vijand met Smite. Anders: de vijand zonder Smite met dezelfde lane (Teleport telt mee in top).
function opponent(game, me) {
  const enemies = (game.participants || []).filter((p) => p.teamId !== me.teamId);
  const smite = (p) => p.spell1Id === SMITE || p.spell2Id === SMITE;
  if (smite(me)) return enemies.find(smite)?.championId || null;
  const lane = me.timeline?.lane;
  let best = null, bestScore = 0;
  for (const p of enemies.filter((e) => !smite(e))) {
    let score = p.timeline?.lane === lane ? 2 : 0;
    if (lane === "TOP" && (p.spell1Id === TELEPORT || p.spell2Id === TELEPORT)) score += 1;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best?.championId || null;
}

// Volledige game uit /lol-match-history/v1/games/{id}; puuid = jij.
function fromGame(game, puuid) {
  const ident = (game.participantIdentities || []).find((x) => x.player?.puuid === puuid);
  const me = (game.participants || []).find((p) => p.participantId === ident?.participantId);
  if (!me) return null;
  const team = game.participants.filter((p) => p.teamId === me.teamId);
  const teamKills = team.reduce((a, p) => a + (p.stats?.kills || 0), 0);
  const teamDmg = team.reduce((a, p) => a + (p.stats?.totalDamageDealtToChampions || 0), 0);
  const st = me.stats || {};
  const mins = Math.max(1, (game.gameDuration || 0) / 60);
  const ours = (game.teams || []).find((t) => t.teamId === me.teamId) || {};
  const theirs = (game.teams || []).find((t) => t.teamId !== me.teamId) || {};
  return {
    ...line({ kills: st.kills || 0, deaths: st.deaths || 0, assists: st.assists || 0, teamKills, cs: (st.totalMinionsKilled || 0) + (st.neutralMinionsKilled || 0), cw: st.visionWardsBoughtInGame, seconds: game.gameDuration || 0 }),
    gameId: game.gameId, championId: me.championId, win: !!st.win,
    dmgShare: teamDmg > 0 ? Math.round(((st.totalDamageDealtToChampions || 0) / teamDmg) * 100) : null,
    vpm: round1((st.visionScore || 0) / mins),
    drakes: ours.dragonKills ?? null, enemyDrakes: theirs.dragonKills ?? null,
    grubs: ours.hordeKills ?? null, heralds: ours.riftHeraldKills ?? null, barons: ours.baronKills ?? null, towers: ours.towerKills ?? null,
    fb: st.firstBloodKill || st.firstBloodAssist ? 100 : 0,
    opp: opponent(game, me),
  };
}

// Welke games uit de lijst meetellen (Summoner's Rift, geen remake), nieuwste eerst.
function riftGames(history, limit = 20) {
  return (history?.games?.games || [])
    .filter((g) => RIFT_QUEUES.has(g.queueId) && (g.gameDuration || 0) >= MIN_SECONDS)
    .sort((a, b) => (b.gameCreation || 0) - (a.gameCreation || 0))
    .slice(0, limit);
}

function average(lines) {
  const avg = (k) => { const v = lines.map((l) => l[k]).filter((x) => x != null); return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const out = { games: lines.length };
  for (const k of Object.keys(TARGETS)) out[k] = avg(k);
  return out;
}

// Tips voor één game, alleen waar je onder je doel zit. Jungle en top krijgen hun eigen CS-/KP-tip.
function tips(l, lane = "jungle") {
  const jungle = lane === "jungle";
  const t = [];
  if (!ok("deaths", l.deaths)) t.push(`${l.deaths} deaths: na 2 deaths niet meer zelf het gevecht beginnen; farm en spring pas in als een teamgenoot engaget.`);
  if (l.kp != null && !ok("kp", l.kp)) t.push(jungle ? `KP ${l.kp}%: wees bij elke drake/herald en elk gevecht bij een objective; een kill in een lege jungle levert minder op.` : `KP ${l.kp}%: na een gewonnen lane of een gepushte wave mee naar drake of herald; met je R kun je gevechten op de hele map joinen.`);
  if (l.cw != null && !ok("cw", l.cw)) t.push(jungle ? "Geen control ward gekocht: elke back één, in de river-bush bij drake of herald." : "Geen control ward gekocht: elke back één, in de tri-bush of river-bush van je lane tegen ganks.");
  if (!ok("csm", l.csm)) t.push(jungle ? `CS ${l.csm}/min: tussen ganks door camps blijven clearen; laat geen camps staan als er niets te halen valt.` : `CS ${l.csm}/min: laat geen wave onder je toren vallen; na een back eerst de wave pakken, dan pas vechten.`);
  return t;
}

// ---------- Analyse: wat gaat goed, wat kan beter, waarin verschillen je wins van je losses ----------
// Extra maatstaven naast de vier doelen. Alleen voor de goed/beter-lijst; de doelen zelf blijven gelijk.
const EXTRA = {
  dmgShare: { min: 20, label: "Schade-aandeel", unit: "%", hint: "20%+" },
  vpm: { min: 0.8, label: "Vision/min", unit: "", hint: "0,8+" },
};
// Maatstaven voor "wins tegen losses": lower = minder is beter. Geen torens of first blood:
// torens zijn eerder gevolg dan oorzaak van winnen, first blood is te zeldzaam voor een gemiddelde.
const COMPARE = {
  deaths: { label: "Deaths", lower: true },
  kp: { label: "Kill participation", unit: "%" },
  csm: { label: "CS/min" },
  dmgShare: { label: "Schade-aandeel", unit: "%" },
  vpm: { label: "Vision/min" },
  drakes: { label: "Drakes (team)" },
};
const MIN_MAIN_GAMES = 5;   // zoveel games op je main → analyse alleen over je main
const MIN_SPLIT = 2;        // minstens zoveel wins én losses voor de vergelijking
const MIN_OPP_GAMES = 2;

const mean = (lines, k) => { const v = lines.map((l) => l[k]).filter((x) => x != null); return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
const fmt = (v, unit = "") => `${String(v).replace(".", ",")}${unit}`;

function analysis(lines, { lane = "jungle", mainId = null, names = {} } = {}) {
  const onMain = lines.filter((l) => l.championId === mainId);
  const scope = mainId && onMain.length >= MIN_MAIN_GAMES ? onMain : lines;
  if (!scope.length) return null;
  const wins = scope.filter((l) => l.win), losses = scope.filter((l) => !l.win);
  const T = { ...TARGETS, ...EXTRA };
  const good = [], bad = [];
  for (const [k, t] of Object.entries(T)) {
    const v = mean(scope, k);
    if (v == null) continue;
    const pass = t.max != null ? v <= t.max : v >= t.min;
    (pass ? good : bad).push({ key: k, text: `${t.label}: ${fmt(v, t.unit)} (doel ${t.hint})` });
  }
  const tipFor = tips({ deaths: 99, kp: 0, cw: 0, csm: 0 }, lane);
  const tipByKey = { deaths: tipFor[0], kp: tipFor[1], cw: tipFor[2], csm: tipFor[3],
    dmgShare: "Weinig schade: blijf in gevechten tot het eind in plaats van na één kill weg te gaan, en pak je powerspike-items eerst.",
    vpm: "Weinig vision: trinket ward elke keer als hij klaar is, en ruim wards op met een sweeper op je route." };
  for (const b of bad) b.tip = tipByKey[b.key]?.replace(/^[^:]+: /, "") || null;

  // Waarin verschillen je wins het meest van je losses? Relatief verschil, alleen als wins beter zijn.
  let deciders = [];
  if (wins.length >= MIN_SPLIT && losses.length >= MIN_SPLIT) {
    deciders = Object.entries(COMPARE).map(([k, c]) => {
      const w = mean(wins, k), l = mean(losses, k);
      if (w == null || l == null) return null;
      const better = c.lower ? w < l : w > l;
      const gap = Math.abs(w - l) / Math.max(Math.abs(w), Math.abs(l), 0.1);
      return better ? { key: k, label: c.label, unit: c.unit || "", wins: w, losses: l, gap } : null;
    }).filter(Boolean).sort((a, b) => b.gap - a.gap).slice(0, 3);
  }

  // Tegenstanders met minstens 2 games: waar win/verlies je het vaakst.
  const byOpp = new Map();
  for (const l of scope) if (l.opp) { const o = byOpp.get(l.opp) || { id: l.opp, name: names[l.opp] || "?", games: 0, wins: 0 }; o.games++; if (l.win) o.wins++; byOpp.set(l.opp, o); }
  const opps = [...byOpp.values()].filter((o) => o.games >= MIN_OPP_GAMES);
  const rate = (o) => o.wins / o.games;
  const hard = opps.filter((o) => rate(o) < 0.5).sort((a, b) => rate(a) - rate(b) || b.games - a.games).slice(0, 3);
  const easy = opps.filter((o) => rate(o) > 0.5).sort((a, b) => rate(b) - rate(a) || b.games - a.games).slice(0, 3);

  const last5 = scope.slice(0, 5);
  return {
    champ: scope === onMain ? names[mainId] || null : null, games: scope.length, wins: wins.length, losses: losses.length,
    good, bad, deciders, hard, easy,
    form: { games: last5.length, wins: last5.filter((l) => l.win).length },
  };
}

module.exports = { TARGETS, ok, fromEog, fromGame, riftGames, average, tips, analysis };
