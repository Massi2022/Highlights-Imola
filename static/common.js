// Utility condivise tra le pagine
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function euro(n) {
  const v = Number(n || 0);
  return (Number.isInteger(v) ? v : v.toFixed(2)).toString().replace(".", ",") + " €";
}

function parseDate(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function fmtDate(iso) { const d = parseDate(iso); return `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}`; }
function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

const COMP_LABEL = { campionato: "Campionato", coppa: "Coppa", playoff: "Playoff" };
const PKG_LABEL = { single: "Singola", pack: "Pacchetto", split: "Split (2ª squadra)", cup: "Coppa/Playoff" };

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const token = localStorage.getItem("adminToken");
  if (token && path.startsWith("/api/admin")) headers["X-Admin-Token"] = token;
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (_) { /* vuoto */ }
  if (!res.ok) {
    let msg = data && data.detail;
    if (Array.isArray(msg)) msg = msg.map(e => e.msg).join(", ");
    const err = new Error(msg || `Errore ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function waLink(phone, text) {
  let p = String(phone || "").replace(/\D/g, "");
  if (p && !p.startsWith("39") && p.length <= 10) p = "39" + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

async function applyBranding() {
  try {
    const cfg = await api("/api/public/config");
    $all("[data-brand]").forEach(el => (el.textContent = cfg.brand_name));
    $all("[data-price]").forEach(el => (el.textContent = cfg.prices[el.dataset.price]));
    $all("[data-pack-size]").forEach(el => (el.textContent = cfg.pack_size));
    $all("[data-pack-unit]").forEach(el => (el.textContent = Math.round(cfg.prices.price_pack / cfg.pack_size)));
    const y = $("#year"); if (y) y.textContent = new Date().getFullYear();
    return cfg;
  } catch (e) { console.error(e); return null; }
}
