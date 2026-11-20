// In-game data via Riot's Live Client Data API (alleen lokaal, tijdens een game):
// https://127.0.0.1:2999/liveclientdata/allgamedata. Alles wat hier staat kun je in de game
// zelf ook zien (Tab-scorebord, kill-meldingen); de tool zet het alleen op een rij.

const https = require("https");
const an = require("./analysis");

function get(path) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: "127.0.0.1", port: 2999, path, rejectUnauthorized: false, timeout: 1500 }, (res) => {
      let buf = "";
      res.on("data", (d) => (buf += d));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`live ${res.statusCode}`));
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("live timeout")));
  });
}

const allGameData = () => get("/liveclientdata/allgamedata");

const DRAGON_RESPAWN = 300, BARON_RESPAWN = 360, ELDER_RESPAWN = 360;
const CONTROL_WARD = 2055;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// "game_character_displayname_MonkeyKing" -> champion uit Data Dragon.
function champOf(p, champsBySlug, champsByName) {
  const raw = String(p.rawChampionName || "").replace(/^game_character_displayname_/, "");
  return champsBySlug[raw] || champsByName[p.championName] || null;
}

// Goud dat iemand in items heeft zitten: de beste maat voor "hoe fed is hij".
function itemGold(p, itemData) {
  return (p.items || []).reduce((a, it) => a + (itemData[it.itemID]?.gold || 0) * (it.count || 1), 0);
}

/**
 * Maakt van de ruwe live-data wat de overlay laat zien.
 * plan: { build: [itemIds in volgorde], extra: [overige items die jouw champ bouwt] }
 */
function analyse(d, { itemData, champs, plan, targets }) {
  const champsBySlug = Object.fromEntries(Object.values(champs).map((c) => [c.slug, c]));
  const champsByName = Object.fromEntries(Object.values(champs).map((c) => [c.name, c]));
  const ap = d.activePlayer || {};
  const players = d.allPlayers || [];
  const me = players.find((p) => (ap.riotId && p.riotId === ap.riotId) || (ap.summonerName && p.summonerName === ap.summonerName));
  if (!me) return null;
  const t = d.gameData?.gameTime || 0;
  const mins = Math.max(1, t / 60);
  const enemies = players.filter((p) => p.team !== me.team);
  const allies = players.filter((p) => p.team === me.team);

  // Wie is fed: meeste itemgoud, en duidelijk meer dan het gemiddelde van zijn team.
  const rows = enemies.map((p) => ({ p, champ: champOf(p, champsBySlug, champsByName), gold: itemGold(p, itemData) }));
  const avg = rows.reduce((a, r) => a + r.gold, 0) / Math.max(1, rows.length);
  const top = [...rows].sort((a, b) => b.gold - a.gold)[0];
  const myGold = itemGold(me, itemData);
  let threat = null;
  if (top && t > 300 && top.gold > avg * 1.25 && top.gold > 1500) {
    const type = an.dmgType(top.champ);
    const owned = new Set((me.items || []).map((i) => i.itemID));
    const want = (it) => (type === "AP" ? it.tags.includes("SpellBlock") : it.tags.includes("Armor")) && !it.tags.includes("Boots");
    const cand = [...(plan?.build || []), ...(plan?.extra || [])].map((id) => itemData[id]).find((it) => it && want(it) && !owned.has(it.id));
    const s = top.p.scores || {};
    threat = {
      name: top.champ?.name || top.p.championName, img: top.champ?.image || null,
      kda: `${s.kills || 0}/${s.deaths || 0}/${s.assists || 0}`,
      lead: Math.round((top.gold - myGold) / 100) / 10, type,
      item: cand ? { id: cand.id, name: cand.name } : null,
      why: type === "AP" ? "magic resist" : "armor",
    };
  }

  // Volgende item uit je build dat je nog niet hebt, en hoeveel goud je nog mist.
  const owned = new Set((me.items || []).map((i) => i.itemID));
  const nextId = (plan?.build || []).find((id) => itemData[id] && !owned.has(id) && !itemData[id].tags.includes("Boots"));
  const gold = Math.floor(ap.currentGold || 0);
  const next = nextId ? { id: nextId, name: itemData[nextId].name, cost: itemData[nextId].gold, missing: Math.max(0, itemData[nextId].gold - gold) } : null;

  // Objectives: respawn na een kill (alleen wat in de kill-meldingen staat).
  const ev = d.events?.Events || [];
  const last = (name, pred = () => true) => [...ev].reverse().find((e) => e.EventName === name && pred(e));
  const timers = [];
  const drag = last("DragonKill");
  if (drag) {
    const elder = /elder/i.test(drag.DragonType || "");
    const at = drag.EventTime + (elder ? ELDER_RESPAWN : DRAGON_RESPAWN);
    if (at > t) timers.push({ label: elder ? "Elder" : "Drake", left: mmss(at - t), soon: at - t < 60 });
  }
  const baron = last("BaronKill");
  if (baron && baron.EventTime + BARON_RESPAWN > t) timers.push({ label: "Baron", left: mmss(baron.EventTime + BARON_RESPAWN - t), soon: baron.EventTime + BARON_RESPAWN - t < 60 });

  // Dode vijanden: kans om te pushen of een objective te pakken.
  const dead = enemies.filter((p) => p.isDead && p.respawnTimer > 3).map((p) => ({ name: champOf(p, champsBySlug, champsByName)?.name || p.championName, secs: Math.round(p.respawnTimer) }))
    .sort((a, b) => b.secs - a.secs);

  // Doelen live: CS/min, deaths, control ward in je items.
  const s = me.scores || {};
  const csm = Math.round(((s.creepScore || 0) / mins) * 10) / 10;
  const goals = {
    csm, csmOk: csm >= (targets?.csm?.min ?? 6.5),
    deaths: s.deaths || 0, deathsOk: (s.deaths || 0) <= (targets?.deaths?.max ?? 5),
    ward: (me.items || []).some((i) => i.itemID === CONTROL_WARD),
  };
  const teamKills = allies.reduce((a, p) => a + (p.scores?.kills || 0), 0);
  goals.kp = teamKills ? Math.round((((s.kills || 0) + (s.assists || 0)) / teamKills) * 100) : null;

  return { time: mmss(t), threat, next, gold, timers, dead, goals, champ: champOf(me, champsBySlug, champsByName)?.name || me.championName };
}

module.exports = { allGameData, analyse };
