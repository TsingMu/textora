#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="textora"
BUNDLE_ID="com.tsingmu.textora"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUST_ENV="${CARGO_HOME:-${HOME}/.cargo}/env"

if [[ -f "$RUST_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$RUST_ENV"
fi

cd "$ROOT_DIR"
pkill -x "$APP_NAME" >/dev/null 2>&1 || true

wait_for_app() {
  local attempt
  for attempt in {1..60}; do
    if pgrep -x "$APP_NAME" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "$APP_NAME did not start within 60 seconds" >&2
  return 1
}

build_debug_binary() {
  npm run tauri -- build --debug --no-bundle
}

case "$MODE" in
  run)
    npm run tauri -- dev
    ;;
  --debug|debug)
    build_debug_binary
    lldb -- "$ROOT_DIR/src-tauri/target/debug/$APP_NAME"
    ;;
  --logs|logs)
    npm run tauri -- dev --no-watch &
    wait_for_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    npm run tauri -- dev --no-watch &
    wait_for_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    npm run tauri -- dev --no-watch &
    wait_for_app
    echo "$APP_NAME is running"
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
