"""Local server for Courtside Manager.

Serves the site on http://localhost:5173 and refreshes NBA data:
  - on start, when data/players.json is missing or older than 6 hours
  - on demand, when the app's "Refresh stats" button calls /api/refresh
  - when you connect a Fantrax league in Settings (/api/league)
"""
import http.server
import json
import os
import re
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, 'data', 'players.json')
LEAGUE_CFG = os.path.join(ROOT, 'league.json')
PORT = int(os.environ.get('PORT', 5173))
lock = threading.Lock()


def refresh():
    with lock:
        r = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'update_data.py')],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        print(r.stdout, r.stderr, flush=True)
        return r.returncode == 0, (r.stdout + r.stderr).strip().splitlines()[-1:]


def connect_league(league_id):
    """Save a Fantrax league ID, re-pull the data, and confirm the league loaded."""
    if not re.fullmatch(r'[A-Za-z0-9]{6,32}', league_id or ''):
        return False, "That doesn't look like a Fantrax league ID (letters and numbers only)."
    previous = None
    if os.path.exists(LEAGUE_CFG):
        with open(LEAGUE_CFG, encoding='utf-8') as f:
            previous = f.read()
    with open(LEAGUE_CFG, 'w', encoding='utf-8') as f:
        json.dump({'fantraxLeagueId': league_id}, f, indent=2)
    ok, _ = refresh()
    league = None
    if ok and os.path.exists(DATA):
        with open(DATA, encoding='utf-8') as f:
            league = json.load(f).get('league')
    if league and league.get('id') == league_id and league.get('teams'):
        return True, f"Connected to {league.get('name') or 'your league'}."
    # put the old league back so the app keeps working
    if previous is not None:
        with open(LEAGUE_CFG, 'w', encoding='utf-8') as f:
            f.write(previous)
        refresh()
    return False, "Fantrax didn't return that league. Check the ID in your league's URL."


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def reply(self, ok, message):
        body = json.dumps({'ok': ok, 'message': message}).encode()
        self.send_response(200 if ok else 400)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == '/api/refresh':
            ok, msg = refresh()
            return self.reply(ok, msg[0] if msg else '')
        if self.path == '/api/league':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                data = json.loads(self.rfile.read(min(length, 10_000)) or b'{}')
            except (ValueError, json.JSONDecodeError):
                return self.reply(False, 'Bad request.')
            return self.reply(*connect_league(str(data.get('leagueId', '')).strip()))
        self.send_error(404)


if __name__ == '__main__':
    stale = not os.path.exists(DATA) or time.time() - os.path.getmtime(DATA) > 6 * 3600
    if stale:
        print('NBA data is missing or stale, refreshing...', flush=True)
        refresh()
    print(f'Courtside Manager running at http://localhost:{PORT}', flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
