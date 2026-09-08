#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

LOG_DIR="results/flow-verify-batch"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
LOG="$LOG_DIR/${STAMP}-multi-env-golden.log"
SUMMARY="$LOG_DIR/${STAMP}-summary.json"

echo "log=$LOG" | tee "$LOG"
echo "[" > "$SUMMARY"

runs=(
  "request-flow:dev"
  "request-flow:uat"
  "request-flow:stage9084"
  "approval-flow:dev"
  "approval-flow:uat"
  "approval-flow:stage9084"
)

first=1
for item in "${runs[@]}"; do
  flow="${item%%:*}"
  env="${item##*:}"
  export PLAYWRIGHT_ENV="$env"
  echo "" | tee -a "$LOG"
  echo "========== $flow @ $env $(date -u +%H:%M:%S)Z ==========" | tee -a "$LOG"

  golden_code=0
  cmp_code=0
  bitable_line=""

  if ! npm run "${flow}:golden" -- --env="$env" 2>&1 | tee -a "$LOG"; then
    golden_code=1
  fi

  if ! PLAYWRIGHT_ENV="$env" npm run compare-flow-screenshots 2>&1 | tee -a "$LOG"; then
    cmp_code=1
  fi

  if [[ -f results/feishu-bitable-record.json ]]; then
    bitable_line="$(node -e "const j=require('./results/feishu-bitable-record.json'); console.log(JSON.stringify({executionId:j.executionId,runRecordUrl:j.runRecordUrl,skipped:j.skipped}))")"
  fi

  sep=""
  if [[ $first -eq 0 ]]; then sep=","; fi
  first=0
  printf '%s{"flow":"%s","env":"%s","goldenExit":%s,"compareExit":%s,"bitable":%s}\n' \
    "$sep" "$flow" "$env" "$golden_code" "$cmp_code" "${bitable_line:-null}" >> "$SUMMARY"

done

echo "]" >> "$SUMMARY"
echo "summary=$SUMMARY" | tee -a "$LOG"
