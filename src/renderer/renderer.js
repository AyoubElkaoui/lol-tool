const $ = (s) => document.querySelector(s);
const DD = "https://ddragon.leagueoflegends.com";

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function render(s) {
  const st = $("#status");
  const phase = s.phase && s.phase !== "None" ? ` · ${s.phase}` : "";
  st.textContent = s.client === "verbonden" ? `Verbonden met League-client${phase}` : "Client zoeken… (start League of Legends)";
  st.className = "status" + (s.client === "verbonden" ? " on" : "");

  $("#tier").value = s.settings.tier; $("#runeChoice").value = s.settings.runeChoice;
  $("#autoRunes").checked = !!s.settings.autoRunes; $("#autoItems").checked = !!s.settings.autoItems;

  const m = $("#matchup");
  if (s.me) {
    const champImg = (c) => `${DD}/cdn/${s.ddVersion || "latest"}/img/champion/${c.image}`;
    m.innerHTML = `<div class="matchup">
      <img src="${s.champUrl ? s.champUrl + s.me.image : ""}" alt="" onerror="this.style.visibility='hidden'" />
      <div><div class="title">${esc(s.me.name)} <span class="sub">${esc(s.lane || "")}</span>${s.guide?.level ? `<span class="badge ${s.guide.level}">${s.guide.level}</span>` : ""}</div>
      <div class="sub">${s.enemy ? "tegen " + esc(s.enemy.name) : s.enemies.length ? "tegenstanders: " + s.enemies.map((e) => esc(e.name)).join(", ") : "tegenstander nog niet bekend"}</div>
      <div class="applied">${s.applied.runes ? "✓ runes: " + esc(s.applied.runes) : ""} ${s.applied.items ? " ✓ items: " + esc(s.applied.items) : ""}</div></div>
      ${s.enemy ? `<span class="vs">VS</span><img src="${s.champUrl ? s.champUrl + s.enemy.image : ""}" alt="" onerror="this.style.visibility='hidden'" />` : ""}
    </div>`;
  }

  const r = $("#runes");
  if (s.runes) {
    r.innerHTML = "<h2>Runes</h2>" + s.runes.pages.map((p) => {
      const ic = (id) => { const i = s.runes.perkInfo[id]; return i ? `<img src="${DD}/cdn/img/${i.icon}" title="${esc(i.name)}" />` : ""; };
      const shards = p.mod.map((id) => s.runes.shards[id] || id).join(" · ");
      return `<div class="runepage"><div class="label">${esc(p.label)} — ${p.wr}% (${p.n.toLocaleString("nl-NL")} games)</div>
        <div class="runerow"><span class="key">${ic(p.pri[0])}</span>${p.pri.slice(1).map(ic).join("")}<span style="width:10px"></span>${p.sec.map(ic).join("")}</div>
        <div class="shards">${esc(shards)}</div></div>`;
    }).join("");
  }

  const it = $("#items");
  if (s.items) {
    const img = (id) => `<img src="${s.items.itemUrl}${id}.png" title="${esc(s.items.names[id] || id)}" />`;
    const row = (label, ids, arrows) => ids.length ? `<div class="itemlabel">${label}</div><div class="itemrow">${ids.map(img).join(arrows ? '<span class="arrow">→</span>' : "")}</div>` : "";
    it.innerHTML = "<h2>Items</h2>" + row("Eerste item (keuzes)", s.items.starters) + row("Build (in volgorde)", s.items.core, true) + row("Situationeel", s.items.situational)
      + (s.items.builds?.length ? `<div class="itemlabel">Meest gespeelde volledige builds</div>` + s.items.builds.slice(0, 4).map((b) => `<div class="itemrow">${b.items.map(img).join("")}<span class="itemlabel">${b.wr}% · ${b.picks}</span></div>`).join("") : "");
  }

  const g = $("#guide");
  if (s.guide) {
    g.innerHTML = "<h2>Guide</h2><div class='guide'>" + s.guide.headline.map((h) => `<div class="headline">${esc(h)}</div>`).join("")
      + s.guide.sections.map((sec) => `<h3>${esc(sec.title)}</h3><ul>${sec.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`).join("") + "</div>";
  }

  $("#log pre").textContent = s.log.join("\n");
}

for (const id of ["tier", "runeChoice"]) $("#" + id).addEventListener("change", (e) => window.lolTool.setSettings({ [id]: e.target.value }));
for (const id of ["autoRunes", "autoItems"]) $("#" + id).addEventListener("change", (e) => window.lolTool.setSettings({ [id]: e.target.checked }));
$("#reapply").addEventListener("click", () => window.lolTool.reapply());

window.lolTool.onState(render);
window.lolTool.getState().then(render);
