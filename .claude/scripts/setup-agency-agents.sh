#!/usr/bin/env bash
# Installs the msitarzewski/agency-agents roster into Claude Code's agents dir.
# Runs on SessionStart so ephemeral containers get the agents on every session.
set -euo pipefail

REPO_URL="https://github.com/msitarzewski/agency-agents"
CACHE_DIR="${AGENCY_AGENTS_DIR:-$HOME/.cache/agency-agents}"
AGENTS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agents"

# Already populated (warm container, or a previous run) -- nothing to do.
if [ -d "$AGENTS_DIR" ] && [ "$(find "$AGENTS_DIR" -maxdepth 1 -name '*.md' | wc -l)" -gt 100 ]; then
  echo "agency-agents: already installed in $AGENTS_DIR"
  exit 0
fi

if [ -d "$CACHE_DIR/.git" ]; then
  git -C "$CACHE_DIR" fetch --depth 1 origin HEAD >/dev/null 2>&1 || true
  git -C "$CACHE_DIR" reset --hard FETCH_HEAD >/dev/null 2>&1 || true
else
  rm -rf "$CACHE_DIR"
  mkdir -p "$(dirname "$CACHE_DIR")"
  GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 "$REPO_URL" "$CACHE_DIR" >/dev/null 2>&1
fi

bash "$CACHE_DIR/scripts/install.sh" --tool claude-code --no-interactive >/dev/null
echo "agency-agents: installed $(find "$AGENTS_DIR" -maxdepth 1 -name '*.md' | wc -l) agents into $AGENTS_DIR"
