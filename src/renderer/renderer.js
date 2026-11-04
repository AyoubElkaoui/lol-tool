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
        ${record(s, s.me) ? `<span class="wr">Jij met ${esc(s.me.name)}: <b>${record(s, s.me)}</b> in je recente games</span>` : ""}
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
  const show = s.phase === "ChampSelect" && s.bans && (s.inBan || !s.me);
  b.classList.toggle("hidden", !show);
  if (!show) return;
  const list = s.bans.list || [];
  b.innerHTML = `<h2>Ban-advies <small>${esc(LANE_NL[s.bans.lane] || s.bans.lane)} · jouw pool: ${s.bans.pool.join(", ")} · tier ${esc(s.settings.tier)}</small></h2>
    <div class="banlist">${list.map((x, i) => `<div class="ban" data-hover="ban" data-champ="${x.cid}" title="Klik om ${esc(x.champ?.name)} als ban te hoveren"><img src="${icon(s, x.champ)}" alt="" /><div><b>${i + 1}. ${esc(x.champ?.name)}</b><small>${esc(x.parts.join(" · "))}</small></div></div>`).join("") || "<span class='wr'>Geen data</span>"}</div>
    ${s.bans.hovers?.length ? `<div class="hovers">Zij hoveren: ${s.bans.hovers.map((c) => `<img src="${icon(s, c)}" title="${esc(c.name)}" alt="" /> ${esc(c.name)}`).join(" ")}</div>` : ""}`;
}

const wrLevel = (wr) => (wr == null ? "" : wr >= 53 ? "GOED" : wr >= 50 ? "OK" : wr >= 47 ? "LASTIG" : "MOEILIJK");
const pct = (x) => `${Number(x).toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const record = (s, c) => { const r = c && s.myStats?.[c.id]; return r ? `${r.wins}W ${r.games - r.wins}L` : ""; };

function pickRow(s, r, top) {
  const facts = r.taken ? ["al weg"] : r.wr == null ? ["te weinig data"] : [`${Number(r.n).toLocaleString("nl-NL")} games`];
  const rec = record(s, r.champ);
  if (rec) facts.push(`jij: ${rec}`);
  if (r.favorite) facts.push("voorkeur bij twijfel");
  const vs = r.vs?.length ? `<small class="worst">${r.vs.map((v) => `${v.laner ? "<b>" : ""}${esc(v.name)} ${pct(v.wr)}${v.laner ? "</b>" : ""}`).join(" · ")}</small>` : "";
  const worst = r.worst?.length ? `<small class="worst">Zwak tegen ${r.worst.map((w) => `${esc(w.name)} ${pct(w.wr)}`).join(", ")}</small>` : "";
  const hover = r.taken ? "" : `data-hover="pick" data-champ="${r.champ.id}" title="Klik om ${esc(r.champ.name)} te hoveren"`;
  return `<div class="pick ${r.taken ? "gone" : ""} ${top ? "top" : ""}" ${hover}><img src="${icon(s, r.champ)}" alt="" />
    <div class="pinfo"><b>${esc(r.champ.name)}${top ? `<span class="tag">Aanrader</span>` : ""}</b><small>${esc(facts.join(" · "))}</small>${vs}${worst}</div>
    ${r.wr != null && !r.taken ? `<span class="pwr ${wrLevel(r.wr)}">${pct(r.wr)}</span>` : ""}</div>`;
}

function renderPicks(s) {
  const el = $("#picks");
  const p = s.picks;
  const show = s.phase === "ChampSelect" && p && !s.locked;
  el.classList.toggle("hidden", !show);
  if (!show) return;
  const topIdx = p.pool.findIndex((r) => !r.taken && r.wr != null);
  const pool = p.pool.map((r, i) => pickRow(s, r, i === topIdx)).join("");
  if (p.mode === "blind") {
    el.innerHTML = `<h2>Blind pick <small>${esc(LANE_NL[p.lane] || p.lane)} · nog geen tegenstander · verwachte winrate over alle matchups</small></h2><div class="picklist">${pool}</div>`;
    return;
  }
  const team = p.enemies?.length > 1 || (p.enemies?.length && !p.enemy);
  const sub = team
    ? `tegen hun team (${p.enemies.length}/5)${p.enemy ? ` · ${esc(p.enemy.name)} in jouw lane telt dubbel` : ""} · ${esc(LANE_NL[p.lane] || p.lane)}`
    : `tegen ${esc(p.enemy.name)} · ${esc(LANE_NL[p.lane] || p.lane)} · jouw winrate in de matchup`;
  const best = p.enemy ? `<div><div class="ilabel">Beste in deze lane tegen ${esc(p.enemy.name)}</div><div class="picklist">${p.best.map((r) => pickRow(s, r)).join("") || "<span class='wr'>Te weinig data</span>"}</div></div>` : "";
  el.innerHTML = `<h2>Counter picks <small>${sub}</small></h2>
    <div class="pickcols"><div><div class="ilabel">Jouw pool</div><div class="picklist">${pool}</div></div>${best}</div>`;
}

function renderData(s) {
  const d = s.data;
  const el = $("#datapill");
  el.classList.toggle("hidden", !d);
  if (d) {
    const tier = { bronze: "Bronze", silver: "Silver", gold_plus: "Gold+", emerald_plus: "Emerald+" }[d.tier] || d.tier;
    const fresh = d.patch === d.latest;
    el.textContent = `${d.patch === "30" ? "Laatste 30 dagen" : "Patch " + d.patch} · ${tier}`;
    el.classList.toggle("old", !fresh);
    el.title = fresh ? "Nieuwste patch" : `Patch ${d.latest} heeft nog te weinig games in deze tier; de tool schakelt vanzelf over zodra er genoeg zijn.`;
  }
  const u = $("#update");
  u.classList.toggle("hidden", !s.update);
  if (s.update) { u.href = s.update.url; u.textContent = `Nieuwe versie ${s.update.version} beschikbaar: klik om te downloaden`; }
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
  const activeIdx = s.runeIdx ?? (s.settings.runeChoice === "win" && s.runes.pages[1] ? 1 : 0);
  const perk = (id, key) => { const i = s.runes.perkInfo[id]; return i ? `<img class="${key ? "key" : ""}" src="${DD}/cdn/img/${i.icon}" title="${esc(i.name)}" alt="${esc(i.name)}" />` : ""; };
  const treeName = (id) => { const i = s.runes.perkInfo[id]; const st = i && s.runes.perkInfo[i.style]; return st ? `<img src="${DD}/cdn/img/${st.icon}" alt="" />${esc(st.name)}` : ""; };
  const many = s.runes.pages.length > 1;
  r.innerHTML = `<h2>Runes <small>in de client als “LoLTool …”${many ? " · klik om te wisselen" : ""}</small></h2>` + s.runes.pages.map((p, i) => `
    <div class="runepage ${i === activeIdx ? "active" : many ? "choosable" : ""}" ${i !== activeIdx ? `data-rune="${i}" title="Klik om deze page in de client te zetten"` : ""}>
      <div class="ph"><b>${p.vs ? `<span class="tag">matchup</span> ` : ""}${esc(p.label)}${i === activeIdx ? " · actief" : many ? " · klik om te kiezen" : ""}</b><span>${p.team ? esc(p.note || "aangepast op hun team") : p.wr != null ? `${p.wr}% · ${Number(p.n).toLocaleString("nl-NL")} games` : ""}</span></div>
      <div class="trees">
        <div class="tree"><div class="tname">${treeName(p.pri[0])}</div><div class="perks">${perk(p.pri[0], true)}${p.pri.slice(1).map((id) => perk(id)).join("")}</div></div>
        <div class="tree"><div class="tname">${treeName(p.sec[0])}</div><div class="perks">${p.sec.map((id) => perk(id)).join("")}</div></div>
      </div>
      <div class="shards">${p.mod.map((id) => `<span class="shard">${esc(s.runes.shards[id] || id)}</span>`).join("")}</div>
    </div>`).join("");
  r.querySelectorAll("[data-rune]").forEach((el) => el.addEventListener("click", () => api.chooseRunes(Number(el.dataset.rune))));
}

function renderItems(s) {
  const it = $("#items");
  if (!s.items) { it.innerHTML = "<h2>Items</h2><div class='wr'>—</div>"; return; }
  const gold = (id) => s.items.gold?.[id] ? `<span class="g">${s.items.gold[id]}</span>` : "";
  const why = buildTab === "team" && s.teamBuild?.why || {};
  const item = (id, n, core) => `<div class="item ${core ? "core" : ""} ${why[id] ? "counter" : ""}"><img src="${s.items.itemUrl}${id}.png" title="${esc(s.items.names[id] || id)}${why[id] ? " · tegen " + esc(why[id]) : ""}" alt="" />${n ? `<span class="n">${n}</span>` : ""}${gold(id)}</div>`;
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
    + (buildTab === "team" && hasTeam && Object.keys(why).length ? `<ul class="teamnotes">${Object.entries(why).map(([id, w]) => `<li><b>${esc(s.items.names[id] || id)}</b> tegen ${esc(w)}</li>`).join("")}</ul>` : "")
    + (buildTab === "team" && hasTeam && s.teamBuild.defensive?.length ? row("Defensief als het misgaat", s.teamBuild.defensive.map((id) => item(id)).join("")) : "")
    + row(s.enemy ? `Tegen ${esc(s.enemy.name)} eerst overwegen` : "Situationeel", s.items.situational.map((id) => item(id)).join(""))
    + optRow(4, "4e item: meest gewonnen") + optRow(5, "5e item") + optRow(6, "6e item")
    + (s.items.builds?.length ? `<div class="ilabel">Meest gespeelde volledige builds · klik om te kiezen</div>` + s.items.builds.slice(0, 3).map((b, i) => {
      const on = (s.items.buildIdx ?? 0) === i;
      return `<div class="build choosable ${on ? "on" : ""}" data-build="${i}" title="${on ? "Gekozen build" : "Klik om deze build als item set te zetten"}">${b.items.map((id) => item(id)).join("")}<span class="stat">${on ? "✓ gekozen · " : ""}<b>${b.wr}%</b> · ${b.picks} games</span></div>`;
    }).join("") : "");
  it.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => { buildTab = t.dataset.tab; renderItems(s); }));
  it.querySelectorAll("[data-build]").forEach((el) => el.addEventListener("click", () => {
    const i = Number(el.dataset.build);
    if (i !== (s.items.buildIdx ?? 0)) { buildTab = "std"; api.chooseBuild(i === 0 ? null : i); }
  }));
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
  for (const id of ["profile", "tier", "runeChoice", "flashKey"]) $("#" + id).value = s.settings[id];
  for (const id of ["autoRunes", "autoItems", "autoSpells", "autoHover", "autoAccept", "alwaysOnTop"]) $("#" + id).checked = !!s.settings[id];
  renderData(s); renderHero(s); renderBans(s); renderPicks(s); renderPostgame(s);
  $("#content").classList.toggle("hidden", !s.me);
  renderTeam(s); renderRunes(s); renderItems(s); renderSpells(s); renderGuide(s);
  $("#log pre").textContent = (s.log || []).join("\n");
}

for (const id of ["profile", "tier", "runeChoice", "flashKey"]) $("#" + id).addEventListener("change", (e) => api.setSettings({ [id]: e.target.value }));
for (const id of ["autoRunes", "autoItems", "autoSpells", "autoHover", "autoAccept", "alwaysOnTop"]) $("#" + id).addEventListener("change", (e) => api.setSettings({ [id]: e.target.checked }));
$("#reapply").addEventListener("click", () => api.reapply());
document.addEventListener("click", (e) => { const el = e.target.closest("[data-hover]"); if (el) api.hover(el.dataset.hover, Number(el.dataset.champ)); });
$("#toggleSettings").addEventListener("click", (e) => { e.stopPropagation(); $("#settings").classList.toggle("hidden"); });
document.addEventListener("click", (e) => { if (!e.target.closest("#settings")) $("#settings").classList.add("hidden"); });

api.onState(render);
api.getState().then(render);
