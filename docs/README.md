# AI Agent Suite

Suite of CLI agents + VS Code extension for AI-assisted code review, task planning, auto-fixing, commit generation, and local code scanning.

```
═══ orchestrator ════════════       ═══ VS Code Extension ════
║                            ║       ┌──────────────────────┐
scan ──▶ review ──▶ task ──▶ fix ──▶ test ──▶ commit        │ Sidebar · Problems   │
         ▲        ▲   │       ▲       │                      │ Ctrl+Shift+R/D/X/C  │
         │        │ decide │     apply │                     │ Task list · Fix Sel. │
         │  diff  └─────────┘          └── generate tests     │ Animated spinner     │
         │  (only changed files)                              └──────────────────────┘
         └── context ──────┘
```

---

## Quick Install (new machine)

Run one of these scripts to install all agents + VS Code extension:

**Windows** (PowerShell as Admin):
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\docs\install.ps1
```

**macOS / Linux**:
```bash
chmod +x docs/install.sh
./docs/install.sh
```

Scripts install all 8 agents globally + compile and install the VS Code extension.

---

## VS Code Extension

Integrated directly into VS Code — no terminal needed.

### Features

| Feature | Sidebar | Keyboard | Right-click |
|---|---|---|---|
| Scan (local, no AI) | 🔍 Scan Project | — | Yes |
| AI Review Workspace | 🔬 Review | `Ctrl+Shift+R` | Yes |
| Diff Review (changed only) | 📝 Diff | `Ctrl+Shift+D` | Yes |
| Plan Tasks | 📋 Plan Tasks | — | — |
| Fix All Issues | 🔧 Fix All | `Ctrl+Shift+X` | Yes |
| Fix Selected Tasks | ✅ Fix Selected (N) | — | — |
| Generate Tests | 🧪 Tests | — | — |
| Generate Commit | 💬 Commit | `Ctrl+Shift+C` | — |
| Full Pipeline | 🚀 Run Full Pipeline | — | — |

### Sidebar Panel

- **Pipeline flow indicator** — highlights current step (Scan → Review → Plan → Fix → Test → Commit)
- **Animated spinner** — shows agent name while running
- **Task cards** — after Plan Tasks, shows prioritized tasks with checkboxes
- **Fix Selected** — choose which tasks to fix, not all
- **Buttons disabled** during agent run — prevents concurrent actions
- **Output log** — real-time streaming output
- **Status bar** — issue count summary

### Problems Panel

Findings from Scan/Review appear as diagnostics inline — exactly like ESLint.

### Settings (`Ctrl+,` → AI Code Agents)

| Setting | Default | Description |
|---|---|---|---|
| `aiCodeAgents.provider` | `""` | LLM provider preset (`openai`, `anthropic`, `nvidia`, `minimax`, `custom`) |
| `aiCodeAgents.apiKey` | `""` | API key (leave empty to use `.env`) |
| `aiCodeAgents.model` | `""` | Model override (leave empty for provider default or `.env`) |
| `aiCodeAgents.baseUrl` | `""` | Base URL override (leave empty for provider default or `.env`) |
| `aiCodeAgents.language` | `"en"` | Output language (`en` / `id`) |
| `aiCodeAgents.autoReviewOnSave` | `false` | Auto diff-review on file save |
| `aiCodeAgents.showDiagnostics` | `true` | Show findings in Problems panel |
| `aiCodeAgents.streamOutput` | `false` | Stream LLM output token-by-token |

**Provider presets** (auto-fill model + base URL when `model`/`baseUrl` are empty):

| Provider | Base URL | Model |
|---|---|---|
| `openai` | `https://api.openai.com/v1` | `gpt-4o` |
| `anthropic` | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` |
| `nvidia` | `https://integrate.api.nvidia.com/v1` | `deepseek-ai/deepseek-v4-flash` |
| `minimax` | `https://api.minimax.chat/v1` | `minimax-m2.7` |

> All providers must be OpenAI-compatible (`/v1/chat/completions`). Anthropic requires an OpenAI-compatible proxy. Explicit `model`/`baseUrl` settings override provider presets. Empty values fall back to `.env`.

### Manual VSIX Install

```bash
cd vscode-extension/ai-code-agents
npm install
npm run compile
npx @vscode/vsce package
code --install-extension ai-code-agents-0.1.0.vsix
```

---

## Agent Reference

| Agent | CLI | Function | AI? | API Key Required |
|---|---|---|---|---|
| **scan-agent** | `ai-scanner` | Local deterministic code scan | No | No |
| **code-reviewer-agent** | `code-reviewer-agent` | AI code review → Markdown report | Yes | Yes |
| **tasker-agent** | `tasker-agent` | Review report → prioritized task plan | Optional | Only for LLM mode |
| **fixer-agent** | `fixer-agent` | Task/report → auto-fix code | Yes | Yes |
| **test-agent** | `test-agent` | Review findings → generate unit tests | Yes | Yes |
| **commit-agent** | `commit-agent` | Git diff → conventional commit message | Yes | Yes |
| **orchestrator** | `orchestrator` | Run full pipeline: review → fix → test → commit | No | No |
| **diff-reviewer** | `diff-reviewer` | Review only changed code (git diff) | Yes | Yes |

---

## Installation

### Global install (all platforms)

```bash
# From each agent directory
cd scan-agent              && npm install -g .
cd code-reviewer-agent     && npm install -g .
cd tasker-agent            && npm install -g .
cd fixer-agent             && npm install -g .
cd test-agent              && npm install -g .
cd commit-agent            && npm install -g .
cd diff-reviewer-agent     && npm install -g .
cd orchestrator-agent      && npm install -g .
```

### Platform notes

| Platform | Note |
|---|---|
| **Windows** | npm global creates a junction `%APPDATA%\npm\node_modules\{agent}` → `./{agent}`. Edits in the source directory take effect immediately. |
| **macOS / Linux** | npm global creates a symlink in `/usr/local/lib/node_modules/` or similar. Edits in the source directory apply immediately to the global install. |
| **Line endings** | Repo uses `.gitattributes` to enforce LF. If you copy files manually from Windows → Mac, convert line endings: `dos2unix scripts/*.mjs` or use `tr -d '\r'`. |

### Requirements

- Node.js 18+
- VS Code 1.85+ (for extension)
- LLM API key (OpenAI-compatible: OpenAI, NVIDIA, Minimax, etc.)

---

## Configuration

### Shared API keys

All AI agents share keys from `code-reviewer-agent/.env`. Create this file:

```bash
# code-reviewer-agent/.env
CODE_REVIEW_API_KEY=your-api-key
CODE_REVIEW_BASE_URL=https://api.openai.com/v1
CODE_REVIEW_MODEL=gpt-4o
```

Priority (lowest → highest):
1. `code-reviewer-agent/.env` — shared defaults
2. `{agent}/.env` — agent-specific overrides (e.g. different model)
3. `{project}/.env` — project-specific overrides
4. Shell environment variables — highest, never overridden

### Key fallback chain

All agents fall back to `CODE_REVIEW_*` keys:

| Agent | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| code-reviewer-agent | `CODE_REVIEW_*` | `OPENAI_*` | — |
| fixer-agent | `FIXER_*` | `CODE_REVIEW_*` | `OPENAI_*` |
| tasker-agent | `TASKER_*` | `CODE_REVIEW_*` | `OPENAI_*` |
| commit-agent | `COMMIT_*` | `CODE_REVIEW_*` | `OPENAI_*` |

### Per-project config

Each project can have `.ai-reviewer.json` in its root to control which files are reviewed:

**Default (JS/TS)**:
```json
{
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.js", "package.json"],
  "exclude": ["node_modules/**", "dist/**", "build/**"]
}
```

**Flutter/Dart** (copy from `code-reviewer-agent/skills/flutter-ai-reviewer.json`):
```json
{
  "include": ["**/*.dart", "pubspec.yaml"],
  "exclude": [".dart_tool/**", "build/**", "**/*.g.dart", "test/**"]
}
```

**Go** (copy from `code-reviewer-agent/skills/go-ai-reviewer.json`):
```json
{
  "include": ["**/*.go", "go.mod", "go.sum"],
  "exclude": ["vendor/**", "*.pb.go", "*_test.go"]
}
```

If no `.ai-reviewer.json` exists in the project root, the agent falls back to the one in `code-reviewer-agent/`.

---

## Usage

### 1. Scan (local, no AI)

```bash
# Basic scan
ai-scanner

# Scan specific project
ai-scanner --path=/path/to/project

# Quiet mode (no stdout, only writes report file)
ai-scanner --quiet

# Skip large file check
ai-scanner --skip-big-file
```

Output: `ai-scan-report-{timestamp}.md`

Detects: console.log/print/fmt.Println, TODO/FIXME, debugger, hardcoded secrets, empty catch blocks, magic numbers, hardcoded URLs, `var` keyword (JS only), `any`/`dynamic` types, duplicate imports, large files, blank Go imports.

### 2. Code Review (AI)

```bash
# Review current directory
code-reviewer-agent

# Review specific project
code-reviewer-agent --path=/path/to/project

# Review with output language
code-reviewer-agent --lang=id

# Stream mode (real-time token output)
code-reviewer-agent --stream

# Dry run (show selected files only)
code-reviewer-agent --dry-run

# Dry run with file listing
code-reviewer-agent --print-files

# Skip local scan
AI_REVIEW_SKIP_SCAN=1 code-reviewer-agent

# Skip entire review
AI_REVIEW_SKIP=1 code-reviewer-agent
```

The reviewer only generates the report. Task planning and fixing are handled separately: `tasker-agent` → `fixer-agent`.

Output: `ai-review-report-{timestamp}.md`

**Language skills** (swap `skills/SKILL.md`):

| Language | Config Example | Skill File |
|---|---|---|
| JS/TS | `.ai-reviewer.json` (default) | `skills/SKILL.md` |
| Flutter/Dart | `skills/flutter-ai-reviewer.json` | `skills/flutter-code-reviewer.md` |
| Go | `skills/go-ai-reviewer.json` | `skills/go-code-reviewer.md` |

To use a different language:
```bash
# Copy the config and skill to project root:
cp code-reviewer-agent/skills/flutter-ai-reviewer.json  my-flutter-app/.ai-reviewer.json
cp code-reviewer-agent/skills/flutter-code-reviewer.md  my-flutter-app/skills/SKILL.md
```

### 3. Task Planning

```bash
# Generate task plan from latest review report
tasker-agent

# Use specific report
tasker-agent --report=ai-review-report-2026-06-19.md

# Dry run (local grouping, no LLM)
tasker-agent --dry-run

# Apply fixes for all tasks
tasker-agent --apply

# Apply fixes for specific tasks only
tasker-agent --apply --task=1,3

# With Indonesian output
tasker-agent --lang=id
```

Output: `ai-tasks.json` — structured task list with priority, type, complexity, files, and finding references. Completed findings are tracked — re-running `tasker-agent` won't regenerate tasks for already-fixed issues.

Two modes:
- **`--dry-run`** → deterministic grouping by file + category, no LLM, no API key needed
- **Normal mode** → LLM groups findings into intelligent tasks with priority, type, and dependency ordering

With `--apply`, tasker-agent generates a minimal report per task and delegates fixing to fixer-agent.

### 4. Auto-Fix

Fixer-agent is the **executor** — it reads findings from a report, sends each file to the LLM, and writes fixes. Normally called by tasker-agent; standalone use is also possible.

```bash
# Invoked by tasker (recommended):
tasker-agent --apply --path=./project

# Standalone: preview fixes (shows diff, no writes)
fixer-agent

# Standalone: apply fixes directly
fixer-agent --apply

# Standalone: use specific report
fixer-agent --report=ai-review-report-2026-06-19.md

# Add custom instruction
fixer-agent --prompt="Use const instead of let where possible"

# Fix files in specific project
fixer-agent --path=/path/to/project
```

### 5. Commit Message

```bash
# Generate commit message from staged + unstaged diff
commit-agent

# Staged changes only
commit-agent --staged

# Auto-commit (generates + commits in one step)
commit-agent --commit

# Dry run (show message only)
commit-agent --dry-run

# Indonesian output
commit-agent --lang=id

# Combine: generate and commit staged changes
commit-agent --staged --commit
```

Output format: Conventional Commit (single title + body with bullet list).

---

## Pipeline Orchestrator

Run the entire pipeline in one command:

```bash
# Full pipeline
orchestrator

# Specify project
orchestrator --path=./my-project

# Skip specific steps
orchestrator --skip=test,commit

# Interactive mode (confirm each step)
orchestrator --interactive

# Dry run (show plan only)
orchestrator --dry-run

# Select specific tasks to fix
orchestrator --task=1,3
```

If a step fails, the pipeline stops. Use `--interactive` to approve each step.

---

## Workflow Comparison

Dua jalur utama tergantung kebutuhan:

### Jalur Cepat (pre-commit / daily push)

Hanya review kode yang berubah — hemat token, cocok untuk setiap commit.

```bash
diff-reviewer --staged              # review perubahan aja
commit-agent --staged --commit      # langsung commit
```

Atau satu baris:
```bash
diff-reviewer --staged && commit-agent --staged --commit
```

### Jalur Lengkap (release / PR besar)

Review semua kode → plan task → fix → test → commit.

```bash
orchestrator --path=./my-project
```

Atau manual:
```bash
code-reviewer-agent --path=./my-project   # review semua file
tasker-agent --path=./my-project          # plan task
tasker-agent --apply --task=1,3           # fix task tertentu
test-agent --apply --path=./my-project    # generate test
commit-agent --staged --commit            # commit
```

---

## Diff Review

Review only the changed lines (git diff), not the entire codebase — faster and cheaper.

```bash
# Review staged changes (default)
diff-reviewer

# Review unstaged changes
diff-reviewer --unstaged

# Review changes since a specific ref
diff-reviewer --since=main
diff-reviewer --since=HEAD~3

# Show the diff only (no AI)
diff-reviewer --dry-run

# Stream mode
diff-reviewer --stream

# Specify project
diff-reviewer --path=./my-project
```

Output: `ai-diff-review-{timestamp}.md`

Perfect for pre-commit hooks or CI PR checks where only new code needs review.

---

### 6. Test Generation

Generates unit tests for files with review findings.

```bash
# Preview tests (shows first 20 lines per file)
test-agent

# Use specific report
test-agent --report=ai-review-report-2026-06-19.md

# Write test files
test-agent --apply

# Output to specific directory (mirrors source structure)
test-agent --apply --out-dir=tests

# Add custom instruction
test-agent --prompt="Use Jest instead of Vitest"

# Dry run
test-agent --dry-run
```

Test file naming:

| Source | Test file |
|---|---|
| `src/utils.ts` | `src/utils.test.ts` |
| `lib/main.dart` | `lib/main_test.dart` |
| `handler.go` | `handler_test.go` |
| `app.js` | `app.test.js` |

Output: test files written next to source files (or in `--out-dir`).

---

## End-to-End Workflow

### Full pipeline

```bash
# One command (orchestrator):
orchestrator --path=./my-project

# Or step by step manually:
code-reviewer-agent --path=./my-project   # 1. review
tasker-agent --path=./my-project          # 2. plan
tasker-agent --apply --task=1,2           # 3. fix
test-agent --apply --path=./my-project    # 4. test
commit-agent --staged --commit            # 5. commit
```

### CI/CD (GitHub Actions / GitLab CI)

```yaml
# .github/workflows/code-review.yml
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install -g code-reviewer-agent
      - run: code-reviewer-agent --path=${{ github.workspace }}
        env:
          CODE_REVIEW_API_KEY: ${{ secrets.API_KEY }}
```

### Docker

The `code-reviewer-agent` includes a `Dockerfile` for running in CI:

```bash
docker build -t code-reviewer-agent code-reviewer-agent/
docker run -e CODE_REVIEW_API_KEY=$KEY code-reviewer-agent --path=/app
```

A `.env` file is **never** copied into Docker images. Pass keys via `-e` or `--env-file`.

---

## Agent Integration

### scan-agent ↔ code-reviewer-agent

The code-reviewer-agent imports scan-agent dynamically and runs a local scan before calling the LLM. Up to 40 findings are sent as context with instruction "do not re-report these." This avoids wasting LLM tokens on trivial issues (console.log, TODO, etc.).

Skip local scan: `AI_REVIEW_SKIP_SCAN=1 code-reviewer-agent`

### code-reviewer-agent → tasker-agent → fixer-agent

Clean separation of concerns:
1. **reviewer** → only generates `ai-review-report-*.md`
2. **tasker** → reads report, plans tasks, produces `ai-tasks.json`
3. **fixer** → executes fixes, invoked by tasker

```bash
code-reviewer-agent --path=./project   # step 1: review only
tasker-agent --apply --path=./project  # step 2: plan + fix (calls fixer)
```

With `--apply`, tasker-agent:
1. For each selected task, builds a **minimal report** (`.tasker-temp-report.md`) containing only the relevant findings
2. Feeds it to `fixer-agent --apply`
3. Cleans up the temp file after completion
4. **Marks findings as completed** in `ai-tasks.json` — re-running `tasker-agent` skips already-fixed findings

```bash
fixer-agent --apply --report=".tasker-temp-report.md" --path="{project}"
```

The tasker decides **which** tasks to fix (`--task=1,3` or `--apply` for all). The fixer only executes.

---

## Architecture

```
.
├── .gitattributes          (LF line endings for all platforms)
├── docs/                   (this document + install scripts)
│   ├── README.md
│   ├── install.ps1         (Windows install script)
│   └── install.sh          (macOS/Linux install script)
├── scan-agent/             (local scan, no AI, no API key)
│   └── scripts/ai-scanner.mjs
├── code-reviewer-agent/    (AI review, .env shared by all agents)
│   ├── scripts/ai-code-reviewer.mjs
│   ├── skills/SKILL.md, flutter-code-reviewer.md, go-code-reviewer.md
│   └── .env.example
├── tasker-agent/           (task planning, optional LLM)
│   └── scripts/ai-task-generator.mjs
├── fixer-agent/            (auto-fix code)
│   └── scripts/ai-fixer.mjs
├── test-agent/             (unit test generation)
│   ├── scripts/ai-test-agent.mjs
│   ├── scripts/_loader.mjs
│   └── skills/SKILL.md
├── commit-agent/           (commit message generator)
│   └── scripts/ai-commit-generator.mjs
├── diff-reviewer-agent/    (git diff review, fast & cheap)
│   ├── scripts/ai-diff-reviewer.mjs
│   ├── scripts/_loader.mjs
│   └── skills/SKILL.md
├── orchestrator-agent/     (pipeline coordinator, no AI)
│   └── scripts/orchestrator.mjs
└── vscode-extension/
    └── ai-code-agents/     (VS Code extension)
        ├── src/
        │   ├── extension.ts, AgentRunner.ts, DiagnosticsProvider.ts
        │   ├── StatusBarManager.ts, PanelProvider.ts, types.ts
        ├── media/icon.svg
        ├── package.json
        └── tsconfig.json
```

All agents are independent npm packages (not a monorepo) for independent global installation. On Windows, `npm install -g .` creates a junction; on macOS/Linux, a symlink. Changes to source files take effect immediately.

The VS Code extension calls agents via globally installed CLI commands (`orchestrator.cmd`, `ai-scanner`, etc.) — no hardcoded paths.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "No matching files found" | `.ai-reviewer.json` missing or wrong include patterns | Copy the right config from `code-reviewer-agent/skills/` to project root |
| "command not found" after install | npm bin not in PATH | Run `npm config get prefix` and add `{prefix}` to PATH |
| CRLF errors on Mac/Linux | Files edited on Windows | Run `find . -name '*.mjs' -exec sed -i 's/\r$//' {} +` or use `.gitattributes` |
| LLM returns gibberish | Wrong model or base URL | Check `.env`: `CODE_REVIEW_BASE_URL` must match provider |
| Stream doesn't show output | Provider SSE format differs | Run with `--debug-stream` to log raw SSE |
| Scan finds no Dart issues | Old scan-agent without `.dart` support | Update scan-agent (v0.2+ includes Dart/Go support) |
| fixer-agent reports no findings | Report format mismatch | Ensure report is the standard Markdown table format from code-reviewer-agent |
| Extension shows "Agent Failed" after review | code-reviewer-agent exits 1 on findings | Already handled — extension treats exit 1 as success if report exists |
| ANSI codes in extension output (`[36m`, `[0m`) | Piped stdout from spinner | Already stripped — extension filters ANSI codes |
| API key error with NVIDIA key | Extension overrides baseUrl with OpenAI default | Leave `aiCodeAgents.baseUrl` empty — uses `.env` value |
| Agents not found when running from extension | Not installed globally | Run `install.ps1` or `install.sh` |
