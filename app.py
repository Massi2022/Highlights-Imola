"""
CSI Imola Highlights - gestionale + prenotazioni online per riprese Veo Go.

Avvio:
    ../.venv/bin/python -m uvicorn app:app --reload --port 8000
Pagine:
    /                -> sito pubblico + prenotazione
    /sondaggio       -> sondaggio per capitani/dirigenti
    /prenotazione    -> il cliente controlla lo stato e scarica il video
    /admin           -> pannello di gestione (password: env ADMIN_PASSWORD)
"""
import hashlib
import hmac
import os
import secrets
import sqlite3
import string
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("DB_PATH", BASE_DIR / "data.db"))
STATIC_DIR = BASE_DIR / "static"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "imola2026")
SECRET = os.environ.get("APP_SECRET", "cambia-questo-segreto")

DEFAULT_SETTINGS = {
    "brand_name": "CSI Imola Highlights",
    "whatsapp": "393330000000",
    "monthly_hours": "20",
    "minutes_per_match": "65",
    "subscription_cost": "45",
    "max_per_evening": "3",
    "travel_minutes": "120",
    "price_single": "25",
    "price_pack": "100",
    "pack_size": "5",
    "price_cup": "30",
    "price_split": "15",
    "price_social": "15",
    "venues": "Tozzona,Zolino,Sasso Morelli,Stadio Galli,Ponticelli,Castel San Pietro",
}

COMPETITIONS = ("campionato", "coppa", "playoff")

# --------------------------------------------------------------------------- DB


SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS fixtures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, time TEXT NOT NULL, venue TEXT NOT NULL,
    competition TEXT NOT NULL DEFAULT 'campionato',
    home TEXT NOT NULL, away TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    video_url TEXT DEFAULT '', highlights_url TEXT DEFAULT '',
    created_by TEXT DEFAULT 'admin', notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    captain TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '',
    credits_total INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    fixture_id INTEGER NOT NULL REFERENCES fixtures(id),
    side TEXT NOT NULL,
    team TEXT NOT NULL, captain TEXT NOT NULL, phone TEXT NOT NULL,
    email TEXT DEFAULT '',
    package TEXT NOT NULL, team_id INTEGER REFERENCES teams(id),
    social INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS survey (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team TEXT, role TEXT, name TEXT, phone TEXT,
    has_social TEXT, posting_time TEXT, interest INTEGER,
    favorite TEXT, option TEXT, social_addon TEXT, sponsor TEXT,
    notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sponsors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, team TEXT DEFAULT '', contact TEXT DEFAULT '',
    amount REAL NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '', created_at TEXT NOT NULL
);
"""


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with db() as c:
        c.executescript(SCHEMA)
        for k, v in DEFAULT_SETTINGS.items():
            c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (k, v))


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def rows(cur) -> List[dict]:
    return [dict(r) for r in cur.fetchall()]


def get_settings(c) -> dict:
    return {r["key"]: r["value"] for r in c.execute("SELECT key, value FROM settings")}


def num(s: dict, key: str) -> float:
    try:
        return float(s.get(key, DEFAULT_SETTINGS.get(key, "0")))
    except ValueError:
        return float(DEFAULT_SETTINGS.get(key, "0"))


def new_code(c, table: str, prefix: str = "", length: int = 6) -> str:
    alphabet = string.ascii_uppercase.replace("O", "").replace("I", "") + "23456789"
    while True:
        code = prefix + "".join(secrets.choice(alphabet) for _ in range(length))
        if not c.execute(f"SELECT 1 FROM {table} WHERE code = ?", (code,)).fetchone():
            return code


def to_minutes(t: str) -> int:
    h, m = t.split(":")[:2]
    return int(h) * 60 + int(m)


# ----------------------------------------------------------------- capacity


def active_fixture_ids(c, where: str = "", params: tuple = ()) -> List[dict]:
    """Partite con almeno una prenotazione non annullata (= da riprendere)."""
    q = f"""
        SELECT f.* FROM fixtures f
        WHERE f.status != 'cancelled'
          AND EXISTS (SELECT 1 FROM bookings b WHERE b.fixture_id = f.id AND b.status != 'cancelled')
          {where}
    """
    return rows(c.execute(q, params))


def month_usage(c, month: str) -> dict:
    s = get_settings(c)
    fx = active_fixture_ids(c, "AND substr(f.date,1,7) = ?", (month,))
    max_matches = int(num(s, "monthly_hours") * 60 // num(s, "minutes_per_match"))
    return {
        "month": month,
        "matches": len(fx),
        "max_matches": max_matches,
        "minutes_used": int(len(fx) * num(s, "minutes_per_match")),
        "minutes_total": int(num(s, "monthly_hours") * 60),
    }


def check_capacity(c, fixture: dict) -> Optional[str]:
    """Ritorna un messaggio d'errore se la partita non è registrabile, altrimenti None."""
    s = get_settings(c)
    already = c.execute(
        "SELECT 1 FROM bookings WHERE fixture_id = ? AND status != 'cancelled'", (fixture["id"],)
    ).fetchone() if fixture.get("id") else None
    if already:
        return None  # la partita è già in programma: lo split bill non consuma ore

    usage = month_usage(c, fixture["date"][:7])
    if usage["matches"] >= usage["max_matches"]:
        return "Ore di registrazione del mese esaurite: scegli una partita di un altro mese."

    same_day = active_fixture_ids(c, "AND f.date = ? AND f.id != ?", (fixture["date"], fixture.get("id") or 0))
    if len(same_day) >= int(num(s, "max_per_evening")):
        return "Serata già piena: abbiamo raggiunto il massimo di partite registrabili."
    t = to_minutes(fixture["time"])
    for other in same_day:
        delta = abs(to_minutes(other["time"]) - t)
        if other["venue"].strip().lower() == fixture["venue"].strip().lower():
            if delta < num(s, "minutes_per_match"):
                return f"Il kit è già impegnato a {other['venue']} alle {other['time']}."
        elif delta < num(s, "travel_minutes"):
            return (f"Quella sera siamo già a {other['venue']} alle {other['time']}: "
                    "non riusciamo a spostarci in tempo.")
    return None


def fixture_public(c, f: dict) -> dict:
    bk = rows(c.execute(
        "SELECT side FROM bookings WHERE fixture_id = ? AND status != 'cancelled'", (f["id"],)))
    sides = {b["side"] for b in bk}
    return {
        "id": f["id"], "date": f["date"], "time": f["time"], "venue": f["venue"],
        "competition": f["competition"], "home": f["home"], "away": f["away"],
        "status": f["status"],
        "booked_home": "home" in sides, "booked_away": "away" in sides,
        "available": f["status"] in ("open", "booked") and check_capacity(c, f) is None,
    }


def compute_price(s: dict, fixture: dict, other_side_booked: bool, package: str, social: bool) -> float:
    if package == "pack":
        base = 0.0
    elif other_side_booked:
        base = num(s, "price_split")
    elif fixture["competition"] in ("coppa", "playoff"):
        base = num(s, "price_cup")
    else:
        base = num(s, "price_single")
    return base + (num(s, "price_social") if social else 0)


# ---------------------------------------------------------------------- auth


def make_token() -> str:
    return hmac.new(SECRET.encode(), ADMIN_PASSWORD.encode(), hashlib.sha256).hexdigest()


def require_admin(token: Optional[str]):
    if not token or not hmac.compare_digest(token, make_token()):
        raise HTTPException(401, "Non autorizzato")


# -------------------------------------------------------------------- models


class FixtureIn(BaseModel):
    date: str
    time: str
    venue: str
    competition: str = "campionato"
    home: str
    away: str
    notes: str = ""


class BookingIn(BaseModel):
    fixture_id: Optional[int] = None
    new_fixture: Optional[FixtureIn] = None
    side: str = Field(..., pattern="^(home|away)$")
    captain: str
    phone: str
    email: str = ""
    package: str = Field("single", pattern="^(single|pack|buy_pack)$")
    team_code: str = ""
    social: bool = False
    notes: str = ""


class SurveyIn(BaseModel):
    team: str = ""
    role: str = ""
    name: str = ""
    phone: str = ""
    has_social: str = ""
    posting_time: str = ""
    interest: int = 0
    favorite: str = ""
    option: str = ""
    social_addon: str = ""
    sponsor: str = ""
    notes: str = ""


class LoginIn(BaseModel):
    password: str


class FixtureUpdate(BaseModel):
    date: Optional[str] = None
    time: Optional[str] = None
    venue: Optional[str] = None
    competition: Optional[str] = None
    home: Optional[str] = None
    away: Optional[str] = None
    status: Optional[str] = None
    video_url: Optional[str] = None
    highlights_url: Optional[str] = None
    notes: Optional[str] = None


class BookingUpdate(BaseModel):
    status: Optional[str] = None
    paid: Optional[bool] = None
    price: Optional[float] = None
    notes: Optional[str] = None


class TeamIn(BaseModel):
    name: str
    captain: str = ""
    phone: str = ""
    email: str = ""
    credits_total: Optional[int] = None
    price: Optional[float] = None
    paid: bool = False


class TeamUpdate(BaseModel):
    credits_total: Optional[int] = None
    paid: Optional[bool] = None
    price: Optional[float] = None


class SponsorIn(BaseModel):
    name: str
    team: str = ""
    contact: str = ""
    amount: float = 0
    paid: bool = False
    notes: str = ""


# ----------------------------------------------------------------------- app

app = FastAPI(title="CSI Imola Highlights")
init_db()


def page(name: str):
    return FileResponse(STATIC_DIR / name)


@app.get("/")
def home_page():
    return page("index.html")


@app.get("/sondaggio")
def survey_page():
    return page("sondaggio.html")


@app.get("/prenotazione")
def lookup_page():
    return page("prenotazione.html")


@app.get("/admin")
def admin_page():
    return page("admin.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ----------------------------------------------------------------- public API


@app.get("/api/public/config")
def public_config():
    with db() as c:
        s = get_settings(c)
        month = date.today().isoformat()[:7]
        return {
            "brand_name": s["brand_name"], "whatsapp": s["whatsapp"],
            "prices": {k: num(s, k) for k in ("price_single", "price_pack", "price_cup",
                                              "price_split", "price_social")},
            "pack_size": int(num(s, "pack_size")),
            "venues": [v.strip() for v in s["venues"].split(",") if v.strip()],
            "usage": month_usage(c, month),
        }


@app.get("/api/public/fixtures")
def public_fixtures():
    today = date.today().isoformat()
    with db() as c:
        fx = rows(c.execute(
            "SELECT * FROM fixtures WHERE date >= ? AND status IN ('open','booked') ORDER BY date, time",
            (today,)))
        return [fixture_public(c, f) for f in fx]


@app.get("/api/public/team/{code}")
def public_team(code: str):
    with db() as c:
        t = c.execute("SELECT * FROM teams WHERE code = ?", (code.strip().upper(),)).fetchone()
        if not t:
            raise HTTPException(404, "Codice pacchetto non trovato")
        used = c.execute("SELECT COUNT(*) FROM bookings WHERE team_id = ? AND status != 'cancelled'",
                         (t["id"],)).fetchone()[0]
        return {"name": t["name"], "credits_total": t["credits_total"], "credits_left": t["credits_total"] - used}


@app.post("/api/public/quote")
def public_quote(b: BookingIn):
    """Preventivo in tempo reale mostrato nel form."""
    with db() as c:
        s = get_settings(c)
        fixture, other = _resolve_fixture(c, b)
        price = compute_price(s, fixture, other, "pack" if b.package != "single" else "single", b.social)
        if b.package == "buy_pack":
            price += num(s, "price_pack")
        return {"price": price, "split": other, "error": check_capacity(c, fixture)}


def _resolve_fixture(c, b: BookingIn):
    if b.fixture_id:
        f = c.execute("SELECT * FROM fixtures WHERE id = ?", (b.fixture_id,)).fetchone()
        if not f:
            raise HTTPException(404, "Partita non trovata")
        f = dict(f)
        if f["status"] not in ("open", "booked"):
            raise HTTPException(400, "Questa partita non è più prenotabile")
        sides = {r["side"] for r in c.execute(
            "SELECT side FROM bookings WHERE fixture_id = ? AND status != 'cancelled'", (f["id"],))}
        if b.side in sides:
            raise HTTPException(400, "Questa squadra ha già prenotato la partita")
        other = ("away" if b.side == "home" else "home") in sides
        return f, other
    if not b.new_fixture:
        raise HTTPException(400, "Seleziona una partita o inseriscine una nuova")
    nf = b.new_fixture
    if nf.competition not in COMPETITIONS:
        raise HTTPException(400, "Competizione non valida")
    try:
        d = date.fromisoformat(nf.date)
        to_minutes(nf.time)
    except Exception:
        raise HTTPException(400, "Data o orario non validi")
    if d < date.today():
        raise HTTPException(400, "La data è già passata")
    f = nf.dict()
    f["id"] = None
    # se esiste già la stessa partita in calendario, usala
    ex = c.execute("SELECT * FROM fixtures WHERE date=? AND time=? AND lower(venue)=lower(?) "
                   "AND status != 'cancelled'", (nf.date, nf.time, nf.venue)).fetchone()
    if ex:
        b.fixture_id = ex["id"]
        b.new_fixture = None
        return _resolve_fixture(c, b)
    return f, False


@app.post("/api/public/bookings")
def create_booking(b: BookingIn):
    with db() as c:
        s = get_settings(c)
        fixture, other = _resolve_fixture(c, b)
        err = check_capacity(c, fixture)
        if err:
            raise HTTPException(409, err)

        team_name = fixture["home"] if b.side == "home" else fixture["away"]
        team_id = None
        team_code = None
        extra = 0.0
        if b.package == "pack":
            t = c.execute("SELECT * FROM teams WHERE code = ?", (b.team_code.strip().upper(),)).fetchone()
            if not t:
                raise HTTPException(404, "Codice pacchetto non trovato")
            used = c.execute("SELECT COUNT(*) FROM bookings WHERE team_id=? AND status!='cancelled'",
                             (t["id"],)).fetchone()[0]
            if used >= t["credits_total"]:
                raise HTTPException(400, "Il pacchetto non ha più partite disponibili")
            team_id, team_code = t["id"], t["code"]
        elif b.package == "buy_pack":
            team_code = new_code(c, "teams", "SQ-", 5)
            cur = c.execute(
                "INSERT INTO teams(code,name,captain,phone,email,credits_total,price,paid,created_at) "
                "VALUES (?,?,?,?,?,?,?,0,?)",
                (team_code, team_name, b.captain, b.phone, b.email, int(num(s, "pack_size")),
                 num(s, "price_pack"), now()))
            team_id = cur.lastrowid
            extra = 0.0  # il pacchetto si paga a parte (tabella teams)

        if fixture["id"] is None:
            cur = c.execute(
                "INSERT INTO fixtures(date,time,venue,competition,home,away,status,created_by,created_at) "
                "VALUES (?,?,?,?,?,?,'booked','client',?)",
                (fixture["date"], fixture["time"], fixture["venue"].strip(), fixture["competition"],
                 fixture["home"].strip(), fixture["away"].strip(), now()))
            fixture["id"] = cur.lastrowid
        else:
            c.execute("UPDATE fixtures SET status='booked' WHERE id=? AND status='open'", (fixture["id"],))

        pkg = "pack" if b.package in ("pack", "buy_pack") else ("split" if other else "single")
        if pkg == "single" and fixture["competition"] in ("coppa", "playoff"):
            pkg = "cup"
        price = compute_price(s, fixture, other, "pack" if team_id else "single", b.social) + extra
        code = new_code(c, "bookings")
        c.execute(
            "INSERT INTO bookings(code,fixture_id,side,team,captain,phone,email,package,team_id,social,"
            "price,paid,status,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,'pending',?,?)",
            (code, fixture["id"], b.side, team_name, b.captain, b.phone, b.email, pkg, team_id,
             int(b.social), price, b.notes, now()))
        return {"code": code, "price": price, "team_code": team_code,
                "pack_price": num(s, "price_pack") if b.package == "buy_pack" else 0}


@app.get("/api/public/bookings/{code}")
def lookup_booking(code: str):
    with db() as c:
        b = c.execute(
            "SELECT b.*, f.date, f.time, f.venue, f.home, f.away, f.competition, f.status AS fstatus, "
            "f.video_url, f.highlights_url FROM bookings b JOIN fixtures f ON f.id=b.fixture_id "
            "WHERE b.code = ?", (code.strip().upper(),)).fetchone()
        if not b:
            raise HTTPException(404, "Prenotazione non trovata")
        b = dict(b)
        delivered = b["fstatus"] == "delivered" and b["status"] != "cancelled"
        return {
            "code": b["code"], "team": b["team"], "date": b["date"], "time": b["time"],
            "venue": b["venue"], "home": b["home"], "away": b["away"], "competition": b["competition"],
            "package": b["package"], "social": bool(b["social"]), "price": b["price"],
            "paid": bool(b["paid"]), "status": b["status"], "fixture_status": b["fstatus"],
            "video_url": b["video_url"] if delivered else "",
            "highlights_url": b["highlights_url"] if delivered else "",
        }


@app.post("/api/public/survey")
def submit_survey(sv: SurveyIn):
    with db() as c:
        d = sv.dict()
        c.execute(f"INSERT INTO survey({','.join(d)},created_at) VALUES ({','.join('?' * len(d))},?)",
                  (*d.values(), now()))
    return {"ok": True}


# ------------------------------------------------------------------ admin API


@app.post("/api/admin/login")
def admin_login(body: LoginIn):
    if not hmac.compare_digest(body.password, ADMIN_PASSWORD):
        raise HTTPException(401, "Password errata")
    return {"token": make_token()}


@app.get("/api/admin/dashboard")
def admin_dashboard(month: Optional[str] = None, x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    month = month or date.today().isoformat()[:7]
    with db() as c:
        s = get_settings(c)
        usage = month_usage(c, month)
        bk = rows(c.execute(
            "SELECT b.* FROM bookings b JOIN fixtures f ON f.id=b.fixture_id "
            "WHERE b.status!='cancelled' AND substr(f.date,1,7)=?", (month,)))
        packs = rows(c.execute("SELECT * FROM teams WHERE substr(created_at,1,7)=?", (month,)))
        sponsors_total = c.execute("SELECT COALESCE(SUM(amount),0) FROM sponsors").fetchone()[0]
        sponsors_paid = c.execute("SELECT COALESCE(SUM(amount),0) FROM sponsors WHERE paid=1").fetchone()[0]
        revenue = sum(b["price"] for b in bk) + sum(p["price"] for p in packs)
        cashed = sum(b["price"] for b in bk if b["paid"]) + sum(p["price"] for p in packs if p["paid"])
        cost = num(s, "subscription_cost")
        split = sum(1 for b in bk if b["package"] == "split")
        upcoming = rows(c.execute(
            "SELECT f.*, (SELECT COUNT(*) FROM bookings b WHERE b.fixture_id=f.id AND b.status!='cancelled') AS nb "
            "FROM fixtures f WHERE f.date >= ? AND f.status IN ('booked','recorded') ORDER BY f.date, f.time LIMIT 10",
            (date.today().isoformat(),)))
        to_deliver = c.execute("SELECT COUNT(*) FROM fixtures WHERE status='recorded'").fetchone()[0]
        unpaid = c.execute("SELECT COALESCE(SUM(price),0) FROM bookings WHERE paid=0 AND status!='cancelled'").fetchone()[0]
        unpaid += c.execute("SELECT COALESCE(SUM(price),0) FROM teams WHERE paid=0").fetchone()[0]
        survey_n = c.execute("SELECT COUNT(*) FROM survey").fetchone()[0]
        per_fixture = revenue / usage["matches"] if usage["matches"] else 0
        return {
            "month": month, "usage": usage, "bookings": len(bk), "split_bookings": split,
            "revenue": revenue, "cashed": cashed, "cost": cost, "profit": revenue - cost,
            "avg_per_match": per_fixture, "potential": usage["max_matches"] * max(per_fixture, num(s, "price_single")) - cost,
            "sponsors_total": sponsors_total, "sponsors_paid": sponsors_paid,
            "upcoming": upcoming, "to_deliver": to_deliver, "unpaid": unpaid, "survey_count": survey_n,
        }


@app.get("/api/admin/fixtures")
def admin_fixtures(x_admin_token: Optional[str] = Header(None), scope: str = "upcoming"):
    require_admin(x_admin_token)
    with db() as c:
        if scope == "all":
            fx = rows(c.execute("SELECT * FROM fixtures ORDER BY date DESC, time DESC"))
        elif scope == "past":
            fx = rows(c.execute("SELECT * FROM fixtures WHERE date < ? ORDER BY date DESC, time DESC",
                                (date.today().isoformat(),)))
        else:
            fx = rows(c.execute("SELECT * FROM fixtures WHERE date >= ? ORDER BY date, time",
                                (date.today().isoformat(),)))
        for f in fx:
            f["bookings"] = rows(c.execute("SELECT * FROM bookings WHERE fixture_id=? ORDER BY id", (f["id"],)))
        return fx


@app.post("/api/admin/fixtures")
def admin_add_fixtures(items: List[FixtureIn], x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        for f in items:
            if f.competition not in COMPETITIONS:
                raise HTTPException(400, f"Competizione non valida: {f.competition}")
            c.execute("INSERT INTO fixtures(date,time,venue,competition,home,away,notes,status,created_by,created_at) "
                      "VALUES (?,?,?,?,?,?,?,'open','admin',?)",
                      (f.date, f.time, f.venue.strip(), f.competition, f.home.strip(), f.away.strip(), f.notes, now()))
    return {"ok": True, "count": len(items)}


@app.patch("/api/admin/fixtures/{fid}")
def admin_update_fixture(fid: int, u: FixtureUpdate, x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    data = {k: v for k, v in u.dict().items() if v is not None}
    if not data:
        return {"ok": True}
    with db() as c:
        c.execute(f"UPDATE fixtures SET {', '.join(k + '=?' for k in data)} WHERE id=?", (*data.values(), fid))
    return {"ok": True}


@app.delete("/api/admin/fixtures/{fid}")
def admin_delete_fixture(fid: int, x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        if c.execute("SELECT 1 FROM bookings WHERE fixture_id=?", (fid,)).fetchone():
            raise HTTPException(400, "Ci sono prenotazioni: annulla la partita invece di eliminarla")
        c.execute("DELETE FROM fixtures WHERE id=?", (fid,))
    return {"ok": True}


@app.get("/api/admin/bookings")
def admin_bookings(x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        return rows(c.execute(
            "SELECT b.*, f.date, f.time, f.venue, f.home, f.away, f.competition, f.status AS fstatus, "
            "t.code AS team_code FROM bookings b JOIN fixtures f ON f.id=b.fixture_id "
            "LEFT JOIN teams t ON t.id=b.team_id ORDER BY f.date DESC, f.time DESC"))


@app.patch("/api/admin/bookings/{bid}")
def admin_update_booking(bid: int, u: BookingUpdate, x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    data = {k: (int(v) if isinstance(v, bool) else v) for k, v in u.dict().items() if v is not None}
    with db() as c:
        if data:
            c.execute(f"UPDATE bookings SET {', '.join(k + '=?' for k in data)} WHERE id=?", (*data.values(), bid))
        # se tutte le prenotazioni di una partita sono annullate, la partita torna libera
        b = c.execute("SELECT fixture_id FROM bookings WHERE id=?", (bid,)).fetchone()
        if b:
            active = c.execute("SELECT COUNT(*) FROM bookings WHERE fixture_id=? AND status!='cancelled'",
                               (b["fixture_id"],)).fetchone()[0]
            if not active:
                c.execute("UPDATE fixtures SET status='open' WHERE id=? AND status='booked'", (b["fixture_id"],))
    return {"ok": True}


@app.get("/api/admin/teams")
def admin_teams(x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        return rows(c.execute(
            "SELECT t.*, (SELECT COUNT(*) FROM bookings b WHERE b.team_id=t.id AND b.status!='cancelled') AS used "
            "FROM teams t ORDER BY t.created_at DESC"))


@app.post("/api/admin/teams")
def admin_add_team(t: TeamIn, x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        s = get_settings(c)
        code = new_code(c, "teams", "SQ-", 5)
        c.execute("INSERT INTO teams(code,name,captain,phone,email,credits_total,price,paid,created_at) "
                  "VALUES (?,?,?,?,?,?,?,?,?)",
                  (code, t.name, t.captain, t.phone, t.email,
                   t.credits_total if t.credits_total is not None else int(num(s, "pack_size")),
                   t.price if t.price is not None else num(s, "price_pack"), int(t.paid), now()))
    return {"code": code}


@app.patch("/api/admin/teams/{tid}")
def admin_update_team(tid: int, u: TeamUpdate, x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    data = {k: (int(v) if isinstance(v, bool) else v) for k, v in u.dict().items() if v is not None}
    if data:
        with db() as c:
            c.execute(f"UPDATE teams SET {', '.join(k + '=?' for k in data)} WHERE id=?", (*data.values(), tid))
    return {"ok": True}


@app.get("/api/admin/survey")
def admin_survey(x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        return rows(c.execute("SELECT * FROM survey ORDER BY created_at DESC"))


@app.delete("/api/admin/survey/{sid}")
def admin_delete_survey(sid: int, x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        c.execute("DELETE FROM survey WHERE id=?", (sid,))
    return {"ok": True}


@app.get("/api/admin/sponsors")
def admin_sponsors(x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        return rows(c.execute("SELECT * FROM sponsors ORDER BY created_at DESC"))


@app.post("/api/admin/sponsors")
def admin_add_sponsor(sp: SponsorIn, x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        c.execute("INSERT INTO sponsors(name,team,contact,amount,paid,notes,created_at) VALUES (?,?,?,?,?,?,?)",
                  (sp.name, sp.team, sp.contact, sp.amount, int(sp.paid), sp.notes, now()))
    return {"ok": True}


@app.patch("/api/admin/sponsors/{sid}")
def admin_update_sponsor(sid: int, sp: SponsorIn, x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        c.execute("UPDATE sponsors SET name=?,team=?,contact=?,amount=?,paid=?,notes=? WHERE id=?",
                  (sp.name, sp.team, sp.contact, sp.amount, int(sp.paid), sp.notes, sid))
    return {"ok": True}


@app.delete("/api/admin/sponsors/{sid}")
def admin_delete_sponsor(sid: int, x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        c.execute("DELETE FROM sponsors WHERE id=?", (sid,))
    return {"ok": True}


@app.get("/api/admin/settings")
def admin_get_settings(x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        return get_settings(c)


@app.put("/api/admin/settings")
def admin_put_settings(data: dict, x_admin_token: Optional[str] = Header(None)):
    require_admin(x_admin_token)
    with db() as c:
        for k, v in data.items():
            if k in DEFAULT_SETTINGS:
                c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)", (k, str(v)))
    return {"ok": True}
