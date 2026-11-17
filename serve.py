"""Local server for League Layer.

Serves the site on http://localhost:5173 and refreshes NBA data:
  - on start, when data/players.json is missing or older than 6 hours
  - on demand, when the app's "Refresh stats" button calls /api/refresh

`python serve.py 5174` serves on another port (or PORT=5174), so sessions in separate
worktrees can each preview their own copy. A port already in use is refused, never shared.
"""
import http.server
import json
import os
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, 'data', 'players.json')
PORT = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get('PORT', 5173))
lock = threading.Lock()


def refresh():
    with lock:
        r = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'update_data.py')],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        print(r.stdout, r.stderr, flush=True)
        return r.returncode == 0, (r.stdout + r.stderr).strip().splitlines()[-1:]


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
        self.send_error(404)


class Server(http.server.ThreadingHTTPServer):
    # On Windows, address reuse lets a second server take a port that's already serving, and each
    # request then goes to either one: a preview could show another worktree's code. Refuse instead.
    allow_reuse_address = os.name != 'nt'


if __name__ == '__main__':
    try:
        server = Server(('127.0.0.1', PORT), Handler)
    except OSError:
        sys.exit(f'Port {PORT} is in use (another preview?): run on another one, e.g. python serve.py {PORT + 1}')
    stale = not os.path.exists(DATA) or time.time() - os.path.getmtime(DATA) > 6 * 3600
    if stale:
        print('NBA data is missing or stale, refreshing...', flush=True)
        refresh()
    print(f'League Layer running at http://localhost:{PORT}', flush=True)
    server.serve_forever()
