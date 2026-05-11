#!/bin/bash
# screen-logs.sh - Live filtered log monitor for ESI services.
# Runs inside the esi-website-logs screen session.
#
#   screen -r esi-website-logs   Attach to view
#   Ctrl+A D                     Detach without stopping
#
# Can also be run directly:  ./screen-logs.sh

DIR="$HOME/ESI-website"
LOG_DIR="$DIR/logs"

GATEWAY_LOG="$LOG_DIR/esi-website-gateway.log"
ROUTES_LOG="$LOG_DIR/esi-website-routes.log"

show_help() {
    cat <<'EOF'
screen-logs.sh - Live filtered log monitor for ESI services.

Shows only important output (errors, security events, startup info).
Filters out routine HTTP request logs and werkzeug boilerplate.

Attach to the monitor screen:
  screen -r esi-website-logs

Or run directly:  ./screen-logs.sh
Stop with:        Ctrl+C
EOF
}

case "${1:-}" in
    -h|--help) show_help; exit 0 ;;
esac

# ANSI colors (real escape bytes via $'…')
RST=$'\033[0m'
BLD=$'\033[1m'
DIM=$'\033[2m'
RED=$'\033[91m'
YLW=$'\033[93m'
GRN=$'\033[92m'
CYN=$'\033[96m'
MAG=$'\033[95m'

# Noise filters
# Werkzeug HTTP access log:  "IP - - [DD/Mon/YYYY …"
ACCESS_LOG='- - \[[0-9]{2}/[A-Za-z]{3}/[0-9]{4} '
# Werkzeug boilerplate printed every startup
BOILERPLATE='WARNING: This is a development server|Use a production WSGI server|^ \* Debug mode:|^ \* Serving Flask app'

# Header
clear
printf "\n"
printf "  %sESI Service Monitor%s\n" "$BLD" "$RST"
printf "  %s─────────────────────────────────────%s\n" "$DIM" "$RST"
printf "  %sDetach: Ctrl+A D  │  Stop: Ctrl+C%s\n" "$DIM" "$RST"
printf "  %s─────────────────────────────────────%s\n" "$DIM" "$RST"
printf "\n"

# Wait for log files to appear (services may still be booting)
for f in "$GATEWAY_LOG" "$ROUTES_LOG"; do
    i=0
    while [ ! -f "$f" ] && [ $i -lt 15 ]; do
        sleep 1
        i=$((i + 1))
    done
    [ ! -f "$f" ] && touch "$f"
done

# Format a single log line with service label + severity color
format_line() {
    local label="$1" color="$2" line="$3"
    local sev=""

    case "$line" in
        *ERROR*|*CRASHED*|*Traceback*|*Exception*|*ailed*)
            sev="$RED" ;;
        *IP-BAN*|*SECURITY*)
            sev="$YLW" ;;
        *AUTH*|*APP*|*WARNING*|*Warning*|*warning*)
            sev="$MAG" ;;
        *✓*|*"permissions look good"*|*"Running on"*|*http://*|*"Press Ctrl"*)
            sev="$GRN" ;;
    esac

    if [ -n "$sev" ]; then
        printf "  %s%s[%s]%s %s%s%s\n" "$color" "$BLD" "$label" "$RST" "$sev" "$line" "$RST"
    else
        printf "  %s%s[%s]%s %s\n" "$color" "$BLD" "$label" "$RST" "$line"
    fi
}

# Tail both logs — filter noise, format, merge on screen
tail -n 100 -f "$GATEWAY_LOG" 2>/dev/null | \
    grep --line-buffered -vE -- "$ACCESS_LOG" | \
    grep --line-buffered -vE -- "$BOILERPLATE" | \
    grep --line-buffered -vE -- '^\s*$' | \
    while IFS= read -r line; do
        format_line "GATEWAY" "$CYN" "$line"
    done &

tail -n 100 -f "$ROUTES_LOG" 2>/dev/null | \
    grep --line-buffered -vE -- "$ACCESS_LOG" | \
    grep --line-buffered -vE -- "$BOILERPLATE" | \
    grep --line-buffered -vE -- '^\s*$' | \
    while IFS= read -r line; do
        format_line "ROUTES" "$MAG" "$line"
    done &

wait

# If we get here both tails died — keep screen alive so user sees the error
printf "\n  %sLog monitor stopped. Press Enter to close.%s\n" "$RED" "$RST"
read
