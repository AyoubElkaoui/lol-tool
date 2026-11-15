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

// Volledige game uit /lol-match-history/v1/games/{id}; puuid = jij.
function fromGame(game, puuid) {
  const ident = (game.participantIdentities || []).find((x) => x.player?.puuid === puuid);
  const me = (game.participants || []).find((p) => p.participantId === ident?.participantId);
  if (!me) return null;
  const teamKills = game.participants.filter((p) => p.teamId === me.teamId).reduce((a, p) => a + (p.stats?.kills || 0), 0);
  const st = me.stats || {};
  return {
    ...line({ kills: st.kills || 0, deaths: st.deaths || 0, assists: st.assists || 0, teamKills, cs: (st.totalMinionsKilled || 0) + (st.neutralMinionsKilled || 0), cw: st.visionWardsBoughtInGame, seconds: game.gameDuration || 0 }),
    gameId: game.gameId, championId: me.championId, win: !!st.win,
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

// Tips voor één game, alleen waar je onder je doel zit.
function tips(l) {
  const t = [];
  if (!ok("deaths", l.deaths)) t.push(`${l.deaths} deaths: na 2 deaths niet meer zelf het gevecht beginnen; farm en spring pas in als een teamgenoot engaget.`);
  if (l.kp != null && !ok("kp", l.kp)) t.push(`KP ${l.kp}%: wees bij elke drake/herald en elk gevecht bij een objective; een kill in een lege jungle levert minder op.`);
  if (l.cw != null && !ok("cw", l.cw)) t.push("Geen control ward gekocht: elke back één, in de river-bush bij drake of herald.");
  if (!ok("csm", l.csm)) t.push(`CS ${l.csm}/min: tussen ganks door camps blijven clearen; laat geen camps staan als er niets te halen valt.`);
  return t;
}

module.exports = { TARGETS, ok, fromEog, fromGame, riftGames, average, tips };
