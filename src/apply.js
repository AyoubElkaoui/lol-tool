// Runes en item sets in de client zetten via de LCU-API.
// Alles wat deze tool aanmaakt begint met "LoLTool" zodat we het zelf kunnen
// opruimen en nooit jouw eigen pages/sets overschrijven.

const dd = require("./ddragon");

const PREFIX = "LoLTool";

async function applyRunes(lcu, page, title) {
  const pri = page.pri, sec = page.sec, mod = page.mod;
  const primaryStyleId = await dd.perkStyle(pri[0]);
  const subStyleId = await dd.perkStyle(sec[0]);
  if (!primaryStyleId || !subStyleId) throw new Error("rune-tree onbekend");

  const pages = await lcu.get("/lol-perks/v1/pages");
  const mine = pages.filter((p) => p.isEditable && String(p.name).startsWith(PREFIX));
  for (const p of mine) { try { await lcu.del(`/lol-perks/v1/pages/${p.id}`); } catch { /* ok */ } }

  const inv = await lcu.get("/lol-perks/v1/inventory").catch(() => null);
  const editable = pages.filter((p) => p.isEditable && !String(p.name).startsWith(PREFIX));
  if (inv && editable.length >= inv.ownedPageCount) {
    const oldest = editable.sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0))[0];
    if (oldest) await lcu.del(`/lol-perks/v1/pages/${oldest.id}`);
  }

  const created = await lcu.post("/lol-perks/v1/pages", {
    name: `${PREFIX} ${title}`.slice(0, 25), primaryStyleId, subStyleId, selectedPerkIds: [...pri, ...sec, ...mod], current: true,
  });
  try { await lcu.put("/lol-perks/v1/currentpage", created.id); } catch { /* current:true volstaat meestal */ }
  return created;
}

const block = (type, ids) => ({ type: type.slice(0, 36), hideIfSummonerSpell: "", showIfSummonerSpell: "", items: ids.filter(Boolean).map((id) => ({ id: String(id), count: 1 })) });

// Twee sets per champ: "standaard" (meest gespeeld) en "vs team" (boots + defensief item op dit team).
async function applyItemSets(lcu, { championId, champName, build, teamBuild, vsName, teamNote }) {
  const summoner = await lcu.currentSummoner();
  const url = `/lol-item-sets/v1/item-sets/${summoner.summonerId}/sets`;
  const existing = await lcu.get(url).catch(() => ({ itemSets: [] }));
  const keep = (existing.itemSets || []).filter((s) => !(String(s.title).startsWith(PREFIX) && (s.associatedChampions || []).includes(championId)));
  const mk = (title, blocks, rank) => ({
    title: `${PREFIX} ${title}`.slice(0, 36), associatedChampions: [championId], associatedMaps: [11], blocks,
    map: "any", mode: "any", preferredItemSlots: [], sortrank: rank, startedFrom: "blank", type: "custom", uid: `${PREFIX}-${championId}-${rank}-${Date.now()}`,
  });
  const sets = [];
  if (teamBuild?.changed) {
    sets.push(mk(`${champName} vs ${vsName || "team"}`, [
      block("Start", build.starters),
      block(`Boots: ${teamBuild.bootsName || "zie team"}`, [teamBuild.boots.id]),
      block("Eerste 3 vs dit team", teamBuild.build.slice(0, 3)),
      block("Volledig vs dit team", teamBuild.build),
      block("Defensief als het misgaat", teamBuild.defensive),
    ], 2));
  }
  sets.push(mk(`${champName} standaard`, [
    block("Start", build.starters),
    block("Eerste 3 items", build.core.slice(0, 3)),
    block("Volledige build", build.core),
    block("Situationeel", build.situational),
  ], 1));
  await lcu.put(url, { accountId: existing.accountId ?? summoner.accountId, itemSets: [...keep, ...sets], timestamp: Date.now() });
  return sets;
}

module.exports = { applyRunes, applyItemSets, PREFIX };
