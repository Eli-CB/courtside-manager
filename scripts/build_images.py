"""Build player headshots and team logos for Courtside Manager.

Packs them into files that ship with the site, so a visit downloads one cached
sprite instead of hundreds of separate images:
  data/headshots.webp  one sprite sheet with every active player's headshot
  data/images.json     where each player sits in the sprite, plus team logos

Run after scripts/update_data.py (it reads data/players.json):
  python scripts/build_images.py
Needs Pillow (python -m pip install pillow).
"""
import base64
import concurrent.futures
import io
import json
import math
import os
import sys
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Referer': 'https://www.nba.com/',
}
SIZE = 80   # px per headshot in the sprite (shown at up to 40px, so sharp on high-DPI screens)
COLS = 24


def fetch(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=30) as r:
            return r.read()
    except Exception:
        return None


def headshot(pid):
    raw = fetch(f'https://cdn.nba.com/headshots/nba/latest/260x190/{pid}.png')
    if not raw:
        return None
    try:
        img = Image.open(io.BytesIO(raw)).convert('RGBA')
    except Exception:
        return None
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    return img.crop((left, 0, left + side, side)).resize((SIZE, SIZE), Image.LANCZOS)


def main():
    with open(os.path.join(DATA, 'players.json'), encoding='utf-8') as f:
        players = json.load(f)['players']

    ids = [p['id'] for p in players]
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        shots = list(pool.map(headshot, ids))
    got = [(pid, img) for pid, img in zip(ids, shots) if img is not None]
    print(f'headshots: {len(got)}/{len(ids)}')

    rows = math.ceil(len(got) / COLS)
    sheet = Image.new('RGBA', (COLS * SIZE, rows * SIZE), (0, 0, 0, 0))
    for i, (_, img) in enumerate(got):
        sheet.paste(img, ((i % COLS) * SIZE, (i // COLS) * SIZE), img)
    sheet.save(os.path.join(DATA, 'headshots.webp'), 'WEBP', quality=80, method=6)

    teams = {}
    for p in players:
        if p.get('team') and p.get('tid'):
            teams[p['team']] = p['tid']
    logos = {}
    for tri, tid in sorted(teams.items()):
        svg = fetch(f'https://cdn.nba.com/logos/nba/{tid}/primary/L/logo.svg')
        if svg and b'<svg' in svg[:2000]:
            logos[tri] = 'data:image/svg+xml;base64,' + base64.b64encode(svg).decode()
    print(f'logos: {len(logos)}/{len(teams)}')

    with open(os.path.join(DATA, 'images.json'), 'w', encoding='utf-8') as f:
        json.dump({'size': SIZE, 'cols': COLS, 'ids': [pid for pid, _ in got], 'logos': logos}, f, separators=(',', ':'))
    for name in ('headshots.webp', 'images.json'):
        print(name, os.path.getsize(os.path.join(DATA, name)) // 1024, 'KB')


if __name__ == '__main__':
    sys.exit(main())
