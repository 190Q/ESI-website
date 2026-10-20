#!/bin/bash
# browser-guard.sh - Safety net against runaway headless browsers.
#
# Two failure modes, both seen on this box:
#   1. a renderer process dies (restart, OOM kill, crash) and leaves its
#      Chromium and Playwright driver behind, reparented to init. Over days
#      those orphans added up to 200+ chrome processes and took the VPS down.
#   2. a bug launches a browser per request instead of reusing one.
#
# Orphans are always reaped. Anything beyond the cap is treated as a leak and
# killed wholesale; the renderers relaunch a browser on the next card.
set -u

LIMIT=12
LOG=/home/debian/ESI-website/logs/browser-guard.log
PATTERN='chrome-headless-shell|playwright/driver'

reap_orphans() {
    local pid ppid killed=0
    for pid in $(pgrep -f "$PATTERN" 2>/dev/null); do
        ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
        if [ "$ppid" = "1" ]; then
            kill "$pid" 2>/dev/null && killed=$((killed + 1))
        fi
    done
    if [ "$killed" -gt 0 ]; then
        echo "$(date -u '+%Y-%m-%d %H:%M:%S') reaped $killed orphaned browser process(es)" >> "$LOG"
    fi
}

reap_orphans

count=$(pgrep -c -f chrome-headless-shell 2>/dev/null || true)
count=${count:-0}

if [ "$count" -le "$LIMIT" ]; then
    exit 0
fi

echo "$(date -u '+%Y-%m-%d %H:%M:%S') chrome-headless processes: $count (limit $LIMIT), killing them" >> "$LOG"
pkill -f chrome-headless-shell 2>/dev/null || true
pkill -f 'playwright/driver' 2>/dev/null || true
