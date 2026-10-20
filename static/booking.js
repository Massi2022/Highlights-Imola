// Logica del form di prenotazione pubblico
const state = { mode: "list", fixtures: [], selected: null, cfg: null, teamOk: false };

function payload() {
  const side = $("input[name=side]:checked").value;
  const pkg = $("input[name=package]:checked").value;
  const p = {
    side, package: pkg, team_code: $("#team-code").value.trim(), social: $("#social").checked,
    captain: $("#captain").value.trim(), phone: $("#phone").value.trim(),
    email: $("#email").value.trim(), notes: $("#notes").value.trim(),
  };
  if (state.mode === "list") {
    p.fixture_id = state.selected ? state.selected.id : null;
  } else {
    p.new_fixture = {
      date: $("#nf-date").value, time: $("#nf-time").value, venue: $("#nf-venue").value.trim(),
      competition: $("#nf-comp").value, home: $("#nf-home").value.trim(), away: $("#nf-away").value.trim(),
    };
  }
  return p;
}

function currentMatch() {
  if (state.mode === "list") return state.selected;
  const nf = payload().new_fixture;
  if (!nf.date || !nf.time || !nf.venue || !nf.home || !nf.away) return null;
  return { ...nf, booked_home: false, booked_away: false };
}

function renderFixtures() {
  const box = $("#fx-list");
  if (!state.fixtures.length) {
    box.innerHTML = `<div class="alert info">Il calendario non è ancora stato pubblicato. Inserisci tu la partita con "Inserisci la tua partita".</div>`;
    return;
  }
  box.innerHTML = state.fixtures.map(f => {
    const d = parseDate(f.date);
    const fullyBooked = f.booked_home && f.booked_away;
    const disabled = fullyBooked || (!f.available && !f.booked_home && !f.booked_away);
    let tag = `<span class="pill green">Libera</span>`;
    if (fullyBooked) tag = `<span class="pill red">Completa</span>`;
    else if (f.booked_home || f.booked_away) tag = `<span class="pill amber">Avversario prenotato · ${euro(state.cfg.prices.price_split)}</span>`;
    else if (!f.available) tag = `<span class="pill red">Non disponibile</span>`;
    return `<div class="fx ${disabled ? "disabled" : ""} ${state.selected && state.selected.id === f.id ? "selected" : ""}" data-id="${f.id}">
      <div class="d"><span>${GIORNI[d.getDay()]}</span><b>${d.getDate()}</b><span>${MESI[d.getMonth()]}</span></div>
      <div><div class="teams">${esc(f.home)} – ${esc(f.away)}</div>
        <div class="small muted">🕗 ${esc(f.time)} · 📍 ${esc(f.venue)} · ${COMP_LABEL[f.competition]}</div></div>
      <div>${tag}</div></div>`;
  }).join("");
  $all(".fx", box).forEach(el => el.addEventListener("click", () => {
    if (el.classList.contains("disabled")) return;
    state.selected = state.fixtures.find(f => f.id === Number(el.dataset.id));
    // seleziona in automatico il lato libero
    if (state.selected.booked_home) $("input[name=side][value=away]").checked = true;
    if (state.selected.booked_away) $("input[name=side][value=home]").checked = true;
    renderFixtures();
    update();
  }));
}

function renderSides() {
  const m = currentMatch();
  const home = $("#side-home"), away = $("#side-away");
  const hIn = $("input[name=side][value=home]"), aIn = $("input[name=side][value=away]");
  home.innerHTML = `${m ? esc(m.home) : "Casa"}<em>${m && m.booked_home ? "già prenotata" : "squadra di casa"}</em>`;
  away.innerHTML = `${m ? esc(m.away) : "Ospite"}<em>${m && m.booked_away ? "già prenotata" : "squadra ospite"}</em>`;
  hIn.disabled = !!(m && m.booked_home);
  aIn.disabled = !!(m && m.booked_away);
}

let quoteTimer = null;
function update() {
  renderSides();
  const p = payload();
  const m = currentMatch();
  $("#team-code-field").classList.toggle("hidden", p.package !== "pack");
  if (!m) {
    $("#sum-match").innerHTML = "Nessuna partita selezionata";
    $("#sum-total").textContent = "— €";
    $("#sum-lines").innerHTML = "";
    $("#quote-warning").innerHTML = "";
    return;
  }
  const team = p.side === "home" ? m.home : m.away;
  $("#sum-match").innerHTML = `<b style="color:var(--text)">${esc(m.home)} – ${esc(m.away)}</b><br>
    ${fmtDate(m.date)} · ${esc(m.time)} · ${esc(m.venue)}<br>Per: <b style="color:var(--text)">${esc(team)}</b>`;

  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(async () => {
    try {
      const q = await api("/api/public/quote", { method: "POST", body: { ...p, captain: p.captain || "x", phone: p.phone || "x" } });
      const pr = state.cfg.prices;
      const lines = [];
      if (p.package === "pack") lines.push(`1 partita dal pacchetto: 0 €`);
      else if (p.package === "buy_pack") lines.push(`Pacchetto ${state.cfg.pack_size} partite: ${euro(pr.price_pack)}`);
      else if (q.split) lines.push(`Quota 2ª squadra (avversario già prenotato): ${euro(pr.price_split)}`);
      else if (m.competition !== "campionato") lines.push(`Partita Coppa/Playoff: ${euro(pr.price_cup)}`);
      else lines.push(`Partita singola: ${euro(pr.price_single)}`);
      if (p.social) lines.push(`Gestione Social: +${euro(pr.price_social)}`);
      $("#sum-lines").innerHTML = lines.join("<br>");
      $("#sum-total").textContent = euro(q.price);
      $("#quote-warning").innerHTML = q.error ? `<div class="alert err">${esc(q.error)}</div>` : "";
      $("#submit-btn").disabled = !!q.error;
    } catch (e) {
      $("#quote-warning").innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
      $("#submit-btn").disabled = true;
    }
  }, 250);
}

async function checkTeamCode() {
  const code = $("#team-code").value.trim();
  const info = $("#team-code-info");
  if (code.length < 5) { info.textContent = ""; return; }
  try {
    const t = await api(`/api/public/team/${encodeURIComponent(code)}`);
    info.innerHTML = `<span style="color:var(--green)">✓ ${esc(t.name)} · ${t.credits_left} partite rimaste su ${t.credits_total}</span>`;
  } catch (e) {
    info.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`;
  }
}

async function submit(ev) {
  ev.preventDefault();
  const err = $("#form-error");
  err.innerHTML = "";
  const p = payload();
  if (!currentMatch()) { err.innerHTML = `<div class="alert err">Seleziona o inserisci una partita.</div>`; return; }
  if (!p.captain || !p.phone) { err.innerHTML = `<div class="alert err">Inserisci nome e cellulare del capitano.</div>`; return; }
  if (p.package === "pack" && !p.team_code) { err.innerHTML = `<div class="alert err">Inserisci il codice del pacchetto squadra.</div>`; return; }
  const btn = $("#submit-btn");
  btn.disabled = true; btn.textContent = "Invio…";
  try {
    const r = await api("/api/public/bookings", { method: "POST", body: p });
    $("#booking-form-wrap").classList.add("hidden");
    $("#booking-success").classList.remove("hidden");
    $("#success-code").textContent = r.code;
    $("#success-link").href = `/prenotazione?code=${r.code}`;
    let priceTxt = `Da pagare per questa partita: <b>${euro(r.price)}</b>`;
    if (r.pack_price) priceTxt += ` + pacchetto <b>${euro(r.pack_price)}</b>`;
    $("#success-price").innerHTML = priceTxt;
    if (r.team_code) { $("#success-pack").classList.remove("hidden"); $("#success-team-code").textContent = r.team_code; }
    const m = currentMatch();
    $("#success-wa").href = waLink(state.cfg.whatsapp,
      `Ciao! Ho appena prenotato la ripresa di ${m.home} – ${m.away} (${fmtDate(m.date)} ore ${m.time}, ${m.venue}). Codice: ${r.code}`);
    $("#booking-success").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) {
    err.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
    btn.disabled = false; btn.textContent = "Conferma prenotazione";
    loadFixtures();
  }
}

async function loadFixtures() {
  state.fixtures = await api("/api/public/fixtures");
  if (state.selected) state.selected = state.fixtures.find(f => f.id === state.selected.id) || null;
  renderFixtures();
}

(async function init() {
  state.cfg = await applyBranding();
  if (!state.cfg) return;
  const u = state.cfg.usage;
  const left = Math.max(0, u.max_matches - u.matches);
  $("#usage-bar").style.width = `${Math.min(100, (u.matches / u.max_matches) * 100)}%`;
  $("#usage-text").textContent = `${fmtMonth(u.month)}: ${left} partite ancora prenotabili su ${u.max_matches}`;
  $("#venues").innerHTML = state.cfg.venues.map(v => `<option value="${esc(v)}">`).join("");
  $("#nf-date").min = new Date().toISOString().slice(0, 10);

  $all(".tabs button").forEach(b => b.addEventListener("click", () => {
    $all(".tabs button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    state.mode = b.dataset.mode;
    $("#mode-list").classList.toggle("hidden", state.mode !== "list");
    $("#mode-new").classList.toggle("hidden", state.mode !== "new");
    update();
  }));
  $("#booking-form").addEventListener("input", update);
  $("#booking-form").addEventListener("change", update);
  $("#team-code").addEventListener("input", checkTeamCode);
  $("#booking-form").addEventListener("submit", submit);

  await loadFixtures();
  update();
})();
