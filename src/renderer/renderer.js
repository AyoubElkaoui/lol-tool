const $ = (s) => document.querySelector(s);
const DD = "https://ddragon.leagueoflegends.com";
const api = window.lolTool || window.lolToolMock; // mock.js vult lolToolMock als we niet in Electron draaien

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LANE_NL = { top: "Top", jungle: "Jungle", middle: "Mid", bottom: "Bot", support: "Support" };
const splash = (c) => `${DD}/cdn/img/champion/splash/${c.slug}_0.jpg`;
const icon = (s, c) => (s.champUrl ? s.champUrl + c.image : "");

function renderHero(s) {
  const h = $("#hero");
  if (!s.me) {
    h.className = "hero idle";
    h.innerHTML = `<div class="hero-inner"><div class="idle-art"></div><h1>${s.client === "verbonden" ? "Klaar voor champ select" : "Wachten op League"}</h1>
      <p>${s.client === "verbonden" ? "Kies je champion in champ select. Runes, item set en matchup-guide verschijnen hier vanzelf en staan meteen in je client." : "Start League of Legends. De tool vindt de client zelf."}</p>
      <ol class="steps"><li><b>1</b> Client aan</li><li><b>2</b> Champ locken</li><li><b>3</b> Spelen</li></ol></div>`;
    return;
  }
  h.className = "hero";
  const row = s.guide?.counterRow;
  h.innerHTML = `<div class="bg" style="background-image:url('${splash(s.me)}')"></div><div class="shade"></div>
    <div class="hero-inner">
      <div class="matchup">
        <div class="champ"><img src="${icon(s, s.me)}" alt="" /><div><div class="name">${esc(s.me.name)}</div><div class="lane">${esc(LANE_NL[s.lane] || s.lane || "")}</div></div></div>
        ${s.enemy ? `<span class="vs">VS</span><div class="champ enemy"><img src="${icon(s, s.enemy)}" alt="" /><div><div class="name">${esc(s.enemy.name)}</div><div class="lane">tegenstander</div></div></div>` : `<span class="wr">${s.enemies.length ? "Tegenstanders: " + s.enemies.map((e) => esc(e.name)).join(", ") : "Tegenstander nog niet gelockt"}</span>`}
      </div>
      <div class="wrline">
        ${s.guide?.level ? `<span class="badge ${s.guide.level}">${s.guide.level}</span>` : ""}
        ${row ? `<span class="wr"><b>${row.vsWr}%</b> winrate in deze matchup · ${Number(row.n).toLocaleString("nl-NL")} games</span>` : ""}
      </div>
      <div class="applied">
        <span class="chip ${s.applied.runes ? "" : "pending"}">${s.applied.runes ? "✓ Runes gezet" : s.settings.autoRunes ? "Runes…" : "Runes: handmatig"}</span>
        <span class="chip ${s.applied.items ? "" : "pending"}">${s.applied.items ? "✓ Item set gezet" : s.settings.autoItems ? "Items…" : "Items: handmatig"}</span>
      </div>
    </div>`;
}

function renderRunes(s) {
  const r = $("#runes");
  if (!s.runes) { r.innerHTML = "<h2>Runes</h2><div class='wr'>—</div>"; return; }
  const activeIdx = s.settings.runeChoice === "win" && s.runes.pages[1] ? 1 : 0;
  const perk = (id, key) => { const i = s.runes.perkInfo[id]; return i ? `<img class="${key ? "key" : ""}" src="${DD}/cdn/img/${i.icon}" title="${esc(i.name)}" alt="${esc(i.name)}" />` : ""; };
  const treeName = (id) => { const i = s.runes.perkInfo[id]; const st = i && s.runes.perkInfo[i.style]; return st ? `<img src="${DD}/cdn/img/${st.icon}" alt="" />${esc(st.name)}` : ""; };
  r.innerHTML = "<h2>Runes <small>in de client als “LoLTool …”</small></h2>" + s.runes.pages.map((p, i) => `
    <div class="runepage ${i === activeIdx ? "active" : ""}">
      <div class="ph"><b>${esc(p.label)}${i === activeIdx ? " · actief" : ""}</b><span>${p.wr}% · ${Number(p.n).toLocaleString("nl-NL")} games</span></div>
      <div class="trees">
        <div class="tree"><div class="tname">${treeName(p.pri[0])}</div><div class="perks">${perk(p.pri[0], true)}${p.pri.slice(1).map((id) => perk(id)).join("")}</div></div>
        <div class="tree"><div class="tname">${treeName(p.sec[0])}</div><div class="perks">${p.sec.map((id) => perk(id)).join("")}</div></div>
      </div>
      <div class="shards">${p.mod.map((id) => `<span class="shard">${esc(s.runes.shards[id] || id)}</span>`).join("")}</div>
    </div>`).join("");
}

function renderItems(s) {
  const it = $("#items");
  if (!s.items) { it.innerHTML = "<h2>Items</h2><div class='wr'>—</div>"; return; }
  const gold = (id) => s.items.gold?.[id] ? `<span class="g">${s.items.gold[id]}</span>` : "";
  const item = (id, n, core) => `<div class="item ${core ? "core" : ""}"><img src="${s.items.itemUrl}${id}.png" title="${esc(s.items.names[id] || id)}" alt="" />${n ? `<span class="n">${n}</span>` : ""}${gold(id)}</div>`;
  const row = (label, html) => html ? `<div class="irow"><div class="ilabel">${label}</div><div class="iline">${html}</div></div>` : "";
  it.innerHTML = "<h2>Items <small>item set staat in de winkel</small></h2>"
    + row("Eerste item (keuzes)", s.items.starters.map((id) => item(id)).join(""))
    + row("Build in volgorde", s.items.core.map((id, i) => item(id, i + 1, true)).join('<span class="arrow">›</span>'))
    + row(s.enemy ? `Tegen ${esc(s.enemy.name)} eerst overwegen` : "Situationeel", s.items.situational.map((id) => item(id)).join(""))
    + (s.items.builds?.length ? `<div class="ilabel">Meest gespeelde volledige builds</div>` + s.items.builds.slice(0, 4).map((b) => `<div class="build">${b.items.map((id) => item(id)).join("")}<span class="stat"><b>${b.wr}%</b> · ${b.picks} games</span></div>`).join("") : "");
}

function renderGuide(s) {
  const g = $("#guide");
  if (!s.guide) { g.innerHTML = ""; return; }
  g.innerHTML = "<h2>Guide</h2><div class='head'>" + s.guide.headline.map((h, i) => `<div class="${i ? "h2" : "h1"}">${esc(h)}</div>`).join("") + "</div>"
    + "<div class='gcards'>" + s.guide.sections.map((sec) => `<div class="gcard ${/data/i.test(sec.title) ? "data" : ""}"><h3>${esc(sec.title)}</h3><ul>${sec.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`).join("") + "</div>";
}

function render(s) {
  const st = $("#status");
  const phase = { ChampSelect: "champ select", InProgress: "in game", Lobby: "lobby", Matchmaking: "zoeken naar game", ReadyCheck: "accepteren!", EndOfGame: "einde game", None: "" }[s.phase] ?? s.phase ?? "";
  st.querySelector(".txt").textContent = s.client === "verbonden" ? `Verbonden${phase ? " · " + phase : ""}` : "Client zoeken…";
  st.className = "status" + (s.client === "verbonden" ? " on" : "");
  $("#tier").value = s.settings.tier; $("#runeChoice").value = s.settings.runeChoice;
  $("#autoRunes").checked = !!s.settings.autoRunes; $("#autoItems").checked = !!s.settings.autoItems;
  renderHero(s);
  $("#content").classList.toggle("hidden", !s.me);
  renderRunes(s); renderItems(s); renderGuide(s);
  $("#log pre").textContent = (s.log || []).join("\n");
}

for (const id of ["tier", "runeChoice"]) $("#" + id).addEventListener("change", (e) => api.setSettings({ [id]: e.target.value }));
for (const id of ["autoRunes", "autoItems"]) $("#" + id).addEventListener("change", (e) => api.setSettings({ [id]: e.target.checked }));
$("#reapply").addEventListener("click", () => api.reapply());
$("#toggleSettings").addEventListener("click", () => $("#settings").classList.toggle("hidden"));
document.addEventListener("click", (e) => { if (!e.target.closest("#settings") && !e.target.closest("#toggleSettings")) $("#settings").classList.add("hidden"); });

api.onState(render);
api.getState().then(render);
