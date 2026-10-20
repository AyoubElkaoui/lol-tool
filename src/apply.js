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

  // Als alle slots vol zitten, verwijder de oudste bewerkbare page.
  const inv = await lcu.get("/lol-perks/v1/inventory").catch(() => null);
  const editable = pages.filter((p) => p.isEditable && !String(p.name).startsWith(PREFIX));
  if (inv && editable.length >= inv.ownedPageCount) {
    const oldest = editable.sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0))[0];
    if (oldest) await lcu.del(`/lol-perks/v1/pages/${oldest.id}`);
  }

  const body = {
    name: `${PREFIX} ${title}`.slice(0, 25),
    primaryStyleId,
    subStyleId,
    selectedPerkIds: [...pri, ...sec, ...mod],
    current: true,
  };
  const created = await lcu.post("/lol-perks/v1/pages", body);
  try { await lcu.put("/lol-perks/v1/currentpage", created.id); } catch { /* current:true volstaat meestal */ }
  return created;
}

function block(type, itemIds) {
  return { type, hideIfSummonerSpell: "", showIfSummonerSpell: "", items: itemIds.map((id) => ({ id: String(id), count: 1 })) };
}

async function applyItemSet(lcu, { championId, title, build, vsName }) {
  const summoner = await lcu.currentSummoner();
  const url = `/lol-item-sets/v1/item-sets/${summoner.summonerId}/sets`;
  const existing = await lcu.get(url).catch(() => ({ itemSets: [] }));
  const keep = (existing.itemSets || []).filter((s) => !(String(s.title).startsWith(PREFIX) && (s.associatedChampions || []).includes(championId)));

  const set = {
    title: `${PREFIX} ${title}`.slice(0, 36),
    associatedChampions: [championId],
    associatedMaps: [11],
    blocks: [
      block("Eerste item (keuzes)", build.starters),
      block("Eerste 3 items" + (vsName ? ` vs ${vsName}` : ""), build.core.slice(0, 3)),
      block("Volledige build", build.core),
      block("Situationeel", build.situational),
    ],
    map: "any",
    mode: "any",
    preferredItemSlots: [],
    sortrank: 0,
    startedFrom: "blank",
    type: "custom",
    uid: `${PREFIX}-${championId}-${Date.now()}`,
  };
  const body = { accountId: existing.accountId ?? summoner.accountId, itemSets: [...keep, set], timestamp: Date.now() };
  await lcu.put(url, body);
  return set;
}

module.exports = { applyRunes, applyItemSet, PREFIX };
