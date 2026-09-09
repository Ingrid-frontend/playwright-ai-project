#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DESKTOP_SHORTCUT=0
for arg in "$@"; do
  case "$arg" in
    --desktop-shortcut) DESKTOP_SHORTCUT=1 ;;
    -h|--help)
      cat <<'EOF'
用法: ./install.sh [选项]

  --desktop-shortcut   macOS 在桌面创建 Playwright Studio 快捷方式
  -h, --help           显示帮助

安装内容:
  - 检查 Node.js 18+
  - npm install（项目根 + pw-files）
  - Playwright Chromium 浏览器
  - 从 .env.example / accounts.json.example 生成配置模板
EOF
      exit 0
      ;;
    *)
      echo "未知参数: $arg（可用 --help）"
      exit 1
      ;;
  esac
done

log() { printf '%s\n' "$*"; }
ok() { log "✅ $*"; }
warn() { log "⚠️  $*"; }
fail() { log "❌ $*"; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "未找到 $1，请先安装: https://nodejs.org/（需要 Node 18+）"
}

copy_if_missing() {
  local src="$1"
  local dest="$2"
  local hint="$3"
  if [[ -f "$dest" ]]; then
    ok "已存在 $(basename "$dest")"
    return
  fi
  if [[ ! -f "$src" ]]; then
    warn "跳过 $(basename "$dest")：模板 $src 不存在"
    return
  fi
  cp "$src" "$dest"
  ok "已创建 $(basename "$dest")（$hint）"
}

log ""
log "🎭 Playwright AI — 本地安装"
log "   目录: $ROOT"
log ""

need_cmd node
need_cmd npm

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  fail "需要 Node 18+，当前: $(node -v)"
fi
ok "Node $(node -v)"

log ""
log "📦 安装依赖（项目根）..."
npm install

log ""
log "📦 安装依赖（pw-files / Studio）..."
npm install --prefix "$ROOT/pw-files"

log ""
log "🌐 安装 Playwright Chromium..."
npx playwright install chromium
if [[ -d "$ROOT/pw-files/node_modules/@playwright/test" ]]; then
  npm exec --prefix "$ROOT/pw-files" -- playwright install chromium
fi

log ""
log "📝 初始化配置..."
copy_if_missing "$ROOT/.env.example" "$ROOT/.env" "请编辑账号、API Key、飞书等"
copy_if_missing "$ROOT/datasource/accounts.json.example" "$ROOT/datasource/accounts.json" "请填写各环境测试账号"

chmod +x "$ROOT/start-studio.sh"

log ""
log "🔍 运行初始化检查..."
if npm run setup; then
  ok "初始化检查通过"
else
  warn "初始化检查有告警，可按提示手动处理"
fi

if [[ "$DESKTOP_SHORTCUT" -eq 1 ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    DESK="$HOME/Desktop/Playwright Studio.command"
    cat >"$DESK" <<EOF
#!/bin/bash
cd "$ROOT"
exec ./start-studio.sh
EOF
    chmod +x "$DESK"
    ok "桌面快捷方式: $DESK"
  else
    warn "--desktop-shortcut 仅支持 macOS"
  fi
fi

log ""
log "✅ 安装完成"
log ""
log "下一步:"
log "  1. 编辑 .env 与 datasource/accounts.json（如尚未配置）"
log "  2. 启动 Studio:  ./start-studio.sh"
log "  3. 或: npm run studio"
log ""
if [[ "$DESKTOP_SHORTCUT" -eq 0 && "$(uname -s)" == "Darwin" ]]; then
  log "提示: 可在桌面创建快捷方式 — ./install.sh --desktop-shortcut"
  log ""
fi
