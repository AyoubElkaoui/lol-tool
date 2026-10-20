// u.gg overview-JSON (onofficieel, zelfde bron als de site): summoner spells,
// skill order, startitems en 4e/5e/6e-item-opties. lolalytics heeft dit niet.
//   https://stats2.u.gg/lol/1.5/overview/<16_20>/ranked_solo_5x5/<champId>/1.5.0.json
// Structuur: data[region][tier][role] = [ [runes], [spells], [start], [core], [skills], [itemOptions], [games], ?, [shards], ... ]
// region 12 = wereld; role 1=jungle 2=support 3=adc 4=top 5=mid.

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
  Referer: "https://u.gg/", Origin: "https://u.gg",
};
const ROLE = { jungle: "1", support: "2", bottom: "3", top: "4", middle: "5" };
// u.gg tier-ids: 7 bronze, 6 silver, 5 gold, 10 platinum_plus, 16 emerald_plus, 12 overall(ish)
const TIER = { bronze: "7", silver: "6", gold_plus: "10", emerald_plus: "16", all: "10" };
const memo = new Map();

async function overview({ patch, championId, lane, tier }) {
  const key = `${patch}|${championId}`;
  let data = memo.get(key)?.v;
  if (!data || Date.now() - memo.get(key).t > 30 * 60 * 1000) {
    const url = `https://stats2.u.gg/lol/1.5/overview/${patch.replace(".", "_")}/ranked_solo_5x5/${championId}/1.5.0.json`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`u.gg ${r.status}`);
    data = await r.json();
    memo.set(key, { t: Date.now(), v: data });
  }
  const region = data["12"] || data[Object.keys(data)[0]];
  const tiers = region || {};
  const t = tiers[TIER[tier]] || tiers["10"] || tiers[Object.keys(tiers)[0]];
  const roleData = t?.[ROLE[lane]] || t?.[Object.keys(t || {})[0]];
  const row = Array.isArray(roleData) ? roleData[0] : null;
  if (!row) throw new Error("u.gg: geen data voor deze rol");
  const [runes, spells, start, core, skills, options, games, , shards] = row;
  const opt = (i) => (options?.[i] || []).map((x) => ({ id: x[0], wins: x[1], games: x[2], wr: x[2] ? Math.round((x[1] / x[2]) * 1000) / 10 : 0 }));
  return {
    spells: spells?.[2] || [],                 // [4,14] = Flash, Ignite
    starters: start?.[2] || [],
    core: core?.[2] || [],
    skillOrder: skills?.[2] || [],             // 18 letters
    skillPriority: skills?.[3] || "",          // "QWE"
    itemOptions: { 4: opt(0), 5: opt(1), 6: opt(2), start: opt(3) },
    games: games?.[1] || 0, wins: games?.[0] || 0,
    shards: (shards?.[2] || []).map(Number),
    runes: runes ? { pri: runes[2], sec: runes[3], perks: runes[4] } : null,
  };
}

const SPELL_NAMES = { 1: "Cleanse", 3: "Exhaust", 4: "Flash", 6: "Ghost", 7: "Heal", 11: "Smite", 12: "Teleport", 13: "Clarity", 14: "Ignite", 21: "Barrier", 32: "Mark" };
const SPELL_IMG = { 1: "SummonerBoost", 3: "SummonerExhaust", 4: "SummonerFlash", 6: "SummonerHaste", 7: "SummonerHeal", 11: "SummonerSmite", 12: "SummonerTeleport", 13: "SummonerMana", 14: "SummonerDot", 21: "SummonerBarrier", 32: "SummonerSnowball" };

module.exports = { overview, SPELL_NAMES, SPELL_IMG };
