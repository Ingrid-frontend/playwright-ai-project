#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-3001}"
URL="http://localhost:${PORT}"
STUDIO_DIR="$ROOT/pw-files"
PID_FILE="$ROOT/.studio-server.pid"
OPEN_BROWSER="${OPEN_BROWSER:-1}"

log() { printf '%s\n' "$*"; }
warn() { log "⚠️  $*"; }
fail() { log "❌ $*"; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_BROWSER=0 ;;
    -h|--help)
      cat <<'EOF'
用法: ./start-studio.sh [选项]

  --no-open   不自动打开浏览器
  -h, --help  显示帮助

环境变量:
  PORT=3001           Studio 端口（默认 3001）
  OPEN_BROWSER=0|1    是否自动打开浏览器（默认 1）
EOF
      exit 0
      ;;
    *)
      fail "未知参数: $arg（可用 --help）"
      ;;
  esac
done

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    fail "未找到 Node.js，请先运行: ./install.sh"
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" -lt 18 ]]; then
    fail "需要 Node 18+，当前: $(node -v)"
  fi
}

need_deps() {
  if [[ ! -d "$ROOT/node_modules" || ! -d "$STUDIO_DIR/node_modules" ]]; then
    fail "依赖未安装，请先运行: ./install.sh"
  fi
}

port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z localhost "$PORT" >/dev/null 2>&1
    return
  fi
  return 1
}

wait_ready() {
  local i=0
  while [[ "$i" -lt 60 ]]; do
    if command -v curl >/dev/null 2>&1 && curl -fsS "$URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
    i=$((i + 1))
  done
  return 1
}

open_url() {
  [[ "$OPEN_BROWSER" == "1" ]] || return 0
  case "$(uname -s)" in
    Darwin) open "$URL" ;;
    Linux)
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL" >/dev/null 2>&1 || true
      else
        warn "未找到 xdg-open，请手动打开: $URL"
      fi
      ;;
    *)
      warn "请手动打开: $URL"
      ;;
  esac
}

stop_server() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
}

cleanup() {
  stop_server
}
trap cleanup EXIT INT TERM

need_node
need_deps

if port_busy; then
  log ""
  log "🎭 Playwright Studio 已在运行"
  log "   $URL"
  log ""
  open_url
  exit 0
fi

export PLAYWRIGHT_REPO_ROOT="$ROOT"
export PORT

log ""
log "🎭 启动 Playwright Studio..."
log "   $URL"
log "   按 Ctrl+C 停止"
log ""

cd "$STUDIO_DIR"
node server.js &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"

if wait_ready; then
  open_url
else
  warn "服务启动较慢，请稍后手动打开: $URL"
fi

wait "$SERVER_PID"
