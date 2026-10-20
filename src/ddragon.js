// Statische data van Riot (Data Dragon): patch, champions, items, runes.
// Wordt één keer per patch opgehaald en op schijf gecachet.

const fs = require("fs");
const path = require("path");

const BASE = "https://ddragon.leagueoflegends.com";
let cacheDir = null;
let mem = { version: null, champions: null, items: null, runes: null, perkToStyle: null };

function setCacheDir(dir) { cacheDir = dir; fs.mkdirSync(dir, { recursive: true }); }

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": "lol-tool/0.1" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function cached(name, loader) {
  const file = cacheDir ? path.join(cacheDir, name) : null;
  if (file && fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* opnieuw laden */ }
  }
  const data = await loader();
  if (file) fs.writeFileSync(file, JSON.stringify(data));
  return data;
}

async function version() {
  if (mem.version) return mem.version;
  const versions = await fetchJson(`${BASE}/api/versions.json`);
  mem.version = versions[0];
  return mem.version;
}

// patch zoals lolalytics hem wil: "16.20"
async function lolalyticsPatch() {
  const v = await version();
  return v.split(".").slice(0, 2).join(".");
}

async function champions() {
  if (mem.champions) return mem.champions;
  const v = await version();
  const data = await cached(`champions-${v}.json`, async () => {
    const d = await fetchJson(`${BASE}/cdn/${v}/data/en_US/champion.json`);
    const byKey = {};
    for (const c of Object.values(d.data)) {
      byKey[Number(c.key)] = { id: Number(c.key), name: c.name, slug: c.id, image: c.image.full, tags: c.tags || [], partype: c.partype || "" };
    }
    return byKey;
  });
  for (const c of Object.values(data)) c.lolaSlug = lolalyticsSlug(c);
  mem.champions = data;
  return data;
}

// lolalytics gebruikt een eigen slug: lowercase, zonder spaties/punten/apostrofs.
// Uitzonderingen die afwijken van Data Dragon's id.
const SLUG_FIX = { MonkeyKing: "wukong", Nunu: "nunu", Renata: "renata", Chogath: "chogath", KSante: "ksante" };
function lolalyticsSlug(champ) {
  if (SLUG_FIX[champ.slug]) return SLUG_FIX[champ.slug];
  return champ.name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function items() {
  if (mem.items) return mem.items;
  const v = await version();
  const data = await cached(`items-${v}.json`, async () => {
    const d = await fetchJson(`${BASE}/cdn/${v}/data/en_US/item.json`);
    const out = {};
    for (const [id, it] of Object.entries(d.data)) {
      out[id] = { id: Number(id), name: it.name, image: it.image.full, gold: it.gold?.total ?? 0, tags: it.tags || [] };
    }
    return out;
  });
  mem.items = data;
  return data;
}

async function runes() {
  if (mem.runes) return mem.runes;
  const v = await version();
  const data = await cached(`runes-${v}.json`, () => fetchJson(`${BASE}/cdn/${v}/data/en_US/runesReforged.json`));
  mem.runes = data;
  mem.perkToStyle = {};
  mem.perkInfo = {};
  for (const style of data) {
    mem.perkInfo[style.id] = { name: style.name, icon: style.icon };
    for (const slot of style.slots) for (const p of slot.runes) {
      mem.perkToStyle[p.id] = style.id;
      mem.perkInfo[p.id] = { name: p.name, icon: p.icon, style: style.id };
    }
  }
  return data;
}

async function perkStyle(perkId) { await runes(); return mem.perkToStyle[perkId] ?? null; }
async function perkInfo(perkId) { await runes(); return mem.perkInfo?.[perkId] ?? null; }

// Stat-shards (mod) hebben geen style; namen voor de UI.
const SHARDS = {
  5008: "Adaptive Force", 5005: "Attack Speed", 5007: "Ability Haste",
  5010: "Move Speed", 5001: "Health Scaling", 5011: "Health", 5013: "Tenacity",
  5002: "Armor", 5003: "Magic Resist", 5001: "Health Scaling",
};

async function imageUrls() {
  const v = await version();
  return {
    champion: (img) => `${BASE}/cdn/${v}/img/champion/${img}`,
    item: (id) => `${BASE}/cdn/${v}/img/item/${id}.png`,
    rune: (icon) => `${BASE}/cdn/img/${icon}`,
  };
}

module.exports = { setCacheDir, version, lolalyticsPatch, champions, lolalyticsSlug, items, runes, perkStyle, perkInfo, SHARDS, imageUrls };
