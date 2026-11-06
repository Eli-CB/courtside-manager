#!/usr/bin/env bash
# The daily job's headshots step, for one sport: rebuild on the 1st of the month, when asked, or when more than 5 players
# (new signings, call-ups) have no headshot yet.
#   scripts/refresh_images.sh [nhl|nfl] [true to force]
set -euo pipefail
sport="${1:-}"
force="${2:-false}"
data="data${sport:+/$sport}"

missing=$(python - "$data" <<'PY'
import json, os, sys
data = sys.argv[1]
players = {p['id'] for p in json.load(open(f'{data}/players.json', encoding='utf-8'))['players']}
index = f'{data}/images.json'
have = set(json.load(open(index, encoding='utf-8'))['ids']) if os.path.exists(index) else set()
print(len(players - have))
PY
)
echo "${sport:-nba}: $missing players without a headshot"
if [ "$force" = "true" ] || [ "$(date -u +%d)" = "01" ] || [ "$missing" -gt 5 ]; then
  python -m pip install --quiet pillow
  python scripts/build_images.py $sport
else
  echo "Skipping images today"
fi
