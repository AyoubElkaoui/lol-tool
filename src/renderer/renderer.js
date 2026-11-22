const $ = (s) => document.querySelector(s);
const DD = "https://ddragon.leagueoflegends.com";
const api = window.lolTool || window.lolToolMock; // mock.js vult lolToolMock als we niet in Electron draaien

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LANE_NL = { top: "Top", jungle: "Jungle", middle: "Mid", bottom: "Bot", support: "Support" };
const splash = (c) => `${DD}/cdn/img/champion/splash/${c.slug}_0.jpg`;
const icon = (s, c) => (s.champUrl && c ? s.champUrl + c.image : "");
let buildTab = "team";

// Tegenstander in jouw lane zelf aanklikken als de tool het niet (goed) weet.
function enemyChooser(s) {
  const list = s.theirTeam || [];
  if (!list.length) return "";
  const cur = s.enemy?.id ?? s.picks?.enemy?.id;
  const manual = !!s.manualEnemyId;
  const label = manual ? "zelf gekozen" : cur ? "geschat door de tool · klopt het niet? klik de juiste" : "niet zeker · klik wie in jouw lane staat";
  return `<div class="chooser"><span class="ilabel">Tegenstander in jouw lane <small>${label}</small></span><div class="echoices">`
    + list.map((c) => `<button class="echoice ${c.id === cur ? "on" : ""}" data-enemy="${c.id}" title="${esc(c.name)} als tegenstander kiezen"><img src="${icon(s, c)}" alt="" />${esc(c.name)}</button>`).join("")
    + (manual ? `<button class="echoice auto" data-enemy="0" title="Laat de tool weer zelf kiezen">↺ Automatisch</button>` : "")
    + "</div></div>";
}

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
        ${s.enemy ? `<span class="vs">VS</span><div class="champ enemy"><img src="${icon(s, s.enemy)}" alt="" /><div><div class="name">${esc(s.enemy.name)}</div><div class="lane">tegenstander${s.manualEnemyId ? " · zelf gekozen" : ""}</div></div></div>` : `<span class="wr">${s.enemies.length ? "Nog geen tegenstander in jouw lane gezien" : "Tegenstander nog niet gelockt"}</span>`}
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
  b.innerHTML = `<h2>Ban-advies <small>${esc(LANE_NL[s.bans.lane] || s.bans.lane)} · jouw pool: ${s.bans.pool.join(", ")} · tier ${esc(s.data?.tier || s.settings.tier)}</small></h2>
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
  if (r.compWhy) facts.push(`past bij hun team: ${r.compWhy}`);
  else if (r.favorite && r.pick) facts.push("main");
  else if (r.favorite) facts.push("voorkeur bij twijfel");
  if (r.backup) facts.push("backup");
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
  const picked = p.pool.findIndex((r) => r.pick && !r.taken);
  const topIdx = picked >= 0 ? picked : p.pool.findIndex((r) => !r.taken && r.wr != null);
  const pool = p.pool.map((r, i) => pickRow(s, r, i === topIdx)).join("");
  if (p.mode === "blind") {
    el.innerHTML = `<h2>Blind pick <small>${esc(LANE_NL[p.lane] || p.lane)} · nog geen tegenstander · verwachte winrate over alle matchups</small></h2>${enemyChooser(s)}<div class="picklist">${pool}</div>`;
    return;
  }
  const team = p.enemies?.length > 1 || (p.enemies?.length && !p.enemy);
  const sub = team
    ? `tegen hun team (${p.enemies.length}/5)${p.enemy ? ` · ${esc(p.enemy.name)} in jouw lane telt dubbel` : ""} · ${esc(LANE_NL[p.lane] || p.lane)}`
    : `tegen ${esc(p.enemy.name)} · ${esc(LANE_NL[p.lane] || p.lane)} · jouw winrate in de matchup`;
  const best = p.enemy ? `<div><div class="ilabel">Beste in deze lane tegen ${esc(p.enemy.name)}</div><div class="picklist">${p.best.map((r) => pickRow(s, r)).join("") || "<span class='wr'>Te weinig data</span>"}</div></div>` : "";
  el.innerHTML = `<h2>Counter picks <small>${sub}</small></h2>${enemyChooser(s)}
    <div class="pickcols"><div><div class="ilabel">Jouw pool</div><div class="picklist">${pool}</div></div>${best}</div>`;
}

function renderData(s) {
  const d = s.data;
  const el = $("#datapill");
  el.classList.toggle("hidden", !d);
  if (d) {
    const tier = { bronze: "Bronze", silver: "Silver", gold_plus: "Gold+", emerald_plus: "Emerald+" }[d.tier] || d.tier;
    const fresh = d.patch === d.latest;
    el.textContent = `${d.patch === "30" ? "Laatste 30 dagen" : "Patch " + d.patch} · ${tier}${d.auto ? " (auto)" : ""}`;
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
    ${enemyChooser(s)}
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
    + row(buildTab === "team" && hasTeam ? "Build vs dit team" : s.items.style && s.items.buildIdx == null ? `${esc(s.items.style.label)}-build <small>(${esc(s.items.style.why)} · ${s.items.style.picks} games)</small>` : s.items.vs && s.items.buildIdx == null ? `Build tegen ${esc(s.items.vs.name)} <small>(${s.items.vs.n} games)</small>` : "Build in volgorde", core.map((id, i) => item(id, i + 1, true)).join('<span class="arrow">›</span>'))
    + (buildTab === "team" && hasTeam && Object.keys(why).length ? `<ul class="teamnotes">${Object.entries(why).map(([id, w]) => `<li><b>${esc(s.items.names[id] || id)}</b> tegen ${esc(w)}</li>`).join("")}</ul>` : "")
    + (buildTab === "team" && hasTeam && s.teamBuild.defensive?.length ? row("Defensief als het misgaat", s.teamBuild.defensive.map((id) => item(id)).join("")) : "")
    + row(s.enemy ? `Tegen ${esc(s.enemy.name)} eerst overwegen` : "Situationeel", s.items.situational.map((id) => item(id)).join(""))
    + optRow(4, s.items.vs ? `4e item tegen ${esc(s.items.vs.name)}` : "4e item: meest gewonnen") + optRow(5, "5e item") + optRow(6, "6e item")
    + (s.items.builds?.length ? `<div class="ilabel">Meest gespeelde volledige builds · klik om te kiezen</div>` + s.items.builds.slice(0, 5).map((b, i) => {
      const on = (s.items.buildIdx ?? (s.items.style ? s.items.style.idx : s.items.vs ? -1 : 0)) === i;
      return `<div class="build choosable ${on ? "on" : ""}" data-build="${i}" title="${on ? "Gekozen build" : "Klik om deze build als item set te zetten"}">${b.items.map((id) => item(id)).join("")}<span class="stat">${b.label ? `<b>${esc(b.label)}</b> · ` : ""}${on ? "✓ gekozen · " : ""}<b>${b.wr}%</b> · ${b.picks} games</span></div>`;
    }).join("") : "");
  it.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => { buildTab = t.dataset.tab; renderItems(s); }));
  it.querySelectorAll("[data-build]").forEach((el) => el.addEventListener("click", () => {
    const i = Number(el.dataset.build);
    if (i !== (s.items.buildIdx ?? (s.items.style ? s.items.style.idx : s.items.vs ? -1 : 0))) { buildTab = "std"; api.chooseBuild(i === 0 && !s.items.vs && !s.items.style ? null : i); }
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
  const T = s.goals?.targets || GOAL_TARGETS;
  p.innerHTML = `<h2>Vorige game <small>${esc(g.champ || "")}</small></h2>
    <div class="pg"><span class="${g.win ? "win" : "loss"}">${g.win ? "WIN" : "LOSS"}</span>
      <div class="stat"><b>${esc(g.kda)}</b><span>KDA</span></div>
      ${GOAL_KEYS.map((k) => goalStat(k, g[k], T)).join("")}
      <div class="stat"><b>${g.vision}</b><span>Vision</span></div><div class="stat"><b>${g.mins}</b><span>min</span></div></div>
    <ul class="pgtips">${g.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
}

// Werkpunten: deaths, KP, control wards, CS/min. Groen = doel gehaald, rood = eronder.
const GOAL_KEYS = ["deaths", "kp", "cw", "csm"];
const GOAL_TARGETS = {
  deaths: { max: 5, label: "Deaths", unit: "", hint: "onder 5" },
  kp: { min: 55, label: "Kill participation", unit: "%", hint: "55%+" },
  cw: { min: 1, label: "Control wards", unit: "", hint: "1+ per game" },
  csm: { min: 6.5, label: "CS/min", unit: "", hint: "6,5+" },
};
const num = (v) => Number(v).toLocaleString("nl-NL", { maximumFractionDigits: 1 });
const goalOk = (t, v) => (v == null ? null : t.max != null ? v <= t.max : v >= t.min);
function goalStat(k, v, T) {
  const t = T[k], okv = goalOk(t, v);
  return `<div class="stat goal ${okv == null ? "" : okv ? "good" : "bad"}"><b>${v == null ? "?" : num(v) + t.unit}</b><span>${esc(t.label)}</span><small>doel ${esc(t.hint)}</small></div>`;
}

// Wat gaat goed, wat kan beter, wat maakt je wins anders dan je losses, tegen wie lastig.
const nl1 = (v) => Number(v).toLocaleString("nl-NL", { maximumFractionDigits: 1 });
const rec = (o) => `${o.wins}-${o.games - o.wins}`;
function renderAnalysis(a) {
  if (!a) return "";
  const head = `${a.champ ? esc(a.champ) + " · " : ""}${a.games} games · ${a.wins}W ${a.losses}L · laatste ${a.form.games}: ${a.form.wins}W ${a.form.games - a.form.wins}L`;
  const good = a.good.map((x) => `<li>${esc(x.text)}</li>`).join("") || "<li class='none'>Nog niets boven je doel.</li>";
  const bad = a.bad.map((x) => `<li>${esc(x.text)}${x.tip ? `<small>${esc(x.tip)}</small>` : ""}</li>`).join("") || "<li class='none'>Alles op of boven je doel.</li>";
  const dec = a.deciders.length ? `<div class="decide"><h3>Wat je wins anders maakt</h3><table><thead><tr><th></th><th>Wins</th><th>Losses</th></tr></thead><tbody>${a.deciders.map((d) => `<tr><td>${esc(d.label)}</td><td class="good">${nl1(d.wins)}${d.unit}</td><td class="bad">${nl1(d.losses)}${d.unit}</td></tr>`).join("")}</tbody></table></div>` : "";
  const opp = (list) => list.map((o) => `${esc(o.name)} ${rec(o)}`).join(" · ");
  const opps = a.hard.length || a.easy.length ? `<div class="opps">${a.hard.length ? `<span class="bad">Lastig: ${opp(a.hard)}</span>` : ""}${a.easy.length ? `<span class="good">Goed tegen: ${opp(a.easy)}</span>` : ""}</div>` : "";
  return `<div class="analysis"><div class="ahead">${head}</div>
    <div class="pcols"><div class="pcol good"><h3>Goed</h3><ul>${good}</ul></div><div class="pcol bad"><h3>Beter kan</h3><ul>${bad}</ul></div></div>
    ${dec}${opps}</div>`;
}

function renderGoals(s) {
  const el = $("#goals");
  const g = s.goals;
  const show = !!g?.avg?.games && !s.me;
  el.classList.toggle("hidden", !show);
  if (!show) return;
  const T = g.targets || GOAL_TARGETS;
  const wasOpen = !!el.querySelector("details.recent")?.open; // elke state-update tekent opnieuw
  const met = GOAL_KEYS.filter((k) => goalOk(T[k], g.avg[k])).length;
  const rows = (g.recent || []).map((r) => `<tr class="${r.win ? "w" : "l"}"><td>${r.win ? "W" : "L"}</td><td>${esc(r.champ)}</td><td>${esc(r.kda)}</td>${GOAL_KEYS.map((k) => { const okv = goalOk(T[k], r[k]); return `<td class="${okv == null ? "" : okv ? "good" : "bad"}">${r[k] == null ? "?" : num(r[k]) + T[k].unit}</td>`; }).join("")}</tr>`).join("");
  el.innerHTML = `<h2>Jouw doelen <small>gemiddeld over je laatste ${g.avg.games} games · ${met}/4 gehaald</small></h2>
    <div class="pg goals">${GOAL_KEYS.map((k) => goalStat(k, g.avg[k], T)).join("")}</div>
    ${renderAnalysis(g.analysis)}
    ${rows ? `<details class="recent"${wasOpen ? " open" : ""}><summary>Laatste ${g.recent.length} games</summary><table><thead><tr><th></th><th>Champ</th><th>KDA</th>${GOAL_KEYS.map((k) => `<th>${esc(T[k].label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></details>` : ""}`;
}

const SELECTS = ["profile", "tier", "runeChoice", "flashKey", "overlayPos"];
const SWITCHES = ["autoRunes", "autoItems", "autoSpells", "autoHover", "autoBan", "autoLock", "autoAccept", "alwaysOnTop", "overlay", "overlayCompact", "overlayDuo", "overlaySpikes", "overlayCoach"];

// Verliesreeks: na 2 verloren een rustige tip, na 3 op rij een pauze-advies.
function renderTilt(s) {
  const el = $("#tilt");
  const st = s.goals?.streak;
  const n = st?.recent ? st.losses : 0;
  const show = n >= 2 && s.phase !== "InProgress";
  el.classList.toggle("hidden", !show);
  if (!show) return;
  el.className = "tiltbar" + (n >= 3 ? " hard" : "");
  el.innerHTML = n >= 3
    ? `<b>${n} verloren op rij.</b> Neem 15 minuten pauze: drinken, even lopen. Met tilt speel je slechter en verlies je meer LP dan je wint. Daarna: één game, daarna kijken.`
    : `<b>2 verloren op rij.</b> Kort resetten: chat dempen (/mute all), plan per game één ding (bijv. minder deaths), en surrender vroeg als het echt weg is.`;
}

function render(s) {
  lastState = s;
  const st = $("#status");
  const phase = { ChampSelect: "champ select", InProgress: "in game", Lobby: "lobby", Matchmaking: "zoeken naar game", ReadyCheck: "accepteren!", EndOfGame: "einde game", PreEndOfGame: "einde game", None: "" }[s.phase] ?? s.phase ?? "";
  st.querySelector(".txt").textContent = s.client === "verbonden" ? `Verbonden${phase ? " · " + phase : ""} · ${s.profiles?.[s.settings.profile]?.name || ""}` : "Client zoeken…";
  st.className = "status" + (s.client === "verbonden" ? " on" : "");
  for (const id of SELECTS) $("#" + id).value = s.settings[id];
  for (const id of SWITCHES) $("#" + id).checked = !!s.settings[id];
  // Tekstvelden niet overschrijven terwijl je typt.
  const pr = s.profiles?.[s.settings.profile];
  if (pr) {
    const set = (id, v) => { const el = $("#" + id); if (document.activeElement !== el) el.value = v; };
    set("poolText", (pr.poolNames || []).join(", "));
    set("backupsText", (pr.backupNames || []).join(", "));
    set("duoName", pr.duo?.riotName || "");
  }
  renderTilt(s);
  renderData(s); renderHero(s); renderBans(s); renderPicks(s); renderPostgame(s); renderGoals(s);
  $("#content").classList.toggle("hidden", !s.me);
  renderTeam(s); renderRunes(s); renderItems(s); renderSpells(s); renderGuide(s);
  $("#log pre").textContent = (s.log || []).join("\n");
}

for (const id of SELECTS) $("#" + id).addEventListener("change", (e) => api.setSettings({ [id]: e.target.value }));
for (const id of SWITCHES) $("#" + id).addEventListener("change", (e) => api.setSettings({ [id]: e.target.checked }));
let lastState = null;
const savePool = async () => {
  if (!lastState || !api.setPool) return;
  const r = await api.setPool({ profile: lastState.settings.profile, pool: $("#poolText").value, backups: $("#backupsText").value });
  $("#poolMsg").textContent = r?.unknown?.length ? `Niet gevonden: ${r.unknown.join(", ")}. Schrijf de naam zoals in League (bv. Kha'Zix, Nidalee).` : "Opgeslagen. Leeg laten = standaard van het profiel.";
};
$("#poolText").addEventListener("change", savePool);
$("#backupsText").addEventListener("change", savePool);
$("#duoName").addEventListener("change", (e) => lastState && api.setDuo?.({ profile: lastState.settings.profile, name: e.target.value }));
$("#reapply").addEventListener("click", () => api.reapply());
document.addEventListener("click", (e) => { const el = e.target.closest("[data-enemy]"); if (el) api.setEnemy(Number(el.dataset.enemy)); });
document.addEventListener("click", (e) => { const el = e.target.closest("[data-hover]"); if (el) api.hover(el.dataset.hover, Number(el.dataset.champ)); });
$("#toggleSettings").addEventListener("click", (e) => { e.stopPropagation(); $("#settings").classList.toggle("hidden"); });
document.addEventListener("click", (e) => { if (!e.target.closest("#settings")) $("#settings").classList.add("hidden"); });

api.onState(render);
api.getState().then(render);
