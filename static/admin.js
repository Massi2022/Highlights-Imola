// Pannello di gestione
const main = () => $("#main");
let currentView = "dash";
let fxScope = "upcoming";
let cfgCache = null;

const FX_STATUS = {
  open: ["Aperta", ""], booked: ["Da riprendere", "amber"], recorded: ["Ripresa · da consegnare", "blue"],
  delivered: ["Consegnata", "green"], cancelled: ["Annullata", "red"],
};
const BK_STATUS = { pending: ["In attesa", "amber"], confirmed: ["Confermata", "green"], cancelled: ["Annullata", "red"] };

function siteUrl() { return location.origin; }

// ------------------------------------------------------------------ auth
async function login(ev) {
  ev.preventDefault();
  try {
    const r = await api("/api/admin/login", { method: "POST", body: { password: $("#password").value } });
    localStorage.setItem("adminToken", r.token);
    start();
  } catch (e) { $("#login-err").innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
}

async function start() {
  try {
    cfgCache = await api("/api/admin/settings");
  } catch (e) {
    localStorage.removeItem("adminToken");
    $("#login-view").classList.remove("hidden");
    $("#app-view").classList.add("hidden");
    return;
  }
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $all("[data-brand]").forEach(el => (el.textContent = cfgCache.brand_name));
  show(currentView);
}

function show(view) {
  currentView = view;
  $all(".sidebar button[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  ({ dash, fixtures, bookings, teams, survey, sponsors, tools, settings })[view]().catch(e => {
    if (e.status === 401) return start();
    main().innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
  });
}

function head(title, right = "") {
  return `<div class="main-head"><h1 style="margin:0">${title}</h1><div class="actions">${right}</div></div>`;
}

// ------------------------------------------------------------- dashboard
async function dash(month) {
  const m = month || new Date().toISOString().slice(0, 7);
  const d = await api(`/api/admin/dashboard?month=${m}`);
  const u = d.usage;
  const pct = Math.min(100, (u.matches / u.max_matches) * 100);
  const cnt = $("#cnt-deliver");
  cnt.textContent = d.to_deliver; cnt.classList.toggle("hidden", !d.to_deliver);
  main().innerHTML = head("Panoramica", `<input type="month" id="dash-month" value="${m}" style="width:auto">`) + `
    <div class="grid g4">
      <div class="card kpi"><div class="l">Partite del mese</div><div class="v">${u.matches} / ${u.max_matches}</div>
        <div class="bar" style="margin-top:8px"><div style="width:${pct}%"></div></div>
        <div class="small muted" style="margin-top:6px">${Math.round(u.minutes_used / 60 * 10) / 10} h su ${u.minutes_total / 60} h Veo Go</div></div>
      <div class="card kpi"><div class="l">Fatturato mese</div><div class="v">${euro(d.revenue)}</div>
        <div class="small muted">incassato ${euro(d.cashed)}</div></div>
      <div class="card kpi"><div class="l">Utile stimato</div><div class="v" style="color:${d.profit >= 0 ? "var(--green)" : "var(--red)"}">${euro(d.profit)}</div>
        <div class="small muted">dopo ${euro(d.cost)} di abbonamento</div></div>
      <div class="card kpi"><div class="l">Ricavo medio / partita</div><div class="v">${euro(Math.round(d.avg_per_match))}</div>
        <div class="small muted">target 30 € · ${d.split_bookings} split bill</div></div>
    </div>
    <div class="grid g4" style="margin-top:18px">
      <div class="card kpi"><div class="l">Potenziale a saturazione</div><div class="v">${euro(Math.round(d.potential))}</div><div class="small muted">utile se riempi tutte le ore</div></div>
      <div class="card kpi"><div class="l">Da incassare</div><div class="v" style="color:var(--amber)">${euro(d.unpaid)}</div><div class="small muted">tutte le prenotazioni</div></div>
      <div class="card kpi"><div class="l">Sponsor stagione</div><div class="v">${euro(d.sponsors_total)}</div><div class="small muted">incassati ${euro(d.sponsors_paid)}</div></div>
      <div class="card kpi"><div class="l">Risposte sondaggio</div><div class="v">${d.survey_count}</div><div class="small muted"><a href="#" data-go="survey">vedi risultati</a></div></div>
    </div>
    <div class="card" style="margin-top:18px">
      <h3>Prossime riprese</h3>
      ${d.upcoming.length ? `<div class="table-wrap"><table><tr><th>Data</th><th>Ora</th><th>Campo</th><th>Partita</th><th>Squadre paganti</th><th>Stato</th></tr>
        ${d.upcoming.map(f => `<tr><td>${fmtDate(f.date)}</td><td>${esc(f.time)}</td><td>${esc(f.venue)}</td>
          <td><b>${esc(f.home)} – ${esc(f.away)}</b></td><td>${f.nb}/2 ${f.nb < 2 ? `<span class="pill amber">split possibile</span>` : ""}</td>
          <td><span class="pill ${FX_STATUS[f.status][1]}">${FX_STATUS[f.status][0]}</span></td></tr>`).join("")}
      </table></div>` : `<p class="muted">Nessuna ripresa in programma. Condividi il link <a href="/" target="_blank">${siteUrl()}</a> nei gruppi WhatsApp!</p>`}
    </div>`;
  $("#dash-month").addEventListener("change", e => dash(e.target.value));
  $all("[data-go]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); show(a.dataset.go); }));
}

// --------------------------------------------------------------- fixtures
async function fixtures() {
  const list = await api(`/api/admin/fixtures?scope=${fxScope}`);
  const venues = (cfgCache.venues || "").split(",").map(v => v.trim()).filter(Boolean);
  main().innerHTML = head("Partite", `
      <select id="fx-scope" style="width:auto"><option value="upcoming">Prossime</option><option value="past">Passate</option><option value="all">Tutte</option></select>
      <button class="btn sm" id="add-fx">+ Aggiungi partite</button>`) +
    (list.length ? list.map(fxCard).join("") : `<div class="card muted">Nessuna partita. Aggiungi il calendario CSI così le squadre possono prenotare con un clic.</div>`);
  $("#fx-scope").value = fxScope;
  $("#fx-scope").addEventListener("change", e => { fxScope = e.target.value; fixtures(); });
  $("#add-fx").addEventListener("click", () => addFixturesDialog(venues));

  $all("[data-fx-save]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.fxSave, card = btn.closest(".fx-admin");
    const body = { video_url: $(".v-url", card).value.trim(), highlights_url: $(".h-url", card).value.trim(), status: $(".fx-st", card).value };
    if (btn.dataset.deliver && (body.video_url || body.highlights_url)) body.status = "delivered";
    await api(`/api/admin/fixtures/${id}`, { method: "PATCH", body });
    toast(body.status === "delivered" ? "Consegnata! Ora avvisa le squadre su WhatsApp" : "Salvato");
    fixtures();
  }));
  $all("[data-fx-del]").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Eliminare la partita?")) return;
    try { await api(`/api/admin/fixtures/${btn.dataset.fxDel}`, { method: "DELETE" }); fixtures(); } catch (e) { alert(e.message); }
  }));
  $all("[data-copy]").forEach(btn => btn.addEventListener("click", () => {
    navigator.clipboard.writeText(btn.dataset.copy); toast("Messaggio copiato");
  }));
  bindBookingActions(fixtures);
}

function fxCard(f) {
  const [st, cls] = FX_STATUS[f.status] || [f.status, ""];
  const active = f.bookings.filter(b => b.status !== "cancelled");
  const sides = new Set(active.map(b => b.side));
  let splitMsg = "";
  if (sides.size === 1) {
    const other = sides.has("home") ? f.away : f.home;
    splitMsg = `Ciao! Stasera riprendo ${f.home} – ${f.away} con la telecamera AI. Se volete anche voi (${other}) la partita intera e tutti i vostri gol, vi costa solo ${cfgCache.price_split} €. Prenota qui: ${siteUrl()}/#prenota`;
  }
  return `<div class="fx-admin">
    <header>
      <div><b style="font-size:1.05rem">${esc(f.home)} – ${esc(f.away)}</b>
        <div class="small muted">${fmtDate(f.date)} · ${esc(f.time)} · ${esc(f.venue)} · ${COMP_LABEL[f.competition]} ${f.created_by === "client" ? "· inserita dal cliente" : ""}</div></div>
      <div class="actions"><span class="pill ${cls}">${st}</span>
        ${splitMsg ? `<button class="btn sm ghost" data-copy="${esc(splitMsg)}" title="Copia il messaggio per il capitano avversario">💰 Proponi split</button>` : ""}
        ${!f.bookings.length ? `<button class="btn sm danger" data-fx-del="${f.id}">Elimina</button>` : ""}</div>
    </header>
    ${f.bookings.map(b => bookingLine(b, f)).join("")}
    <div class="row3" style="margin-top:12px;align-items:end">
      <div><label class="small">Link partita completa</label><input class="v-url" value="${esc(f.video_url)}" placeholder="https://app.veo.co/…"></div>
      <div><label class="small">Link highlights</label><input class="h-url" value="${esc(f.highlights_url)}" placeholder="https://…"></div>
      <div><label class="small">Stato</label><select class="fx-st">${Object.entries(FX_STATUS).map(([k, v]) => `<option value="${k}" ${k === f.status ? "selected" : ""}>${v[0]}</option>`).join("")}</select></div>
    </div>
    <div class="actions" style="margin-top:10px">
      <button class="btn sm ghost" data-fx-save="${f.id}">Salva</button>
      ${active.length ? `<button class="btn sm" data-fx-save="${f.id}" data-deliver="1">✅ Salva e consegna video</button>` : ""}
    </div>
  </div>`;
}

function bookingLine(b, f) {
  const [st, cls] = BK_STATUS[b.status];
  const confirmMsg = `Ciao ${b.captain}! Confermo la ripresa di ${f.home} – ${f.away}, ${fmtDate(f.date)} ore ${f.time} a ${f.venue}. Codice prenotazione: ${b.code}. Quota: ${euro(b.price)}. A presto a bordocampo!`;
  const videoMsg = `Ciao ${b.captain}! 🎬 Il video di ${f.home} – ${f.away} è pronto!\n▶ Partita: ${f.video_url || "-"}\n⚡ Highlights: ${f.highlights_url || "-"}\nTrovi tutto anche qui: ${siteUrl()}/prenotazione?code=${b.code}\nGiratelo pure nel gruppo squadra! 💪`;
  return `<div class="bk-line" style="${b.status === "cancelled" ? "opacity:.5" : ""}">
    <span class="pill ${cls}">${st}</span>
    <b>${esc(b.team)}</b><span class="muted">${esc(b.captain)} · ${esc(b.phone)}</span>
    <span class="pill">${PKG_LABEL[b.package]}${b.social ? " + Social" : ""}</span>
    <b>${euro(b.price)}</b>
    <label class="check" style="padding:4px 8px;display:inline-flex;margin:0"><input type="checkbox" data-bk-paid="${b.id}" ${b.paid ? "checked" : ""}> pagato</label>
    <span class="muted small">#${b.code}</span>
    <span class="actions" style="margin-left:auto">
      ${b.status === "pending" ? `<button class="btn sm" data-bk-status="confirmed" data-id="${b.id}">Conferma</button>` : ""}
      <a class="btn sm wa" target="_blank" rel="noopener" href="${waLink(b.phone, f.status === "delivered" ? videoMsg : confirmMsg)}">${f.status === "delivered" ? "Invia video" : "WhatsApp"}</a>
      ${b.status !== "cancelled" ? `<button class="btn sm danger" data-bk-status="cancelled" data-id="${b.id}">Annulla</button>` : ""}
    </span>
    ${b.notes ? `<div class="small muted" style="width:100%">📝 ${esc(b.notes)}</div>` : ""}
  </div>`;
}

function bindBookingActions(reload) {
  $all("[data-bk-paid]").forEach(cb => cb.addEventListener("change", async () => {
    await api(`/api/admin/bookings/${cb.dataset.bkPaid}`, { method: "PATCH", body: { paid: cb.checked } });
    toast(cb.checked ? "Segnato come pagato" : "Segnato come da pagare");
  }));
  $all("[data-bk-status]").forEach(btn => btn.addEventListener("click", async () => {
    if (btn.dataset.bkStatus === "cancelled" && !confirm("Annullare la prenotazione?")) return;
    await api(`/api/admin/bookings/${btn.dataset.id}`, { method: "PATCH", body: { status: btn.dataset.bkStatus } });
    reload();
  }));
}

function addFixturesDialog(venues) {
  const dlg = $("#dlg");
  $("#dlg-body").innerHTML = `
    <h3>Aggiungi partite</h3>
    <div class="row3">
      <div class="field"><label>Data</label><input type="date" id="af-date"></div>
      <div class="field"><label>Ora</label><input type="time" id="af-time" value="20:30"></div>
      <div class="field"><label>Competizione</label><select id="af-comp"><option value="campionato">Campionato</option><option value="coppa">Coppa</option><option value="playoff">Playoff</option></select></div>
    </div>
    <div class="field"><label>Campo</label><input id="af-venue" list="af-venues"><datalist id="af-venues">${venues.map(v => `<option value="${esc(v)}">`).join("")}</datalist></div>
    <div class="row"><div class="field"><label>Casa</label><input id="af-home"></div><div class="field"><label>Ospite</label><input id="af-away"></div></div>
    <details style="margin:6px 0 14px"><summary>📋 Importa più partite (incolla dal calendario)</summary>
      <p class="small">Una partita per riga: <code>data;ora;campo;casa;ospite;competizione</code><br>es. <code>2026-10-27;20:30;Tozzona;Tossani;Pizzeria Derby;campionato</code> (accetta anche 27/10/2026)</p>
      <textarea id="af-bulk" rows="6" placeholder="2026-10-27;20:30;Tozzona;Tossani;Pizzeria Derby;campionato"></textarea>
    </details>
    <div id="af-err"></div>
    <div class="actions"><button class="btn" id="af-save">Salva</button><button class="btn ghost" id="af-close">Chiudi</button></div>`;
  dlg.showModal();
  $("#af-close").onclick = () => dlg.close();
  $("#af-save").onclick = async () => {
    const items = [];
    const bulk = $("#af-bulk").value.trim();
    if (bulk) {
      for (const line of bulk.split("\n").map(l => l.trim()).filter(Boolean)) {
        const p = line.split(/[;\t]/).map(s => s.trim());
        if (p.length < 5) { $("#af-err").innerHTML = `<div class="alert err">Riga non valida: ${esc(line)}</div>`; return; }
        let d = p[0];
        const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) d = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
        items.push({ date: d, time: p[1], venue: p[2], home: p[3], away: p[4], competition: (p[5] || "campionato").toLowerCase() });
      }
    }
    const single = { date: $("#af-date").value, time: $("#af-time").value, venue: $("#af-venue").value.trim(), home: $("#af-home").value.trim(), away: $("#af-away").value.trim(), competition: $("#af-comp").value };
    if (single.date && single.venue && single.home && single.away) items.push(single);
    if (!items.length) { $("#af-err").innerHTML = `<div class="alert err">Compila i campi o incolla le partite.</div>`; return; }
    try {
      const r = await api("/api/admin/fixtures", { method: "POST", body: items });
      dlg.close(); toast(`${r.count} partite aggiunte`); fixtures();
    } catch (e) { $("#af-err").innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  };
}

// --------------------------------------------------------------- bookings
async function bookings() {
  const list = await api("/api/admin/bookings");
  main().innerHTML = head("Prenotazioni", `<input id="bk-q" placeholder="Cerca squadra, capitano, codice…" style="width:260px">
      <select id="bk-f" style="width:auto"><option value="">Tutte</option><option value="unpaid">Da incassare</option><option value="pending">Da confermare</option></select>
      <button class="btn sm ghost" id="bk-csv">⬇ CSV</button>`) +
    `<div class="card table-wrap"><table id="bk-table"><thead><tr><th>Partita</th><th>Squadra</th><th>Capitano</th><th>Formula</th><th>Prezzo</th><th>Pagato</th><th>Stato</th><th>Codice</th></tr></thead><tbody></tbody></table></div>`;
  const render = () => {
    const q = $("#bk-q").value.toLowerCase(), f = $("#bk-f").value;
    const rowsF = list.filter(b => (!q || [b.team, b.captain, b.code, b.phone, b.home, b.away].join(" ").toLowerCase().includes(q))
      && (!f || (f === "unpaid" && !b.paid && b.status !== "cancelled") || (f === "pending" && b.status === "pending")));
    $("#bk-table tbody").innerHTML = rowsF.map(b => `<tr style="${b.status === "cancelled" ? "opacity:.5" : ""}">
      <td>${fmtDate(b.date)} ${esc(b.time)}<br><span class="small muted">${esc(b.home)} – ${esc(b.away)} · ${esc(b.venue)}</span></td>
      <td><b>${esc(b.team)}</b></td>
      <td>${esc(b.captain)}<br><a class="small" href="${waLink(b.phone, `Ciao ${b.captain}!`)}" target="_blank">${esc(b.phone)}</a></td>
      <td>${PKG_LABEL[b.package]}${b.social ? " + Social" : ""}${b.team_code ? `<br><span class="small muted">${esc(b.team_code)}</span>` : ""}</td>
      <td>${euro(b.price)}</td>
      <td><input type="checkbox" data-bk-paid="${b.id}" ${b.paid ? "checked" : ""} style="width:auto;accent-color:var(--green)"></td>
      <td><select data-bk-sel="${b.id}" style="width:auto;padding:6px">${Object.entries(BK_STATUS).map(([k, v]) => `<option value="${k}" ${k === b.status ? "selected" : ""}>${v[0]}</option>`).join("")}</select></td>
      <td class="small muted">${esc(b.code)}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">Nessuna prenotazione</td></tr>`;
    bindBookingActions(bookings);
    $all("[data-bk-sel]").forEach(s => s.addEventListener("change", async () => {
      await api(`/api/admin/bookings/${s.dataset.bkSel}`, { method: "PATCH", body: { status: s.value } }); toast("Aggiornato");
    }));
  };
  $("#bk-q").addEventListener("input", render);
  $("#bk-f").addEventListener("change", render);
  $("#bk-csv").addEventListener("click", () => downloadCsv("prenotazioni.csv", list,
    ["code", "date", "time", "venue", "home", "away", "team", "captain", "phone", "email", "package", "social", "price", "paid", "status"]));
  render();
}

function downloadCsv(name, data, cols) {
  const csv = [cols.join(";"), ...data.map(r => cols.map(c => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(";"))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
  a.download = name; a.click();
}

// ------------------------------------------------------------------ teams
async function teams() {
  const list = await api("/api/admin/teams");
  main().innerHTML = head("Pacchetti squadra", `<button class="btn sm" id="add-team">+ Nuovo pacchetto</button>`) + `
    <p class="muted">Ogni pacchetto ha un codice che il capitano usa nel form di prenotazione. Le partite vengono scalate in automatico.</p>
    <div class="card table-wrap"><table><tr><th>Codice</th><th>Squadra</th><th>Capitano</th><th>Partite usate</th><th>Prezzo</th><th>Pagato</th><th></th></tr>
    ${list.map(t => `<tr><td><b style="font-family:monospace">${esc(t.code)}</b></td><td>${esc(t.name)}</td>
      <td>${esc(t.captain)}<br><span class="small muted">${esc(t.phone)}</span></td>
      <td>${t.used} / ${t.credits_total} <div class="bar" style="margin-top:4px;width:100px"><div style="width:${t.used / t.credits_total * 100}%"></div></div></td>
      <td>${euro(t.price)}</td>
      <td><input type="checkbox" data-team-paid="${t.id}" ${t.paid ? "checked" : ""} style="width:auto;accent-color:var(--green)"></td>
      <td class="actions"><button class="btn sm ghost" data-team-credit="${t.id}" data-total="${t.credits_total}">+1 partita</button>
        ${t.phone ? `<a class="btn sm wa" target="_blank" href="${waLink(t.phone, `Ciao ${t.captain}! Il codice del vostro pacchetto è ${t.code}: vi restano ${t.credits_total - t.used} partite. Prenotate qui: ${siteUrl()}/#prenota`)}">WhatsApp</a>` : ""}</td></tr>`).join("")
    || `<tr><td colspan="7" class="muted">Nessun pacchetto venduto</td></tr>`}</table></div>`;
  $all("[data-team-paid]").forEach(cb => cb.addEventListener("change", async () => {
    await api(`/api/admin/teams/${cb.dataset.teamPaid}`, { method: "PATCH", body: { paid: cb.checked } }); toast("Aggiornato");
  }));
  $all("[data-team-credit]").forEach(b => b.addEventListener("click", async () => {
    await api(`/api/admin/teams/${b.dataset.teamCredit}`, { method: "PATCH", body: { credits_total: Number(b.dataset.total) + 1 } }); teams();
  }));
  $("#add-team").addEventListener("click", () => {
    $("#dlg-body").innerHTML = `<h3>Nuovo pacchetto</h3>
      <div class="field"><label>Squadra</label><input id="nt-name"></div>
      <div class="row"><div class="field"><label>Capitano</label><input id="nt-cap"></div><div class="field"><label>Cellulare</label><input id="nt-phone"></div></div>
      <div class="row"><div class="field"><label>Partite</label><input id="nt-cr" type="number" value="${cfgCache.pack_size}"></div><div class="field"><label>Prezzo €</label><input id="nt-pr" type="number" value="${cfgCache.price_pack}"></div></div>
      <label class="check"><input type="checkbox" id="nt-paid"> già pagato</label>
      <div class="actions" style="margin-top:14px"><button class="btn" id="nt-save">Crea</button><button class="btn ghost" onclick="dlg.close()">Chiudi</button></div>`;
    $("#dlg").showModal();
    $("#nt-save").onclick = async () => {
      if (!$("#nt-name").value.trim()) return;
      const r = await api("/api/admin/teams", { method: "POST", body: { name: $("#nt-name").value.trim(), captain: $("#nt-cap").value, phone: $("#nt-phone").value, credits_total: Number($("#nt-cr").value), price: Number($("#nt-pr").value), paid: $("#nt-paid").checked } });
      $("#dlg").close(); toast(`Creato ${r.code}`); teams();
    };
  });
}

// ----------------------------------------------------------------- survey
async function survey() {
  const list = await api("/api/admin/survey");
  const count = (key, labels) => {
    const c = {}; list.forEach(r => { if (r[key]) c[r[key]] = (c[r[key]] || 0) + 1; });
    const max = Math.max(1, ...Object.values(c));
    return Object.entries(labels).map(([k, l]) => `<div class="chart-bar"><span class="lbl">${l}</span><div class="bar"><div style="width:${(c[k] || 0) / max * 100}%"></div></div><span class="n">${c[k] || 0}</span></div>`).join("");
  };
  const avg = list.length ? (list.reduce((s, r) => s + (r.interest || 0), 0) / list.length).toFixed(1) : "–";
  const interested = list.filter(r => ["A", "B", "C"].includes(r.option)).length;
  const link = `${siteUrl()}/sondaggio`;
  main().innerHTML = head("Sondaggio", `<button class="btn sm ghost" id="copy-link">🔗 Copia link sondaggio</button><button class="btn sm ghost" id="sv-csv">⬇ CSV</button>`) + `
    <div class="grid g3">
      <div class="card kpi"><div class="l">Risposte</div><div class="v">${list.length}</div><div class="small muted">obiettivo: 27 squadre</div></div>
      <div class="card kpi"><div class="l">Interessati a pagare</div><div class="v">${interested}</div><div class="small muted">${list.length ? Math.round(interested / list.length * 100) : 0}% delle risposte</div></div>
      <div class="card kpi"><div class="l">Interesse medio</div><div class="v">${avg} / 5</div></div>
    </div>
    <div class="grid g2" style="margin-top:18px">
      <div class="card"><h3>Formula preferita</h3>${count("option", { A: "A · Singola 25 €", B: "B · Pacchetto 5 a 100 €", C: "C · Solo Coppa 30 €", none: "Nessuna" })}</div>
      <div class="card"><h3>Pagina social della squadra</h3>${count("has_social", { si_attiva: "Sì, attiva", si_ferma: "Sì, ma ferma", no: "No" })}
        <h3 style="margin-top:16px">Reel montato (+15 €)</h3>${count("social_addon", { si: "Sì", forse: "Forse", no: "No" })}</div>
      <div class="card"><h3>Cosa interessa di più</h3>${count("favorite", { gol_social: "Clip gol per social", partita: "Partita intera", tattica: "Tattica", ricordo: "Ricordo stagione" })}</div>
      <div class="card"><h3>Tempo dedicato ai social</h3>${count("posting_time", { zero: "Zero", poco: "Poco", vorremmo: "Vorremmo ma è sbatti", tanto: "Ci teniamo molto" })}</div>
    </div>
    <div class="card table-wrap" style="margin-top:18px"><h3>Risposte (lead da contattare)</h3>
      <table><tr><th>Squadra</th><th>Contatto</th><th>Formula</th><th>Social</th><th>Sponsor</th><th>Note</th><th></th></tr>
      ${list.map(r => `<tr><td><b>${esc(r.team)}</b><br><span class="small muted">${esc(r.role)}</span></td>
        <td>${esc(r.name)}${r.phone ? `<br><a target="_blank" href="${waLink(r.phone, `Ciao ${r.name}! Grazie per aver risposto al sondaggio sulle riprese AI. Vi va una partita di prova gratis? Prenota qui: ${siteUrl()}/#prenota`)}">${esc(r.phone)}</a>` : ""}</td>
        <td>${esc(r.option)}</td><td>${esc(r.has_social)}</td><td>${esc(r.sponsor)}</td><td class="small">${esc(r.notes)}</td>
        <td><button class="btn sm danger" data-sv-del="${r.id}">✕</button></td></tr>`).join("") || `<tr><td colspan="7" class="muted">Ancora nessuna risposta. Condividi: <a href="${link}" target="_blank">${link}</a></td></tr>`}
      </table></div>`;
  $("#copy-link").onclick = () => { navigator.clipboard.writeText(link); toast("Link copiato"); };
  $("#sv-csv").onclick = () => downloadCsv("sondaggio.csv", list, ["created_at", "team", "role", "name", "phone", "has_social", "posting_time", "interest", "favorite", "option", "social_addon", "sponsor", "notes"]);
  $all("[data-sv-del]").forEach(b => b.addEventListener("click", async () => {
    if (confirm("Eliminare la risposta?")) { await api(`/api/admin/survey/${b.dataset.svDel}`, { method: "DELETE" }); survey(); }
  }));
}

// --------------------------------------------------------------- sponsors
async function sponsors() {
  const list = await api("/api/admin/sponsors");
  const tot = list.reduce((s, x) => s + x.amount, 0);
  main().innerHTML = head("Sponsor", `<button class="btn sm" id="add-sp">+ Nuovo sponsor</button>`) + `
    <p class="muted">Logo fisso in sovrimpressione su tutti i video della stagione di una squadra (proposta: 100-150 € a stagione). Totale: <b>${euro(tot)}</b></p>
    <div class="card table-wrap"><table><tr><th>Sponsor</th><th>Squadra</th><th>Contatto</th><th>Importo</th><th>Pagato</th><th>Note</th><th></th></tr>
    ${list.map(s => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.team)}</td><td>${esc(s.contact)}</td><td>${euro(s.amount)}</td>
      <td><input type="checkbox" data-sp-paid="${s.id}" ${s.paid ? "checked" : ""} style="width:auto;accent-color:var(--green)"></td>
      <td class="small">${esc(s.notes)}</td><td><button class="btn sm danger" data-sp-del="${s.id}">✕</button></td></tr>`).join("")
    || `<tr><td colspan="7" class="muted">Nessuno sponsor. Guarda il campo "sponsor" nelle risposte al sondaggio per trovare i primi contatti.</td></tr>`}</table></div>`;
  $all("[data-sp-paid]").forEach(cb => cb.addEventListener("change", async () => {
    const s = list.find(x => x.id === Number(cb.dataset.spPaid));
    await api(`/api/admin/sponsors/${s.id}`, { method: "PATCH", body: { ...s, paid: cb.checked } }); toast("Aggiornato");
  }));
  $all("[data-sp-del]").forEach(b => b.addEventListener("click", async () => {
    if (confirm("Eliminare lo sponsor?")) { await api(`/api/admin/sponsors/${b.dataset.spDel}`, { method: "DELETE" }); sponsors(); }
  }));
  $("#add-sp").onclick = () => {
    $("#dlg-body").innerHTML = `<h3>Nuovo sponsor</h3>
      <div class="row"><div class="field"><label>Nome attività</label><input id="sp-name" placeholder="Pizzeria…"></div><div class="field"><label>Squadra</label><input id="sp-team"></div></div>
      <div class="row"><div class="field"><label>Contatto</label><input id="sp-contact"></div><div class="field"><label>Importo €</label><input id="sp-amount" type="number" value="120"></div></div>
      <div class="field"><label>Note</label><input id="sp-notes"></div>
      <label class="check"><input type="checkbox" id="sp-paid"> già pagato</label>
      <div class="actions" style="margin-top:14px"><button class="btn" id="sp-save">Salva</button><button class="btn ghost" onclick="dlg.close()">Chiudi</button></div>`;
    $("#dlg").showModal();
    $("#sp-save").onclick = async () => {
      if (!$("#sp-name").value.trim()) return;
      await api("/api/admin/sponsors", { method: "POST", body: { name: $("#sp-name").value.trim(), team: $("#sp-team").value, contact: $("#sp-contact").value, amount: Number($("#sp-amount").value), notes: $("#sp-notes").value, paid: $("#sp-paid").checked } });
      $("#dlg").close(); sponsors();
    };
  };
}

// ------------------------------------------------------------------ tools
async function tools() {
  const s = cfgCache, url = siteUrl();
  const msgs = [
    ["🎣 Dopo la partita esca (ai capitani)", `Ragazzi, ieri ho testato il nuovo sistema di ripresa AI sulla vostra partita. Ecco i gol, girateli pure nel gruppo squadra! 🎬⚽\nSe volete la partita intera o prenotare la prossima: ${url}/#prenota\nE se avete 2 minuti, aiutatemi con questo sondaggio: ${url}/sondaggio`],
    ["💰 Split bill (al capitano avversario, prima del fischio)", `Stasera riprendo la partita con la telecamera AI. Se volete l'accesso anche voi a tutti i vostri gol e alla partita intera, vi costa solo ${s.price_split} €. Prenota in 30 secondi: ${url}/#prenota`],
    ["📣 Lancio nella chat dirigenti CSI", `Ciao a tutti! Da questa stagione è disponibile un servizio di riprese con telecamera AI per il Calcio a 7 CSI Imola: video completo + highlights dei gol pronti per Instagram il giorno dopo.\n• Partita singola ${s.price_single} € a squadra (≈2 € a testa)\n• Pacchetto ${s.pack_size} partite ${s.price_pack} €\n• Coppa/Playoff ${s.price_cup} €\nCalendario e prenotazioni: ${url}\nSondaggio (2 min): ${url}/sondaggio`],
    ["🤝 Proposta al CSI Imola", `Buongiorno, sono [nome] e offro un servizio di riprese AI per il Calcio a 7. Vorrei proporvi uno scambio: vi fornisco gratuitamente ogni settimana la clip "Top 5 Gol della Settimana" da pubblicare su @csiimola, in cambio del permesso di posizionare il treppiede a bordocampo e di condividere il mio listino nella chat dei dirigenti. Posso mandarvi un esempio di video?`],
    ["🍕 Proposta allo sponsor della squadra", `Buongiorno! Riprendo le partite di [squadra] con una telecamera AI e i video vengono condivisi da tutta la squadra su WhatsApp e Instagram. Vi propongo di inserire il logo di [attività] in sovrimpressione fissa in tutti i video della stagione a 120 €. Vi mando un esempio?`],
  ];
  main().innerHTML = head("Messaggi pronti") + `<p class="muted">Copia e incolla su WhatsApp. I link puntano già al tuo sito (${esc(url)}).</p>` +
    msgs.map(([t, m], i) => `<div class="card" style="margin-bottom:12px"><h3>${t}</h3><textarea rows="${Math.min(8, m.split("\n").length + 2)}" id="msg-${i}">${esc(m)}</textarea>
      <div class="actions" style="margin-top:8px"><button class="btn sm" data-copy-msg="${i}">Copia</button><a class="btn sm wa" target="_blank" data-wa-msg="${i}" href="#">Apri WhatsApp</a></div></div>`).join("");
  $all("[data-copy-msg]").forEach(b => b.onclick = () => { navigator.clipboard.writeText($(`#msg-${b.dataset.copyMsg}`).value); toast("Copiato"); });
  $all("[data-wa-msg]").forEach(a => a.onclick = () => { a.href = `https://wa.me/?text=${encodeURIComponent($(`#msg-${a.dataset.waMsg}`).value)}`; });
}

// --------------------------------------------------------------- settings
async function settings() {
  const s = await api("/api/admin/settings");
  const F = [
    ["brand_name", "Nome del servizio", "text"], ["whatsapp", "Tuo numero WhatsApp (es. 39333…)", "text"],
    ["monthly_hours", "Ore di registrazione / mese (Veo Go)", "number"], ["minutes_per_match", "Minuti per partita", "number"],
    ["subscription_cost", "Costo abbonamento / mese €", "number"], ["max_per_evening", "Max partite per sera", "number"],
    ["travel_minutes", "Minuti minimi tra partite su campi diversi", "number"],
    ["price_single", "Prezzo partita singola €", "number"], ["price_pack", "Prezzo pacchetto €", "number"],
    ["pack_size", "Partite nel pacchetto", "number"], ["price_cup", "Prezzo Coppa/Playoff €", "number"],
    ["price_split", "Prezzo 2ª squadra (split) €", "number"], ["price_social", "Extra Gestione Social €", "number"],
  ];
  main().innerHTML = head("Impostazioni") + `<form class="card" id="set-form"><div class="grid g2">
    ${F.map(([k, l, t]) => `<div class="field"><label>${l}</label><input name="${k}" type="${t}" step="any" value="${esc(s[k])}"></div>`).join("")}
    </div><div class="field"><label>Campi (separati da virgola)</label><input name="venues" value="${esc(s.venues)}"></div>
    <button class="btn">Salva impostazioni</button></form>
    <div class="alert info" style="margin-top:18px">La password dell'area gestore si cambia con la variabile d'ambiente <code>ADMIN_PASSWORD</code> all'avvio del server.</div>`;
  $("#set-form").addEventListener("submit", async e => {
    e.preventDefault();
    await api("/api/admin/settings", { method: "PUT", body: Object.fromEntries(new FormData(e.target).entries()) });
    cfgCache = await api("/api/admin/settings");
    toast("Impostazioni salvate");
  });
}

// ------------------------------------------------------------------- init
const dlg = $("#dlg");
$("#login-form").addEventListener("submit", login);
$("#logout").addEventListener("click", () => { localStorage.removeItem("adminToken"); location.reload(); });
$all(".sidebar button[data-view]").forEach(b => b.addEventListener("click", () => show(b.dataset.view)));
if (localStorage.getItem("adminToken")) start();
