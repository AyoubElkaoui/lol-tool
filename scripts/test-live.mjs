// Test de overlay-analyse zonder game: nep-data in het formaat van /liveclientdata/allgamedata.
// Gebruik: node scripts/test-live.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dd = require("../src/ddragon.js");
const live = require("../src/live.js");
const goals = require("../src/goals.js");
const p = (name, raw, team, k, d, a, cs, items, extra = {}) => ({ championName: name, rawChampionName: "game_character_displayname_" + raw, team, riotId: name + "#1", summonerName: name, scores: { kills: k, deaths: d, assists: a, creepScore: cs }, items: items.map((id) => ({ itemID: id, count: 1 })), isDead: false, respawnTimer: 0, ...extra });
const data = {
  activePlayer: { riotId: "Gangplank#1", currentGold: 1900 },
  gameData: { gameTime: 1260 },
  allPlayers: [
    p("Gangplank", "Gangplank", "ORDER", 3, 4, 2, 120, [3508, 3047]),
    p("Rengar", "Rengar", "ORDER", 5, 3, 4, 110, [6692, 3047]),
    p("Ahri", "Ahri", "ORDER", 2, 3, 5, 150, [6655]),
    p("Ashe", "Ashe", "ORDER", 1, 4, 3, 140, [6672]),
    p("Lux", "Lux", "ORDER", 0, 2, 6, 20, [3870]),
    p("Darius", "Darius", "CHAOS", 9, 1, 2, 160, [3078, 3047, 6333, 3053], { isDead: true, respawnTimer: 24 }),
    p("Warwick", "Warwick", "CHAOS", 2, 3, 5, 120, [6631]),
    p("Zed", "Zed", "CHAOS", 3, 3, 2, 140, [3142], { isDead: true, respawnTimer: 12 }),
    p("Caitlyn", "Caitlyn", "CHAOS", 2, 2, 3, 150, [3031]),
    p("Leona", "Leona", "CHAOS", 0, 3, 8, 20, [3190]),
  ],
  events: { Events: [{ EventName: "GameStart", EventTime: 0 }, { EventName: "DragonKill", EventTime: 1100, DragonType: "Fire" }] },
};
const view = live.analyse(data, { itemData: await dd.items(), champs: await dd.champions(), plan: { build: [3508, 3047, 6676, 3031, 3036], extra: [3026, 6333, 3156] }, targets: goals.TARGETS });
console.log(JSON.stringify(view, null, 2));
