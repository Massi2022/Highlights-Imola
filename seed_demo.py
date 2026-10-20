"""Popola il database con partite e dati di esempio del CSI Imola Calcio a 7."""
from datetime import date, timedelta
from app import db, init_db, now

def seed():
    init_db()
    with db() as c:
        if c.execute("SELECT COUNT(*) FROM fixtures").fetchone()[0] > 0:
            print("Database già popolato.")
            return

        today = date.today()
        d1 = (today + timedelta(days=2)).isoformat()
        d2 = (today + timedelta(days=4)).isoformat()
        d3 = (today + timedelta(days=7)).isoformat()
        d4 = (today + timedelta(days=9)).isoformat()

        fixtures = [
            # Serata doppia sullo stesso campo (Tozzona) -> ottimizzazione logistica!
            (d1, "20:30", "Tozzona", "campionato", "Tossani", "Pizzeria Derby", "booked"),
            (d1, "21:30", "Tozzona", "campionato", "Real Imola", "Atletico Zolino", "open"),
            # Altra serata (Zolino)
            (d2, "20:30", "Zolino", "campionato", "Bar Centrale FC", "Sasso Morelli ASD", "open"),
            (d2, "21:30", "Zolino", "campionato", "Ponticelli United", "Amatori Santerno", "open"),
            # Coppa
            (d3, "21:00", "Sasso Morelli", "coppa", "Tossani", "Bar Centrale FC", "open"),
            # Stadio Galli
            (d4, "20:45", "Stadio Galli", "campionato", "Pizzeria Derby", "Real Imola", "open"),
        ]
        for dt, tm, vn, comp, h, a, st in fixtures:
            c.execute(
                "INSERT INTO fixtures(date,time,venue,competition,home,away,status,created_by,created_at) "
                "VALUES (?,?,?,?,?,?,?,'admin',?)",
                (dt, tm, vn, comp, h, a, st, now()),
            )

        # Una prenotazione già attiva sulla prima partita (così si vede lo Split Bill a 15€ per Pizzeria Derby!)
        fid = c.execute("SELECT id FROM fixtures WHERE home='Tossani' AND away='Pizzeria Derby'").fetchone()[0]
        c.execute(
            "INSERT INTO bookings(code,fixture_id,side,team,captain,phone,email,package,social,price,paid,status,notes,created_at) "
            "VALUES ('DEMO01',?,'home','Tossani','Marco Rossi','3331234567','marco@example.com','single',1,40,1,'confirmed','Vogliamo il reel con musica carica!',?)",
            (fid, now()),
        )

        # Un pacchetto 5 partite di esempio
        c.execute(
            "INSERT INTO teams(code,name,captain,phone,email,credits_total,price,paid,created_at) "
            "VALUES ('SQ-DERBY','Pizzeria Derby','Luca Bianchi','3339876543','luca@example.com',5,100,1,?)",
            (now(),),
        )

        # Risposte sondaggio di esempio
        surveys = [
            ("Tossani", "Capitano", "Marco Rossi", "3331234567", "si_attiva", "vorremmo", 5, "gol_social", "B", "si", "Carrozzeria Imolese", "Super idea!"),
            ("Pizzeria Derby", "Dirigente / Presidente", "Luca Bianchi", "3339876543", "si_ferma", "poco", 4, "gol_social", "A", "forse", "Pizzeria Derby", ""),
            ("Real Imola", "Capitano", "Andrea Verdi", "3335554433", "no", "zero", 5, "partita", "B", "no", "Bar Sport", "Chiamatemi per la partita di prova"),
        ]
        for s in surveys:
            c.execute(
                "INSERT INTO survey(team,role,name,phone,has_social,posting_time,interest,favorite,option,social_addon,sponsor,notes,created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (*s, now()),
            )

        # Sponsor di esempio
        c.execute(
            "INSERT INTO sponsors(name,team,contact,amount,paid,notes,created_at) "
            "VALUES ('Pizzeria Derby','Pizzeria Derby','Luca 3339876543',120,1,'Logo in alto a destra su tutti gli highlights',?)",
            (now(),),
        )
        print("Dati di esempio inseriti con successo!")

if __name__ == "__main__":
    seed()
