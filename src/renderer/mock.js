// Alleen voor ontwerpen in een gewone browser (zonder Electron/League):
// open index.html?mock=1 en je ziet een voorbeeldstaat (Irelia vs Jax).
(function () {
  if (window.lolTool) return;
  const V = "16.20.1";
  const q = new URLSearchParams(location.search);
  const idle = {
    client: q.get("mock") === "idle" ? "zoeken" : "verbonden", phase: "Lobby", me: null, enemy: null, enemies: [], runes: null, items: null, guide: null,
    applied: {}, log: ["16:02:11  Verbonden met League-client", "16:02:10  Data Dragon 16.20.1"],
    settings: { tier: "gold_plus", autoRunes: true, autoItems: true, runeChoice: "pick" },
  };
  const perk = (id, name, icon, style) => [id, { name, icon, style }];
  const perkInfo = Object.fromEntries([
    perk(8000, "Precision", "perk-images/Styles/7201_Precision.png"), perk(8300, "Inspiration", "perk-images/Styles/7203_Whimsy.png"),
    perk(8010, "Conqueror", "perk-images/Styles/Precision/Conqueror/Conqueror.png", 8000),
    perk(9111, "Triumph", "perk-images/Styles/Precision/Triumph.png", 8000),
    perk(9104, "Legend: Alacrity", "perk-images/Styles/Precision/LegendAlacrity/LegendAlacrity.png", 8000),
    perk(8299, "Last Stand", "perk-images/Styles/Sorcery/LastStand/LastStand.png", 8000),
    perk(8313, "Triple Tonic", "perk-images/Styles/Inspiration/TripleTonic/TripleTonic.png", 8300),
    perk(8316, "Jack Of All Trades", "perk-images/Styles/Inspiration/JackOfAllTrades/JackofAllTrades2.png", 8300),
  ]);
  const full = {
    ...idle, phase: "ChampSelect",
    champUrl: `https://ddragon.leagueoflegends.com/cdn/${V}/img/champion/`,
    me: { id: 39, name: "Irelia", slug: "Irelia", image: "Irelia.png" }, lane: "top",
    enemy: { id: 24, name: "Jax", slug: "Jax", image: "Jax.png" }, enemies: [],
    applied: { runes: "Irelia vs Jax", items: "Irelia vs Jax" },
    runes: { pages: [
      { label: "Meest gespeeld", wr: 50.8, n: 272718, pri: [8010, 9111, 9104, 8299], sec: [8313, 8316], mod: [5005, 5008, 5011] },
      { label: "Hoogste winrate", wr: 52.1, n: 38012, pri: [8010, 9111, 9104, 8299], sec: [8316, 8313], mod: [5005, 5008, 5001] },
    ], perkInfo, shards: { 5005: "Attack Speed", 5008: "Adaptive Force", 5011: "Health", 5001: "Health Scaling" } },
    items: { itemUrl: `https://ddragon.leagueoflegends.com/cdn/${V}/img/item/`, starters: [3153, 3146, 3091], core: [3153, 3047, 3181, 3091, 6333, 6672], situational: [3026, 3110, 2517, 3053, 3156],
      names: { 3153: "Blade of The Ruined King", 3146: "Hextech Gunblade", 3091: "Wit's End", 3047: "Plated Steelcaps", 3181: "Hullbreaker", 6333: "Death's Dance", 6672: "Kraken Slayer", 3026: "Guardian Angel", 3110: "Frozen Heart", 2517: "Endless Hunger", 3053: "Sterak's Gage", 3156: "Maw of Malmortius" },
      gold: { 3153: 3200, 3146: 3000, 3091: 2800, 3047: 1200, 3181: 3000, 6333: 3300, 6672: 3100, 3026: 3200, 3110: 2500, 2517: 3000, 3053: 3200, 3156: 3100 },
      builds: [{ items: [3153, 3181, 3091, 6333, 6672], picks: 113, wins: 55, wr: 48.7 }, { items: [3153, 3091, 3181, 6333, 3026], picks: 97, wins: 52, wr: 53.6 }] },
    guide: { level: "MOEILIJK", counterRow: { vsWr: 46.6, n: 10440 },
      headline: ["Irelia vs Jax — 46.6% winrate (10.440 games)", "MOEILIJK: Duidelijke counter: niet sterven, boeren en wachten op jungle."],
      sections: [
        { title: "Zo speel je Irelia", items: ["Level 1-2: alleen traden als je Q-reset op minions kunt pakken.", "Powerspike: level 3 (W) en eerste item.", "Q-resets zijn alles: zet minions laag voordat je de tegenstander opzoekt.", "E-stun altijd dóór de tegenstander plaatsen; mis je E, trek je terug."] },
        { title: "Tegen Jax", items: ["Trade NOOIT in zijn E (counter strike); wacht tot hij hem gebruikt heeft, dan all-in.", "Pre-6 ben jij sterker met Q-resets; na zijn eerste item kantelt het.", "Hou je E voor als hij op je springt (Q).", "Vroeg Wit's End of Plated Steelcaps."] },
        { title: "Uit de data", items: ["Build: BotRK → Steelcaps → Hullbreaker → Wit's End → Death's Dance → Kraken", "Tegen Jax eerst overwegen: Guardian Angel, Frozen Heart, Endless Hunger", "Waarom: hij doet vooral AD-damage → armor; hij heelt veel → anti-heal vroeg", "Runes: Meest gespeeld (50.8% over 272.718 games)"] },
      ] },
    log: ["16:03:40  Item set gezet: Irelia vs Jax", "16:03:39  Runes gezet: Irelia vs Jax", "16:03:38  Tegenstander in lane: Jax (46.6% wr)", "16:03:37  Champ select: Irelia (top)", ...idle.log],
  };
  let state = q.get("mock") === "idle" || q.get("mock") === "wait" ? idle : full;
  const subs = [];
  window.lolToolMock = {
    getState: async () => state,
    setSettings: async (p) => { state = { ...state, settings: { ...state.settings, ...p } }; subs.forEach((f) => f(state)); return state.settings; },
    reapply: async () => true,
    onState: (f) => subs.push(f),
  };
})();
