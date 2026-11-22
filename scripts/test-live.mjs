// Test de overlay-analyse zonder game: nep-data in het formaat van /liveclientdata/allgamedata.
// Drie "ticks" achter elkaar: level 6, een item af, twee deaths kort na elkaar, gekocht zonder control ward.
// Gebruik: node scripts/test-live.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dd = require("../src/ddragon.js");
const live = require("../src/live.js");
const goals = require("../src/goals.js");

const smite = { summonerSpellOne: { rawDisplayName: "GeneratedTip_SummonerSpell_SummonerSmite_DisplayName" }, summonerSpellTwo: { rawDisplayName: "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName" } };
const flash = { summonerSpellOne: { rawDisplayName: "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName" }, summonerSpellTwo: { rawDisplayName: "GeneratedTip_SummonerSpell_SummonerTeleport_DisplayName" } };
const p = (name, raw, team, lvl, k, d, a, cs, items, extra = {}) => ({ championName: name, rawChampionName: "game_character_displayname_" + raw, team, level: lvl, riotId: name + "#1", riotIdGameName: name, summonerName: name, scores: { kills: k, deaths: d, assists: a, creepScore: cs, wardScore: 9 }, items: items.map((id) => ({ itemID: id, count: 1 })), summonerSpells: flash, isDead: false, respawnTimer: 0, position: "", ...extra });

function game(t, { meLvl, meItems, meDeaths, zedLvl, zedItems, dannyLvl, dannyDead }) {
  return {
    activePlayer: { riotId: "QyoubK#1", currentGold: 900 },
    gameData: { gameTime: t },
    allPlayers: [
      p("Galio", "Galio", "ORDER", meLvl, 2, meDeaths, 3, Math.round(t / 60 * 6.8), meItems, { riotId: "QyoubK#1", riotIdGameName: "QyoubK" }),
      p("Shaco", "Shaco", "ORDER", dannyLvl, 4, 1, 2, 60, [3142, 3047], { riotId: "EversD#070", riotIdGameName: "EversD", summonerSpells: smite, isDead: !!dannyDead, respawnTimer: dannyDead ? 22 : 0 }),
      p("Darius", "Darius", "ORDER", 7, 0, 5, 1, 80, [3047]),
      p("Jinx", "Jinx", "ORDER", 6, 1, 2, 2, 90, [3031]),
      p("Leona", "Leona", "ORDER", 5, 0, 2, 4, 10, [3190]),
      p("Zed", "Zed", "CHAOS", zedLvl, 3, 2, 1, 85, zedItems),
      p("Lee Sin", "LeeSin", "CHAOS", 6, 2, 3, 3, 50, [3047], { summonerSpells: smite }),
      p("Garen", "Garen", "CHAOS", 7, 3, 0, 1, 90, [3078]),
      p("Caitlyn", "Caitlyn", "CHAOS", 6, 2, 1, 2, 100, [3031]),
      p("Lux", "Lux", "CHAOS", 5, 0, 1, 5, 10, [3870]),
    ],
    events: { Events: [{ EventName: "GameStart", EventTime: 0 }, { EventName: "DragonKill", EventTime: t - 100, DragonType: "Fire" }] },
  };
}

const [itemData, champs] = await Promise.all([dd.items(), dd.champions()]);
const zed = Object.values(champs).find((c) => c.lolaSlug === "zed");
const ctx = {
  itemData, champs, plan: { build: [6653, 3020, 3157, 3089], extra: [3065, 4401] },
  targets: goals.targetsFor("middle"), vpmMin: goals.vpmTarget("middle"),
  lane: "middle", laneEnemyId: zed.id, duo: { name: "Danny", lane: "jungle", riotName: "EversD" }, show: {},
};
const ticks = [
  [400, { meLvl: 5, meItems: [1056], meDeaths: 0, zedLvl: 5, zedItems: [3134], dannyLvl: 5 }],
  [420, { meLvl: 6, meItems: [1056], meDeaths: 1, zedLvl: 6, zedItems: [3134], dannyLvl: 6 }],
  [500, { meLvl: 6, meItems: [1056, 6653], meDeaths: 2, zedLvl: 6, zedItems: [3142], dannyLvl: 6, dannyDead: true }],
];
for (const [t, st] of ticks) {
  const v = live.analyse(game(t, st), ctx);
  console.log(`\n--- ${v.time} ---`);
  console.log("doelen:", JSON.stringify(v.goals));
  console.log("duo:", JSON.stringify(v.duo));
  console.log("lane:", JSON.stringify(v.lane));
  for (const a of v.alerts) console.log(`  [${a.cls}] ${a.text}`);
  for (const c of v.coach) console.log(`  coach: ${c}`);
}
