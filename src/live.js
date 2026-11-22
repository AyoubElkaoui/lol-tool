// In-game data via Riot's Live Client Data API (alleen lokaal, tijdens een game):
// https://127.0.0.1:2999/liveclientdata/allgamedata. Alles wat hier staat kun je in de game
// zelf ook zien (Tab-scorebord, kill-meldingen); de tool zet het alleen op een rij.
// Geen cooldowns van vijanden, geen info die je in de game niet hebt (Riot-regels).

const https = require("https");
const an = require("./analysis");
const guide = require("./guide");

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
const LEGENDARY_GOLD = 2200;   // vanaf dit bedrag telt een item als "item af" (powerspike)
const ALERT_SECS = 25;         // zo lang (game-tijd) blijft een melding staan
const TILT_WINDOW = 150;       // 2 deaths binnen zoveel seconden = tilt-melding
const POS = { top: "TOP", jungle: "JUNGLE", middle: "MIDDLE", bottom: "BOTTOM", support: "UTILITY" };
const LANE_NL = { top: "top", jungle: "jungle", middle: "mid", bottom: "bot", support: "support" };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const k1 = (g) => Math.round(g / 100) / 10; // goud in duizendtallen, 1 decimaal
const nl = (x) => String(x).replace(".", ",");

// "game_character_displayname_MonkeyKing" -> champion uit Data Dragon.
function champOf(p, champsBySlug, champsByName) {
  const raw = String(p.rawChampionName || "").replace(/^game_character_displayname_/, "");
  return champsBySlug[raw] || champsByName[p.championName] || null;
}

// Goud dat iemand in items heeft zitten: de beste maat voor "hoe fed is hij".
function itemGold(p, itemData) {
  return (p.items || []).reduce((a, it) => a + (itemData[it.itemID]?.gold || 0) * (it.count || 1), 0);
}

const nameOf = (p) => String(p.riotIdGameName || String(p.riotId || "").split("#")[0] || p.summonerName || "");
const idOf = (p) => p.riotId || p.summonerName || p.championName;
const hasSmite = (p) => ["summonerSpellOne", "summonerSpellTwo"].some((k) => /smite/i.test(`${p.summonerSpells?.[k]?.rawDisplayName || ""} ${p.summonerSpells?.[k]?.displayName || ""}`));
const isLegendary = (it) => it && it.gold >= LEGENDARY_GOLD && !it.tags.includes("Boots") && !it.tags.includes("Consumable");

// Geheugen tussen ticks (levels, items, deaths), per game opnieuw.
let mem = null;
function memFor(d, t) {
  const key = (d.allPlayers || []).map(idOf).sort().join("|");
  if (!mem || mem.key !== key || t < mem.t - 30) mem = { key, t, seen: {}, alerts: [], deaths: [], lastDeaths: 0, lastGold: null, lastBuyAlert: -999, once: new Set(), fresh: true };
  mem.t = t;
  return mem;
}
function alert(m, id, text, cls, t, secs = ALERT_SECS) {
  if (m.once.has(id)) return;
  m.once.add(id);
  m.alerts.push({ id, text, cls, until: t + secs });
}

// Level 6 en "item af" voor de spelers die ertoe doen. De eerste keer dat we iemand zien
// alleen onthouden (anders krijg je na een herstart van de app een stortvloed aan meldingen).
function spikes(m, t, tracked, itemData, champTip) {
  for (const { p, who, role } of tracked) {
    if (!p) continue;
    const id = idOf(p);
    const items = (p.items || []).map((i) => i.itemID).filter((i) => isLegendary(itemData[i]));
    const prev = m.seen[id];
    m.seen[id] = { level: p.level || 0, items };
    if (!prev) continue;
    if (prev.level < 6 && (p.level || 0) >= 6) {
      const text = {
        me: `Level 6: jouw R is er. ${champTip || "Zoek een play met je team."}`,
        lane: `${who} is level 6: zijn R is er. Speel achter je wave tot je ziet wat hij doet.`,
        jungle: `Hun jungler (${who}) is level 6: ward je flank en push niet ver zonder vision.`,
        duo: `${who} is level 6: ${role === "jungle" ? "zijn R is er. Push je wave en ga mee als hij gankt." : "zijn R is er. Gank zijn lane, dan is een kill bijna zeker."}`,
      }[who === "me" ? "me" : role === "lane" ? "lane" : role === "enemyJungle" ? "jungle" : "duo"];
      alert(m, `lvl6:${id}`, text, who === "me" || role === "duo" || role === "jungle" ? "ok" : "warn", t);
    }
    if (role === "enemyJungle") continue; // items van hun jungler: te veel meldingen
    for (const itemId of items.filter((i) => !prev.items.includes(i))) {
      const name = itemData[itemId]?.name || "item";
      const text = who === "me" ? `Item af: ${name}. Powerspike: zoek nu een trade of gevecht.`
        : role === "lane" ? `${who} heeft ${name}: hij is nu sterker. Geen all-in zonder voorsprong.`
        : `${who} heeft ${name}: goed moment om samen een play te maken.`;
      alert(m, `item:${id}:${itemId}`, text, role === "lane" || role === "enemyJungle" ? "warn" : "ok", t);
    }
  }
}

// Je duo: level, items tegen zijn directe tegenstander, en wat dat betekent voor jou.
function duoView({ duo, duoOpp, cfg, me, t, itemData, champ, lane }) {
  if (!duo) return null;
  const s = duo.scores || {};
  const out = {
    name: cfg.name, champ: champ?.name || duo.championName, img: champ?.image || null, level: duo.level || 0,
    kda: `${s.kills || 0}/${s.deaths || 0}/${s.assists || 0}`, dead: !!duo.isDead && duo.respawnTimer > 1, secs: Math.round(duo.respawnTimer || 0),
    diff: null, advice: null, cls: "",
  };
  if (duoOpp) out.diff = k1(itemGold(duo, itemData) - itemGold(duoOpp, itemData));
  const n = cfg.name;
  const jgl = cfg.lane === "jungle";
  if (out.dead) {
    out.advice = jgl ? `${n} is dood (${out.secs}s): speel veilig, zonder jungler geen gevecht in de river.` : `${n} is dood (${out.secs}s): hun ${LANE_NL[cfg.lane] || "laner"} kan roamen. Ping en ward je kant.`;
    out.cls = "warn";
  } else if (out.diff != null && out.diff >= 1) {
    out.advice = jgl ? `${n} staat voor (+${nl(out.diff)}k): push je wave en ga mee naar zijn kant (scuttle, invade, drake).` : `${n} staat voor (+${nl(out.diff)}k): gank zijn lane of pak samen drake/herald.`;
    out.cls = "ok";
  } else if (out.diff != null && out.diff <= -1.5) {
    out.advice = jgl ? `${n} staat achter (${nl(out.diff)}k): help bij zijn scuttle en buffs, push zodat jouw laner niet kan volgen.` : `${n} staat achter (${nl(out.diff)}k): gank zijn tegenstander als die ver pusht, geen 2v2 zonder vision.`;
    out.cls = "bad";
  } else if ((me.level || 0) >= 6 && out.level >= 6 && t < 900 && lane !== cfg.lane) {
    out.advice = "Allebei level 6: goed moment voor een play samen (mid-gank of drake).";
  }
  return out;
}

/**
 * Maakt van de ruwe live-data wat de overlay laat zien.
 * plan: { build: [itemIds in volgorde], extra: [overige items die jouw champ bouwt] }
 * ctx (optioneel): { lane, laneEnemyId, duo: { name, lane, riotName }, show: { duo, spikes, coach }, vpmMin }
 */
function analyse(d, { itemData, champs, plan, targets, lane = null, laneEnemyId = null, roles = {}, duo: duoCfg = null, show = {}, vpmMin = 0.8 }) {
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
  const champOfP = (p) => champOf(p, champsBySlug, champsByName);
  // Vijand in een lane: positie uit de game (ranked), anders de rolverdeling uit champ select.
  const enemyIn = (ln) => enemies.find((p) => p.position && p.position === POS[ln]) || enemies.find((p) => roles[champOfP(p)?.id] === ln) || null;
  const m = memFor(d, t);
  const myChamp = champOfP(me);
  const myLane = lane || (hasSmite(me) ? "jungle" : null);

  // Wie is fed: meeste itemgoud, en duidelijk meer dan het gemiddelde van zijn team.
  const rows = enemies.map((p) => ({ p, champ: champOfP(p), gold: itemGold(p, itemData) }));
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
      lead: k1(top.gold - myGold), type,
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
  const dead = enemies.filter((p) => p.isDead && p.respawnTimer > 3).map((p) => ({ name: champOfP(p)?.name || p.championName, secs: Math.round(p.respawnTimer) }))
    .sort((a, b) => b.secs - a.secs);

  // Doelen live: CS/min, deaths, KP, vision, control ward in je items.
  const s = me.scores || {};
  const csm = Math.round(((s.creepScore || 0) / mins) * 10) / 10;
  const teamKills = allies.reduce((a, p) => a + (p.scores?.kills || 0), 0);
  const enemyKills = enemies.reduce((a, p) => a + (p.scores?.kills || 0), 0);
  const kp = teamKills ? Math.round((((s.kills || 0) + (s.assists || 0)) / teamKills) * 100) : null;
  const vpm = t >= 300 ? Math.round(((s.wardScore || 0) / mins) * 10) / 10 : null;
  const goals = {
    csm, csmOk: csm >= (targets?.csm?.min ?? 6.5), csmMin: targets?.csm?.min ?? 6.5,
    deaths: s.deaths || 0, deathsOk: (s.deaths || 0) <= (targets?.deaths?.max ?? 5),
    kp, kpOk: kp == null ? null : kp >= (targets?.kp?.min ?? 55), kpMin: targets?.kp?.min ?? 55,
    vpm, vpmOk: vpm == null ? null : vpm >= vpmMin, vpmMin,
    ward: owned.has(CONTROL_WARD),
  };

  // Directe tegenstander: uit champ select, anders Smite (jungle) of de positie die de game geeft.
  const laneOpp = (laneEnemyId && enemies.find((p) => champOfP(p)?.id === laneEnemyId))
    || (myLane === "jungle" ? enemies.find(hasSmite) : myLane ? enemyIn(myLane) : null) || null;
  const enemyJungle = myLane !== "jungle" ? enemies.find(hasSmite) || null : null;

  // Duo: op Riot-naam, anders op zijn lane (Smite = jungle).
  let duo = null, duoP = null;
  if (duoCfg && show.duo !== false) {
    const mates = allies.filter((p) => p !== me);
    const want = String(duoCfg.riotName || "").toLowerCase();
    duoP = (want && mates.find((p) => nameOf(p).toLowerCase().startsWith(want)))
      || (duoCfg.lane === "jungle" ? mates.find(hasSmite) : mates.find((p) => p.position === POS[duoCfg.lane])) || null;
    const duoOpp = duoP ? (duoCfg.lane === "jungle" ? enemies.find(hasSmite) : duoCfg.lane === myLane ? laneOpp : enemyIn(duoCfg.lane)) : null;
    duo = duoView({ duo: duoP, duoOpp, cfg: duoCfg, me, t, itemData, champ: duoP ? champOfP(duoP) : null, lane: myLane });
  }

  // Power spikes: jij, je tegenstander, hun jungler, je duo.
  if (show.spikes !== false) {
    const g = guide.load();
    const tip = myChamp ? (g[myChamp.lolaSlug]?.spike || "").replaceAll("{duo}", duoCfg?.name || "je jungler") : "";
    spikes(m, t, [
      { p: me, who: "me", role: "me" },
      { p: laneOpp, who: laneOpp ? champOfP(laneOpp)?.name || laneOpp.championName : "", role: "lane" },
      { p: enemyJungle !== laneOpp ? enemyJungle : null, who: enemyJungle ? champOfP(enemyJungle)?.name || enemyJungle.championName : "", role: "enemyJungle" },
      { p: duoP, who: duoCfg?.name || "", role: duoCfg?.lane === "jungle" ? "jungle" : "duo" },
    ], itemData, tip || null);
  }

  // Coach: anti-tilt en control wards.
  const coach = [];
  if (show.coach !== false) {
    const deaths = s.deaths || 0;
    if (m.fresh) m.lastDeaths = deaths; // app midden in een game gestart: oude deaths niet meetellen
    if (deaths > m.lastDeaths) for (let i = m.lastDeaths; i < deaths; i++) m.deaths.push(t);
    m.lastDeaths = deaths;
    const recent = m.deaths.filter((x) => t - x <= TILT_WINDOW);
    if (recent.length >= 2) alert(m, `tilt:${deaths}`, `${recent.length} deaths kort na elkaar: reset. Eén minuut veilig farmen, wacht op je team en begin zelf geen gevecht.`, "warn", t, 45);
    if (deaths >= 3 && t < 600) alert(m, "early3", "3 deaths vóór 10 minuten: de game is niet weg. Farm, ward, speel voor je items en je team.", "warn", t, 45);
    // Net gekocht (itemgoud omhoog) zonder control ward in je inventory.
    if (m.lastGold != null && myGold - m.lastGold >= 300 && !goals.ward && t > 300 && t - m.lastBuyAlert > 180) {
      m.lastBuyAlert = t;
      m.once.delete("buy");
      alert(m, "buy", "Gekocht zonder control ward: neem de volgende back er één mee (75 goud).", "bad", t, 20);
    }
    m.lastGold = myGold;
    if (t >= 20 && t < 120) coach.push("Tip: /mute all als de chat je irriteert. Pings blijven werken.");
    if (t >= 600 && enemyKills - teamKills >= 7) coach.push("Jullie staan achter: speel voor objectives aan de kant die wint, geen 1v1's. Vroeg surrenderen is oké als het echt weg is.");
    if (myLane === "jungle" && t < 900) {
      const behind = allies.filter((p) => p !== me && !hasSmite(p) && (p.scores?.deaths || 0) >= 4 && (p.scores?.deaths || 0) >= (p.scores?.kills || 0) + 3);
      if (behind.length) coach.push(`${behind.map((p) => champOfP(p)?.name || p.championName).join(", ")} staat achter: daar niet blijven ganken, speel aan de kant die wint.`);
    }
  }
  m.fresh = false;
  m.alerts = m.alerts.filter((a) => a.until > t);

  return {
    time: mmss(t), threat, next, gold, timers, dead, goals, champ: myChamp?.name || me.championName,
    duo, alerts: m.alerts.slice(-4).map(({ text, cls }) => ({ text, cls })), coach,
    lane: laneOpp ? { name: champOfP(laneOpp)?.name || laneOpp.championName, level: laneOpp.level || 0, diff: k1(myGold - itemGold(laneOpp, itemData)) } : null,
  };
}

const reset = () => { mem = null; };

module.exports = { allGameData, analyse, reset };
