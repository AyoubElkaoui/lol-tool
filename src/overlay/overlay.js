// Overlay in de game: klein paneel, klik-door, alleen lezen.
const el = document.getElementById("panel");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function render(d) {
  if (!d) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const img = (id) => (d.itemUrl ? `<img src="${esc(d.itemUrl)}${id}.png" alt="">` : "");
  const champImg = (f) => (d.champUrl && f ? `<img src="${esc(d.champUrl)}${esc(f)}" alt="">` : "");
  const parts = [];
  parts.push(`<div class="head"><span>LoL Tool · ${esc(d.champ)}</span><span>${esc(d.time)}</span></div>`);

  const g = d.goals;
  parts.push(`<div class="chips">
    <span class="chip ${g.csmOk ? "ok" : "bad"}">CS ${String(g.csm).replace(".", ",")}/min</span>
    <span class="chip ${g.deathsOk ? "ok" : "bad"}">${g.deaths} deaths</span>
    ${g.kp != null ? `<span class="chip ${g.kp >= 55 ? "ok" : "bad"}">KP ${g.kp}%</span>` : ""}
    ${g.ward ? "" : `<span class="chip bad">geen control ward</span>`}
  </div>`);

  if (d.next) {
    parts.push(`<div class="row">${img(d.next.id)}<span>Volgende: <b>${esc(d.next.name)}</b> ${d.next.missing ? `<span class="muted">nog ${d.next.missing} goud</span>` : `<span class="ok">kopen kan!</span>`}</span></div>`);
  }
  if (d.threat) {
    const t = d.threat;
    parts.push(`<div class="row">${champImg(t.img)}<span class="warn">${esc(t.name)} is fed (${esc(t.kda)}${t.lead > 0 ? `, ${String(t.lead).replace(".", ",")}k goud voor op jou` : ""})</span></div>`);
    if (t.item) parts.push(`<div class="row">${img(t.item.id)}<span>Tegen hem: <b>${esc(t.item.name)}</b> <span class="muted">(${esc(t.why)})</span></span></div>`);
  }
  if (d.dead?.length) {
    parts.push(`<div class="row"><span>Dood: ${d.dead.map((x) => `<b>${esc(x.name)}</b> ${x.secs}s`).join(", ")}${d.dead.length >= 2 ? ` <span class="soon">→ objective/push!</span>` : ""}</span></div>`);
  }
  if (d.timers?.length) {
    parts.push(`<div class="row"><span>${d.timers.map((x) => `${esc(x.label)} <span class="${x.soon ? "soon" : ""}">${esc(x.left)}</span>`).join(" · ")}</span></div>`);
  }
  el.innerHTML = parts.join("");
}

window.lolTool.onLive(render);
