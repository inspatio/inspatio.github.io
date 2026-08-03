#!/usr/bin/env bash
# Copyright (c) 2026 Inspatio. All rights reserved.
#
# This software and its associated documentation are proprietary to Inspatio.
# Unauthorized copying, modification, distribution, or use is prohibited
# without prior written permission from Inspatio.


set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="/root/miniconda3/envs/querysplat/bin/python"
PORT="${2:-8000}"
PID_FILE="$PROJECT_DIR/.localview.pid"
LOG_FILE="$PROJECT_DIR/.localview.log"

usage() {
  echo "Usage: $0 {start|stop|status} [port]"
}

is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(<"$PID_FILE")" 2>/dev/null
}

case "${1:-}" in
  start)
    if is_running; then
      echo "Preview server is already running (PID $(<"$PID_FILE")): http://127.0.0.1:$PORT"
      exit 0
    fi

    rm -f "$PID_FILE"
    cd "$PROJECT_DIR"
    nohup "$PYTHON_BIN" -m http.server "$PORT" --bind 127.0.0.1 >"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
    sleep 1

    if is_running; then
      echo "Preview server started (PID $(<"$PID_FILE")): http://127.0.0.1:$PORT"
      echo "Log: $LOG_FILE"
    else
      echo "Preview server failed to start. Check: $LOG_FILE" >&2
      exit 1
    fi
    ;;
  stop)
    if is_running; then
      kill "$(<"$PID_FILE")"
      rm -f "$PID_FILE"
      echo "Preview server stopped."
    else
      rm -f "$PID_FILE"
      echo "Preview server is not running."
    fi
    ;;
  status)
    if is_running; then
      echo "Preview server is running (PID $(<"$PID_FILE"))."
    else
      rm -f "$PID_FILE"
      echo "Preview server is not running."
    fi
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
