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
    if (d.lane) parts.push(`<div class="row muted">Jij vs ${esc(d.lane.name)} (lvl ${d.lane.level}): <span class="${d.lane.diff >= 0 ? "ok" : "bad"}">&nbsp;${signed(d.lane.diff)} items</span></div>`);
    if (d.next) {
      parts.push(`<div class="row">${img(d.next.id)}<span>Volgende: <b>${esc(d.next.name)}</b> ${d.next.missing ? `<span class="muted">nog ${d.next.missing} goud</span>` : `<span class="ok">kopen kan!</span>`}</span></div>`);
    }
    if (d.threat) {
      const t = d.threat;
      parts.push(`<div class="row">${champImg(t.img)}<span class="warn">${esc(t.name)} is fed (${esc(t.kda)}${t.lead > 0 ? `, ${nl(t.lead)}k goud voor op jou` : ""})</span></div>`);
      if (t.item) parts.push(`<div class="row">${img(t.item.id)}<span>Tegen hem: <b>${esc(t.item.name)}</b> <span class="muted">(${esc(t.why)})</span></span></div>`);
    }
    if (d.dead?.length) {
      parts.push(`<div class="row"><span>Dood: ${d.dead.map((x) => `<b>${esc(x.name)}</b> ${x.secs}s`).join(", ")}${d.dead.length >= 2 ? ` <span class="soon">→ objective/push!</span>` : ""}</span></div>`);
    }
    if (d.timers?.length) {
      parts.push(`<div class="row"><span>${d.timers.map((x) => `${esc(x.label)} <span class="${x.soon ? "soon" : ""}">${esc(x.left)}</span>`).join(" · ")}</span></div>`);
    }
    for (const c of d.coach || []) parts.push(`<div class="tip">${esc(c)}</div>`);
  }
  el.innerHTML = parts.join("");
}

window.lolTool.onLive(render);
