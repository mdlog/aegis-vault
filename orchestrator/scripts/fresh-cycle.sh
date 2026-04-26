#!/usr/bin/env bash
#
# fresh-cycle.sh — reset the orchestrator to a clean cycle state.
#
#   Use this AFTER a fresh deploy (deploy-fresh-mainnet.js) so the
#   orchestrator stops tracking V2-stack vault state and re-indexes from
#   the new V3 factory. The audit trail (journal.json) and append-only
#   log files are preserved by default.
#
#   What gets reset:
#     - data/kv-state.json              (last cycle snapshot — vault, NAV,
#                                        last signal, position state)
#     - data/vault-index.json           (vault list + lastIndexedBlock —
#                                        rebuilt from V3 factory events)
#     - data/tmp/*                      (in-flight decision/execution scratch)
#
#   What is preserved:
#     - data/journal.json               (immutable execution history)
#     - logs/orchestrator.jsonl         (append-only structured log)
#     - logs/orchestrator.stdout.log    (raw stdout)
#
#   Files removed are first backed up to data/.fresh-cycle-backup-<ts>/
#   so a botched reset can be rolled back manually.
#
#   Usage:
#     cd orchestrator
#     ./scripts/fresh-cycle.sh
#     # then: pm2 start aegis-orchestrator   (or however you run it)

set -euo pipefail

ORCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ORCH_DIR/data"

if [[ ! -d "$DATA_DIR" ]]; then
  echo "no data/ directory under $ORCH_DIR — nothing to reset"
  exit 0
fi

ts=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$DATA_DIR/.fresh-cycle-backup-$ts"
mkdir -p "$backup_dir"

echo "─────────────────────────────────────────────────────────────"
echo "Aegis orchestrator — fresh cycle reset"
echo "  data dir: $DATA_DIR"
echo "  backup:   $backup_dir"
echo "─────────────────────────────────────────────────────────────"

# 1. kv-state.json
if [[ -f "$DATA_DIR/kv-state.json" ]]; then
  cp "$DATA_DIR/kv-state.json" "$backup_dir/kv-state.json"
  rm "$DATA_DIR/kv-state.json"
  echo "  ✓ kv-state.json          backed up + removed"
else
  echo "  - kv-state.json          (not present)"
fi

# 2. vault-index.json
if [[ -f "$DATA_DIR/vault-index.json" ]]; then
  cp "$DATA_DIR/vault-index.json" "$backup_dir/vault-index.json"
  rm "$DATA_DIR/vault-index.json"
  echo "  ✓ vault-index.json       backed up + removed"
else
  echo "  - vault-index.json       (not present)"
fi

# 3. tmp/ scratch dir
if [[ -d "$DATA_DIR/tmp" ]]; then
  count=$(find "$DATA_DIR/tmp" -maxdepth 1 -type f 2>/dev/null | wc -l)
  if [[ $count -gt 0 ]]; then
    mkdir -p "$backup_dir/tmp"
    mv "$DATA_DIR/tmp"/* "$backup_dir/tmp/" 2>/dev/null || true
    echo "  ✓ tmp/                   $count files moved to backup"
  else
    echo "  - tmp/                   (already empty)"
  fi
fi

echo ""
echo "Preserved (audit trail):"
[[ -f "$DATA_DIR/journal.json" ]] && echo "  • journal.json           ($(wc -l < "$DATA_DIR/journal.json" 2>/dev/null || echo "?") lines)"

echo ""
echo "Next steps:"
echo "  1. Confirm DEPLOYMENTS_FILE=../contracts/deployments-mainnet.json"
echo "     in orchestrator/.env points at the post-fresh-deploy file."
echo "  2. Restart the orchestrator:"
echo "       pm2 start aegis-orchestrator"
echo "       (or: npm start)"
echo "  3. Watch the log for the 'Vault indexer ready — N cached vault(s)'"
echo "     line — N should be 0 right after reset, growing as new V3"
echo "     factory events are indexed."
echo "  4. To roll back: copy files from $backup_dir/ back to $DATA_DIR/"
