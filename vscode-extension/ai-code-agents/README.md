# AI Code Agents

![Version](https://img.shields.io/badge/version-0.4.0-00e5cc)
![Agents](https://img.shields.io/badge/agents-10-00e5cc)
![Node](https://img.shields.io/badge/node-20+-green)

AI-powered code scan, security audit, review, fix, test, and commit — **10 agents** integrated directly into VS Code.

## Pipeline

```
🔍 Scan → 🛡️ Security → 🔬 Review → 📋 Plan → 🔧 Fix → 🧪 Test → 💬 Commit
```

## Features

| Feature | Sidebar | Keyboard | Right-click |
|---|---|---|---|
| 🔍 Scan (local, no AI) | ✅ | — | Explorer |
| 🛡️ Security Audit | ✅ | `Ctrl+Shift+S` | Explorer |
| 🔬 Review Workspace | ✅ | `Ctrl+Shift+R` | Explorer |
| 🔬 Review This File | — | — | Editor |
| 🛡️ Security Audit This File | — | — | Editor |
| 📝 Diff Review (changed only) | ✅ | `Ctrl+Shift+D` | Explorer |
| 📋 Plan Tasks | ✅ | — | — |
| 🔧 Fix All Issues | ✅ | `Ctrl+Shift+X` | Explorer |
| 🔧 Fix This File | — | — | Editor |
| 🔧 Fix This File (Preview Diff) | — | `Ctrl+Shift+P` | Editor |
| 🧪 Generate Tests | ✅ | — | — |
| 💬 Generate Commit | ✅ | `Ctrl+Shift+C` | — |
| 🚀 Run Full Pipeline | ✅ | — | — |
| 👁 Watch Mode | ✅ | — | — |
| ⚙ Extension Settings | ✅ | — | — |
| 🧠 Learning Status | ✅ | — | — |

## Agents

| Agent | CLI | Function | AI | API Key |
|---|---|---|---|---|
| **scan-agent** | `ai-scanner` | Local deterministic code scan | No | No |
| **security-agent** | `security-agent` | Security audit — secrets, injection, XSS, auth, SSRF | Yes | Yes |
| **code-reviewer-agent** | `code-reviewer-agent` | Full AI code review | Yes | Yes |
| **diff-reviewer** | `diff-reviewer` | Review only changed files (git diff) | Yes | Yes |
| **tasker-agent** | `tasker-agent` | Generate prioritized task plan from reports | Optional | Optional |
| **fixer-agent** | `fixer-agent` | Auto-fix issues from reports | Yes | Yes |
| **test-agent** | `test-agent` | Generate unit tests from findings | Yes | Yes |
| **commit-agent** | `commit-agent` | Generate conventional commit message | Yes | Yes |
| **orchestrator** | `orchestrator` | Run full pipeline | No | No |
| **learn-agent** | `learn-agent` | Adaptive learning — track fix history | No | No |

## Multi-Language Support

Agents auto-detect project language from file markers:

| Marker | Language |
|---|---|
| `package.json` / `tsconfig.json` | JavaScript / TypeScript |
| `pubspec.yaml` | Dart / Flutter |
| `go.mod` | Go |
| `requirements.txt` / `pyproject.toml` | Python |
| `pom.xml` / `build.gradle` | Java / Kotlin |

Override via VS Code Settings → `AI Code Agents: Project Language`.

## Security Audit

Dedicated security agent with language-specific skill files:

- **JS/TS** — secrets, injection, XSS, auth, SSRF, supply chain, frontend/backend specific
- **Dart/Flutter** — credential exposure, WebView injection, cert pinning, Android/iOS specific
- **Go** — SQL injection, command injection, goroutine leaks, TLS config
- **Python** — Django/FastAPI specific, pickle injection, template injection
- **Java/Kotlin** — Spring Boot, deserialization, Android security

Output: `ai-security-report-<timestamp>.md` — findings feed directly into Plan Tasks.

## Plan Tasks

Reads **both** `ai-review-report` and `ai-security-report` and generates a prioritized task list. Priority matches finding severity — `critical` findings always produce `critical` tasks.

## Code Actions (Lightbulb 💡)

After Scan/Review/Security Audit, hover a diagnostic or click the lightbulb:
- **✨ Fix** — run fixer-agent on the file
- **⏭ Ignore** — add to `.ai-reviewer-ignore`
- **🔬 Review file** — run code-reviewer-agent
- **🧪 Generate tests** — run test-agent

## Fix with Preview

1. Press `Ctrl+Shift+P` or right-click → **Fix This File (Preview Diff First)**
2. VS Code opens a diff editor (original vs. AI fix)
3. Click **Apply** to confirm or **Cancel**

## Watch Mode

Toggle **Watch Mode: ON/OFF** in the sidebar. When enabled, agents auto-run when files change (debounced).

```json
{
  "aiCodeAgents.watchMode.enabled": true,
  "aiCodeAgents.watchMode.debounceMs": 1500,
  "aiCodeAgents.watchMode.agents": [
    { "pattern": "*.{ts,tsx,js,jsx}", "agent": "diff-reviewer" }
  ]
}
```

## Multi-Model (Per-Agent)

Set different providers/models per agent:

```json
{
  "aiCodeAgents.agentDefaults": {
    "code-reviewer-agent": { "provider": "openai", "model": "gpt-4o" },
    "security-agent": { "provider": "nvidia", "model": "deepseek-ai/deepseek-v4-flash" },
    "fixer-agent": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" }
  }
}
```

**Provider presets:**

| Provider | Base URL | Default Model |
|---|---|---|
| `openai` | `api.openai.com/v1` | `gpt-4o` |
| `anthropic` | `api.anthropic.com/v1` | `claude-sonnet-4-20250514` |
| `nvidia` | `integrate.api.nvidia.com/v1` | `deepseek-ai/deepseek-v4-flash` |
| `minimax` | `api.minimax.chat/v1` | `minimax-m2.7` |

## Setup

1. Install extension (`.vsix`)
2. Open VS Code Settings → **AI Code Agents**
3. Set `provider` and `apiKey` (or use `.env` file)

## Requirements

- Node.js 20+
- API key for any LLM provider (OpenAI-compatible)

## Project Structure

```
ai-code-agents/
├── media/
│   └── icon.svg
├── agents/                        ← bundled agents (auto-generated)
│   ├── scan-agent/
│   ├── security-agent/            ← new in v0.2.0
│   ├── code-reviewer-agent/
│   ├── diff-reviewer-agent/
│   ├── tasker-agent/
│   ├── fixer-agent/
│   ├── test-agent/
│   ├── commit-agent/
│   ├── orchestrator-agent/
│   └── learn-agent/
└── src/
    ├── extension.ts               ← entry point, commands, watcher
    ├── AgentRunner.ts             ← spawns agents, per-agent model overrides
    ├── CodeActionProvider.ts      ← inline code actions (lightbulb)
    ├── DiagnosticsProvider.ts     ← report → Problems panel
    ├── StatusBarManager.ts        ← status bar (idle/running/watching)
    ├── PanelProvider.ts           ← sidebar webview UI
    ├── WatchManager.ts            ← file watcher, debounce, glob matching
    ├── setupAgents.ts             ← bundled agent resolution
    └── types.ts                   ← shared types & agent definitions
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Agent not found | Restart VS Code — bundled agents load on activation |
| Settings button not working | Search "AI Code Agents" in VS Code Settings |
| No diagnostics after review | Ensure `"aiCodeAgents.showDiagnostics": true` |
| Node.js errors | Install Node.js 20+ from nodejs.org |
| API errors | Check API key in settings or `.env` |
| Extension not loading | Run `npm run compile` first |
| Security findings not in tasks | Run Security Audit first, then Plan Tasks |
