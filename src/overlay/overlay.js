// Overlay in de game: klein paneel, klik-door, alleen lezen.
const el = document.getElementById("panel");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nl = (x) => String(x).replace(".", ",");
const signed = (x) => `${x > 0 ? "+" : ""}${nl(x)}k`;

function render(d) {
  if (!d) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const img = (id) => (d.itemUrl ? `<img src="${esc(d.itemUrl)}${id}.png" alt="">` : "");
  const champImg = (f) => (d.champUrl && f ? `<img src="${esc(d.champUrl)}${esc(f)}" alt="">` : "");
  const parts = [];
  parts.push(`<div class="head"><span>LoL Tool · ${esc(d.champ)}</span><span>${esc(d.time)}</span></div>`);

  const g = d.goals;
  const chip = (okv, text) => `<span class="chip ${okv == null ? "" : okv ? "ok" : "bad"}">${text}</span>`;
  parts.push(`<div class="chips">
    ${chip(g.csmOk, `CS ${nl(g.csm)}/min`)}
    ${chip(g.deathsOk, `${g.deaths} deaths`)}
    ${g.kp != null ? chip(g.kpOk, `KP ${g.kp}%`) : ""}
    ${g.vpm != null ? chip(g.vpmOk, `vision ${nl(g.vpm)}/min`) : ""}
    ${g.ward ? "" : `<span class="chip bad">geen control ward</span>`}
  </div>`);

  // Meldingen (power spikes, tilt, control ward) staan altijd bovenaan, ook in compact.
  for (const a of d.alerts || []) parts.push(`<div class="alert ${esc(a.cls)}">${esc(a.text)}</div>`);

  if (!d.compact) {
    if (d.duo) {
      const u = d.duo;
      const diff = u.diff != null ? ` <span class="${u.diff >= 0 ? "ok" : "bad"}">${signed(u.diff)}</span>` : "";
      parts.push(`<div class="sect">Duo</div><div class="row">${champImg(u.img)}<span><b>${esc(u.name)}</b> ${esc(u.champ)} · lvl ${u.level} · ${esc(u.kda)}${u.dead ? ` <span class="warn">dood ${u.secs}s</span>` : diff}</span></div>`);
      if (u.advice) parts.push(`<div class="tip ${esc(u.cls)}">${esc(u.advice)}</div>`);
    }
    if (d.opp) {
      const o = d.opp;
      const sgn = (x) => `${x > 0 ? "+" : ""}${x}`;
      parts.push(`<div class="sect">Jouw tegenstander</div>`);
      parts.push(`<div class="row">${champImg(o.img)}<span><b>${esc(o.name)}</b> lvl ${o.level} · ${esc(o.kda)} · ${o.cs} cs${o.dead ? ` <span class="warn">dood</span>` : ""}</span></div>`);
      const lvl = `<span class="${o.levelDiff >= 0 ? "ok" : "bad"}">${o.levelDiff === 0 ? "gelijk level" : `${sgn(o.levelDiff)} level`}</span>`;
      const cs = `<span class="${o.csDiff >= 0 ? "ok" : "bad"}">${sgn(o.csDiff)} cs</span>`;
      const gold = d.lane ? `<span class="${d.lane.diff >= 0 ? "ok" : "bad"}">${signed(d.lane.diff)} items</span>` : "";
      parts.push(`<div class="row muted">Jij: ${lvl} · ${cs}${gold ? " · " + gold : ""}</div>`);
      if (o.items.length) parts.push(`<div class="row items">${o.items.map((id) => `<span class="${o.big.includes(id) ? "big" : ""}">${img(id)}</span>`).join("")}</div>`);
      for (const w of o.warn) parts.push(`<div class="tip warn">${esc(w)}</div>`);
      if (o.counter) parts.push(`<div class="row">${img(o.counter.id)}<span>${esc(o.counter.text)}</span></div>`);
      if (o.tip) parts.push(`<div class="tip">${esc(o.tip)}</div>`);
    } else if (d.lane) parts.push(`<div class="row muted">Jij vs ${esc(d.lane.name)} (lvl ${d.lane.level}): <span class="${d.lane.diff >= 0 ? "ok" : "bad"}">&nbsp;${signed(d.lane.diff)} items</span></div>`);
    if (d.enemyTeam?.length) {
      parts.push(`<div class="sect">Hun team</div><div class="team">${d.enemyTeam.map((e) => `<span class="mate ${e.dead ? "dead" : ""} ${e.fed ? "fed" : ""} ${e.me ? "mine" : ""}" title="${esc(e.name)}">${champImg(e.img)}<i>${e.dead ? e.secs + "s" : e.level}</i><small>${esc(e.kda)}</small></span>`).join("")}</div>`);
    }
    if (d.next) {
      parts.push(`<div class="row">${img(d.next.id)}<span>Volgende: <b>${esc(d.next.name)}</b> ${d.next.missing ? `<span class="muted">nog ${d.next.missing} goud</span>` : `<span class="ok">kopen kan!</span>`}</span></div>`);
    }
    if (d.threat) {
      const t = d.threat;
      if (t.name !== d.opp?.name) parts.push(`<div class="row">${champImg(t.img)}<span class="warn">${esc(t.name)} is fed (${esc(t.kda)}${t.lead > 0 ? `, ${nl(t.lead)}k goud voor op jou` : ""})</span></div>`);
      if (t.item) parts.push(`<div class="row">${img(t.item.id)}<span>Tegen ${t.name === d.opp?.name ? "zijn damage" : "hem"}: <b>${esc(t.item.name)}</b> <span class="muted">(${esc(t.why)})</span></span></div>`);
    }
    if (d.dead?.length >= 2) parts.push(`<div class="row"><span class="soon">${d.dead.length} van hen dood → objective/push!</span></div>`);
    if (d.timers?.length) {
      parts.push(`<div class="row"><span>${d.timers.map((x) => `${esc(x.label)} <span class="${x.soon ? "soon" : ""}">${esc(x.left)}</span>`).join(" · ")}</span></div>`);
    }
    for (const c of d.coach || []) parts.push(`<div class="tip">${esc(c)}</div>`);
  }
  el.innerHTML = parts.join("");
}

window.lolTool.onLive(render);
