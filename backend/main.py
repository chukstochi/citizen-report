import hashlib, secrets, shutil, sqlite3, time, uuid
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

DB, UP = "citizen.db", Path("uploads")
UP.mkdir(exist_ok=True)
CATEGORIES = ["Accident", "Fighting", "Rioting", "Robbery", "Fire", "Flooding", "Other"]

app = FastAPI(title="Citizen Report API")
# open for testing; restrict allow_origins before going live
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/uploads", StaticFiles(directory=UP), name="uploads")


def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c


def hash_pw(pw: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 200_000).hex()


with db() as c:
    c.executescript("""
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, salt TEXT, pw TEXT);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INT);
    CREATE TABLE IF NOT EXISTS incidents(id INTEGER PRIMARY KEY, user_id INT, title TEXT, category TEXT, description TEXT,
        photo TEXT, lat REAL, lng REAL, status TEXT DEFAULT 'Received', created REAL);
    """)
    if not c.execute("SELECT 1 FROM users WHERE username='demo'").fetchone():
        s = secrets.token_hex(8)
        c.execute("INSERT INTO users(username,salt,pw) VALUES(?,?,?)", ("demo", s, hash_pw("demo1234", s)))


with db() as c:  # sample reports so the app never looks empty (delete these rows if you do not want them)
    if not c.execute("SELECT 1 FROM incidents").fetchone():
        uid = c.execute("SELECT id FROM users WHERE username='demo'").fetchone()[0]
        for i, (t, cat, d, la, ln) in enumerate([
            ("Two-vehicle collision at the junction", "Accident", "Two cars collided. Traffic is backing up, one driver needs help.", 6.5244, 3.3792),
            ("Street fight outside the market", "Fighting", "A crowd has gathered and the fight is spreading.", 6.5300, 3.3650),
            ("Protesters blocking the main road", "Rioting", "Road is blocked in both directions. Avoid the area.", 6.5150, 3.3900),
            ("Fire at a roadside kiosk", "Fire", "Smoke is visible. Fire service has not arrived yet.", 6.5400, 3.3500)]):
            c.execute("INSERT INTO incidents(user_id,title,category,description,lat,lng,created) VALUES(?,?,?,?,?,?,?)",
                      (uid, t, cat, d, la, ln, time.time() - (i + 1) * 5400))


class Creds(BaseModel):
    username: str
    password: str


def session(c, uid: int) -> str:
    t = secrets.token_hex(24)
    c.execute("INSERT INTO sessions(token,user_id) VALUES(?,?)", (t, uid))
    return t


def current(authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip()
    with db() as c:
        row = c.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?", (token,)).fetchone()
    if not row:
        raise HTTPException(401, "Please log in again.")
    return row


@app.post("/register")
def register(b: Creds):
    name = b.username.strip().lower()
    if len(name) < 3 or len(b.password) < 6:
        raise HTTPException(400, "Username needs 3+ characters and password 6+.")
    with db() as c:
        if c.execute("SELECT 1 FROM users WHERE username=?", (name,)).fetchone():
            raise HTTPException(400, "That username is taken.")
        s = secrets.token_hex(8)
        uid = c.execute("INSERT INTO users(username,salt,pw) VALUES(?,?,?)", (name, s, hash_pw(b.password, s))).lastrowid
        return {"token": session(c, uid)}


@app.post("/login")
def login(b: Creds):
    with db() as c:
        u = c.execute("SELECT * FROM users WHERE username=?", (b.username.strip().lower(),)).fetchone()
        if not u or hash_pw(b.password, u["salt"]) != u["pw"]:
            raise HTTPException(401, "Wrong username or password.")
        return {"token": session(c, u["id"])}


@app.get("/categories")
def categories():
    return CATEGORIES


def rows(where: str = "", args: tuple = ()):
    with db() as c:
        r = c.execute(f"SELECT i.*, u.username AS author FROM incidents i JOIN users u ON u.id=i.user_id {where} ORDER BY i.created DESC LIMIT 100", args).fetchall()
    return [dict(x) for x in r]


@app.get("/incidents")
def incidents(category: str = "", after: int = 0):
    w, a = [], []
    if category:
        w.append("i.category=?"); a.append(category)
    if after:
        w.append("i.id>?"); a.append(after)  # used by the app to check for new incidents
    return rows("WHERE " + " AND ".join(w) if w else "", tuple(a))


@app.get("/incidents/mine")
def mine(user=Depends(current)):
    return rows("WHERE i.user_id=?", (user["id"],))


@app.post("/incidents")
def add_incident(title: str = Form(...), category: str = Form(...), description: str = Form(""),
                 lat: Optional[float] = Form(None), lng: Optional[float] = Form(None),
                 photo: Optional[UploadFile] = File(None), user=Depends(current)):
    if category not in CATEGORIES:
        raise HTTPException(400, "Unknown category.")
    name = None
    if photo and photo.filename:
        ext = Path(photo.filename).suffix.lower()
        if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
            raise HTTPException(400, "Use a JPG, PNG or WEBP photo.")
        name = f"{uuid.uuid4().hex}{ext}"
        with open(UP / name, "wb") as out:
            shutil.copyfileobj(photo.file, out)
    with db() as c:
        c.execute("INSERT INTO incidents(user_id,title,category,description,photo,lat,lng,created) VALUES(?,?,?,?,?,?,?,?)",
                  (user["id"], title.strip(), category, description.strip(), name, lat, lng, time.time()))
    return {"ok": True}

    if __name__ == "__main__":
    import os, uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
