#!/bin/bash
# screen-stop.sh — Stop all ESI screen sessions.

echo "  Stopping ESI screen sessions…"

for name in esi-website-cache esi-website-routes esi-website-gateway; do
    screen -S "$name" -X quit 2>/dev/null && echo "  ✓ $name stopped" || echo "  – $name not running"
done

echo "  Done."
