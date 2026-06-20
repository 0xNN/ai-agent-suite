#!/usr/bin/env bash
# ───────────────────────────────────────────────
#  AI Agents — macOS/Linux Install Script
# ───────────────────────────────────────────────
# Run:
#   chmod +x docs/install.sh
#   ./docs/install.sh
# ───────────────────────────────────────────────

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

AGENTS=(
  "scan-agent"
  "code-reviewer-agent"
  "diff-reviewer-agent"
  "tasker-agent"
  "fixer-agent"
  "test-agent"
  "commit-agent"
  "orchestrator-agent"
)

EXT_DIR="$ROOT/vscode-extension/ai-code-agents"
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── Check Node.js ───
echo -e "\n${CYAN}=== Checking Node.js ===${NC}"
if command -v node &>/dev/null; then
  VER=$(node --version)
  MAJOR=$(echo "$VER" | sed 's/v//' | cut -d. -f1)
  if [ "$MAJOR" -lt 18 ]; then
    echo -e "${RED}  Node.js $VER too old, need v18+${NC}"
    exit 1
  fi
  echo -e "${GREEN}  Node.js $VER detected ✓${NC}"
else
  echo -e "${RED}  Node.js not found. Download from https://nodejs.org${NC}"
  exit 1
fi

# ─── Install Agents ───
echo -e "\n${CYAN}=== Installing Agents Globally ===${NC}"
for agent in "${AGENTS[@]}"; do
  DIR="$ROOT/$agent"
  if [ ! -d "$DIR" ]; then
    echo -e "  ${RED}[!] $agent directory not found, skipping${NC}"
    continue
  fi
  echo -e "  Installing $agent..."
  (cd "$DIR" && npm install -g . &>/dev/null)
  if [ $? -eq 0 ]; then
    echo -e "  ${GREEN}✅ $agent installed${NC}"
  else
    echo -e "  ${RED}❌ $agent failed${NC}"
  fi
done

# ─── Install VS Code Extension ───
echo -e "\n${CYAN}=== Installing VS Code Extension ===${NC}"
if [ ! -d "$EXT_DIR" ]; then
  echo -e "  ${RED}[!] Extension directory not found at $EXT_DIR${NC}"
else
  echo -e "  Compiling extension..."
  (cd "$EXT_DIR" && npm install &>/dev/null && npm run compile &>/dev/null)
  if [ $? -eq 0 ]; then
    echo -e "  ${GREEN}✅ Extension compiled${NC}"
    echo -e "  Packaging extension..."
    (cd "$EXT_DIR" && npx @vscode/vsce package &>/dev/null)
    if [ $? -eq 0 ]; then
      VSIX=$(ls -t "$EXT_DIR"/*.vsix 2>/dev/null | head -1)
      if [ -n "$VSIX" ]; then
        code --install-extension "$VSIX" &>/dev/null
        if [ $? -eq 0 ]; then
          echo -e "  ${GREEN}✅ VS Code extension installed${NC}"
        else
          echo -e "  ${RED}❌ Failed to install extension in VS Code${NC}"
        fi
      fi
    else
      echo -e "  ${RED}❌ Extension packaging failed${NC}"
    fi
  else
    echo -e "  ${RED}❌ Extension compilation failed${NC}"
  fi
fi

# ─── Verify ───
echo -e "\n${CYAN}=== Verification ===${NC}"
CLIS=("ai-scanner" "code-reviewer-agent" "diff-reviewer" "tasker-agent" "fixer-agent" "test-agent" "commit-agent" "orchestrator")
for cli in "${CLIS[@]}"; do
  if command -v "$cli" &>/dev/null; then
    echo -e "  ${GREEN}✅ $cli${NC}"
  else
    echo -e "  ${RED}❌ $cli not found in PATH${NC}"
  fi
done

echo -e "\n${CYAN}=== Install Complete ===${NC}"
echo -e "  Restart VS Code for the extension to take effect."
