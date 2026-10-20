const $ = (s) => document.querySelector(s);
const DD = "https://ddragon.leagueoflegends.com";
const api = window.lolTool || window.lolToolMock; // mock.js vult lolToolMock als we niet in Electron draaien

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LANE_NL = { top: "Top", jungle: "Jungle", middle: "Mid", bottom: "Bot", support: "Support" };
const splash = (c) => `${DD}/cdn/img/champion/splash/${c.slug}_0.jpg`;
const icon = (s, c) => (s.champUrl && c ? s.champUrl + c.image : "");
let buildTab = "team";

function renderHero(s) {
  const h = $("#hero");
  if (!s.me) {
    h.className = "hero idle";
    const inBan = s.phase === "ChampSelect";
    h.innerHTML = `<div class="hero-inner"><div class="idle-art"></div><h1>${s.client !== "verbonden" ? "Wachten op League" : inBan ? "Champ select" : "Klaar voor champ select"}</h1>
      <p>${s.client !== "verbonden" ? "Start League of Legends. De tool vindt de client zelf." : inBan ? "Hover of lock je champion; runes, items, spells en guide verschijnen hier vanzelf." : "Kies je champion in champ select. Runes, item sets en matchup-guide verschijnen hier vanzelf en staan meteen in je client."}</p>
      <ol class="steps"><li><b>1</b> Client aan</li><li><b>2</b> Champ hoveren</li><li><b>3</b> Spelen</li></ol></div>`;
    return;
  }
  h.className = "hero";
  const row = s.guide?.counterRow;
  const chip = (ok, txt, auto, alt) => `<span class="chip ${ok ? "" : "pending"}">${ok ? "✓ " + txt : auto ? txt + "…" : alt}</span>`;
  h.innerHTML = `<div class="bg" style="background-image:url('${splash(s.me)}')"></div><div class="shade"></div>
    <div class="hero-inner">
      <div class="matchup">
        <div class="champ"><img src="${icon(s, s.me)}" alt="" /><div><div class="name">${esc(s.me.name)}</div><div class="lane">${esc(LANE_NL[s.lane] || s.lane || "")}</div></div></div>
        ${s.enemy ? `<span class="vs">VS</span><div class="champ enemy"><img src="${icon(s, s.enemy)}" alt="" /><div><div class="name">${esc(s.enemy.name)}</div><div class="lane">tegenstander</div></div></div>` : `<span class="wr">${s.enemies.length ? "Nog geen tegenstander in jouw lane gezien" : "Tegenstander nog niet gelockt"}</span>`}
      </div>
      <div class="wrline">
        ${s.guide?.level ? `<span class="badge ${s.guide.level}">${s.guide.level}</span>` : ""}
        ${row ? `<span class="wr"><b>${row.vsWr}%</b> winrate in deze matchup · ${Number(row.n).toLocaleString("nl-NL")} games</span>` : ""}
      </div>
      <div class="applied">
        ${chip(s.applied.runes, "Runes gezet", s.settings.autoRunes, "Runes: handmatig")}
        ${chip(s.applied.items, "Item sets gezet", s.settings.autoItems, "Items: handmatig")}
        ${chip(s.applied.spells, "Spells gezet", s.settings.autoSpells, "Spells: handmatig")}
      </div>
    </div>`;
}

function renderBans(s) {
  const b = $("#bans");
  const show = s.phase === "ChampSelect" && s.bans && !s.me;
  b.classList.toggle("hidden", !show);
  if (!show) return;
  const list = s.bans.list || [];
  b.innerHTML = `<h2>Ban-advies <small>${esc(LANE_NL[s.bans.lane] || s.bans.lane)} · jouw pool: ${s.bans.pool.join(", ")} · tier ${esc(s.settings.tier)}</small></h2>
    <div class="banlist">${list.map((x, i) => `<div class="ban"><img src="${icon(s, x.champ)}" alt="" /><div><b>${i + 1}. ${esc(x.champ?.name)}</b><small>${esc(x.parts.join(" · "))}</small></div></div>`).join("") || "<span class='wr'>Geen data</span>"}</div>
    ${s.bans.hovers?.length ? `<div class="hovers">Zij hoveren: ${s.bans.hovers.map((c) => `<img src="${icon(s, c)}" title="${esc(c.name)}" alt="" /> ${esc(c.name)}`).join(" ")}</div>` : ""}`;
}

function renderTeam(s) {
  const t = $("#team");
  const show = s.team && s.team.count >= 1;
  t.classList.toggle("hidden", !show);
  if (!show) return;
  const tm = s.team;
  t.innerHTML = `<h2>Hun team <small>${tm.count}/5 bekend</small></h2>
    <div class="teamrow">
      <div class="enemies">${s.enemies.map((c) => `<img src="${icon(s, c)}" title="${esc(c.name)}" alt="" />`).join("")}</div>
      <span class="pill"><b>${tm.ad.length}</b> AD</span><span class="pill"><b>${tm.ap.length}</b> AP</span><span class="pill"><b>${tm.tanks.length}</b> tank</span>
      ${tm.healers.length ? `<span class="pill"><b>${tm.healers.length}</b> healer</span>` : ""}${tm.cc.length >= 3 ? `<span class="pill"><b>${tm.cc.length}</b> CC</span>` : ""}
      ${s.teamBuild?.boots ? `<span class="pill">Boots: <b>${esc(s.teamBuild.bootsName)}</b> · ${esc(s.teamBuild.boots.why)}</span>` : ""}
    </div>
    ${tm.notes.length ? `<ul class="teamnotes">${tm.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`;
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
  const hasTeam = s.teamBuild?.changed;
  if (!hasTeam) buildTab = "std";
  const tabs = hasTeam ? `<div class="tabs"><button class="tab ${buildTab === "team" ? "on" : ""}" data-tab="team">Vs dit team</button><button class="tab ${buildTab === "std" ? "on" : ""}" data-tab="std">Standaard</button></div>` : "";
  const core = buildTab === "team" && hasTeam ? s.teamBuild.build : s.items.core;
  const opts = s.items.options;
  const optRow = (k, label) => opts?.[k]?.length ? row(label, opts[k].slice(0, 4).map((o) => `<div class="item"><img src="${s.items.itemUrl}${o.id}.png" title="${esc(s.items.names[o.id] || o.id)} · ${o.wr}% (${o.games})" alt="" /><span class="g">${o.wr}%</span></div>`).join("")) : "";
  it.innerHTML = "<h2>Items <small>twee sets in de winkel: standaard en vs team</small></h2>" + tabs
    + row("Start", s.items.starters.map((id) => item(id)).join(""))
    + row(buildTab === "team" && hasTeam ? "Build vs dit team" : "Build in volgorde", core.map((id, i) => item(id, i + 1, true)).join('<span class="arrow">›</span>'))
    + (buildTab === "team" && hasTeam && s.teamBuild.defensive?.length ? row("Defensief als het misgaat", s.teamBuild.defensive.map((id) => item(id)).join("")) : "")
    + row(s.enemy ? `Tegen ${esc(s.enemy.name)} eerst overwegen` : "Situationeel", s.items.situational.map((id) => item(id)).join(""))
    + optRow(4, "4e item: meest gewonnen") + optRow(5, "5e item") + optRow(6, "6e item")
    + (s.items.builds?.length ? `<div class="ilabel">Meest gespeelde volledige builds</div>` + s.items.builds.slice(0, 3).map((b) => `<div class="build">${b.items.map((id) => item(id)).join("")}<span class="stat"><b>${b.wr}%</b> · ${b.picks} games</span></div>`).join("") : "");
  it.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => { buildTab = t.dataset.tab; renderItems(s); }));
}

function renderSpells(s) {
  const el = $("#spells");
  const show = s.spells || s.skills;
  el.classList.toggle("hidden", !show);
  if (!show) return;
  const sp = s.spells ? s.spells.ids.map((id, i) => `<img src="${s.spells.imgs[i]}" title="${esc(s.spells.names[i])}" alt="" />`).join("") + `<span class="wr">${esc(s.spells.names.join(" + "))}</span>` : "";
  const sk = s.skills ? `<span class="prio">${esc(s.skills.priority.split("").join(" › "))}</span><div class="skills">${s.skills.order.map((k, i) => `<span class="skill ${k}" title="level ${i + 1}">${k}</span>`).join("")}</div>` : "";
  el.innerHTML = `<h2>Spells &amp; skill order <small>u.gg</small></h2><div class="spellrow"><div class="spells">${sp}</div>${sk}</div>`;
}

function renderGuide(s) {
  const g = $("#guide");
  if (!s.guide) { g.innerHTML = ""; return; }
  g.innerHTML = "<h2>Guide</h2><div class='head'>" + s.guide.headline.map((h, i) => `<div class="${i ? "h2" : "h1"}">${esc(h)}</div>`).join("") + "</div>"
    + "<div class='gcards'>" + s.guide.sections.map((sec) => `<div class="gcard ${/data|team/i.test(sec.title) ? "data" : ""}"><h3>${esc(sec.title)}</h3><ul>${sec.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`).join("") + "</div>";
}

function renderPostgame(s) {
  const p = $("#postgame");
  const show = !!s.postgame && !s.me;
  p.classList.toggle("hidden", !show);
  if (!show) return;
  const g = s.postgame;
  p.innerHTML = `<h2>Vorige game <small>${esc(g.champ || "")}</small></h2>
    <div class="pg"><span class="${g.win ? "win" : "loss"}">${g.win ? "WIN" : "LOSS"}</span>
      <div class="stat"><b>${esc(g.kda)}</b><span>KDA</span></div><div class="stat"><b>${g.csm}</b><span>CS/min</span></div><div class="stat"><b>${g.cs}</b><span>CS</span></div><div class="stat"><b>${g.vision}</b><span>Vision</span></div><div class="stat"><b>${g.mins}</b><span>min</span></div></div>
    <ul class="pgtips">${g.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
}

function render(s) {
  const st = $("#status");
  const phase = { ChampSelect: "champ select", InProgress: "in game", Lobby: "lobby", Matchmaking: "zoeken naar game", ReadyCheck: "accepteren!", EndOfGame: "einde game", PreEndOfGame: "einde game", None: "" }[s.phase] ?? s.phase ?? "";
  st.querySelector(".txt").textContent = s.client === "verbonden" ? `Verbonden${phase ? " · " + phase : ""} · ${s.profiles?.[s.settings.profile]?.name || ""}` : "Client zoeken…";
  st.className = "status" + (s.client === "verbonden" ? " on" : "");
  for (const id of ["profile", "tier", "runeChoice"]) $("#" + id).value = s.settings[id];
  for (const id of ["autoRunes", "autoItems", "autoSpells", "autoAccept", "alwaysOnTop"]) $("#" + id).checked = !!s.settings[id];
  renderHero(s); renderBans(s); renderPostgame(s);
  $("#content").classList.toggle("hidden", !s.me);
  renderTeam(s); renderRunes(s); renderItems(s); renderSpells(s); renderGuide(s);
  $("#log pre").textContent = (s.log || []).join("\n");
}

for (const id of ["profile", "tier", "runeChoice"]) $("#" + id).addEventListener("change", (e) => api.setSettings({ [id]: e.target.value }));
for (const id of ["autoRunes", "autoItems", "autoSpells", "autoAccept", "alwaysOnTop"]) $("#" + id).addEventListener("change", (e) => api.setSettings({ [id]: e.target.checked }));
$("#reapply").addEventListener("click", () => api.reapply());
$("#toggleSettings").addEventListener("click", (e) => { e.stopPropagation(); $("#settings").classList.toggle("hidden"); });
document.addEventListener("click", (e) => { if (!e.target.closest("#settings")) $("#settings").classList.add("hidden"); });

api.onState(render);
api.getState().then(render);
