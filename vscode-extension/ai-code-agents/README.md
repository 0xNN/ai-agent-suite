# AI Code Agents — VS Code Extension

Integrates all 8 AI agents directly into VS Code.

## Features

| Feature | Sidebar | Keyboard | Right-click |
|---|---|---|---|
| Scan (local, no AI) | 🔍 Scan | — | Yes |
| Review Workspace | 🔬 Review | Ctrl+Shift+R | Yes |
| Review This File | — | — | Yes (editor) |
| Diff Review (fast) | 📝 Diff Review | Ctrl+Shift+D | Yes |
| Plan Tasks | 📋 Plan Tasks | — | — |
| Fix All Issues | 🔧 Fix All | Ctrl+Shift+X | Yes |
| Fix This File | — | — | Yes (editor) |
| Fix This File (Preview Diff) | — | Ctrl+Shift+P | Yes (editor) |
| Generate Tests | 🧪 Generate Tests | — | — |
| Generate Commit | 💬 Generate Commit | Ctrl+Shift+C | — |
| Full Pipeline | 🚀 Run Full Pipeline | — | — |
| Toggle Watch Mode | ⚙ Settings panel | — | — |
| Extension Settings | ⚙ Settings panel | — | — |

## Code Actions (Lightbulb 💡)

After Scan/Review, hover a diagnostic or click the lightbulb:
- **✨ Fix** — run fixer-agent on the file
- **⏭ Ignore** — add to `.ai-reviewer-ignore`
- **🔬 Review file** — run code-reviewer-agent
- **🧪 Generate tests** — run test-agent

## Fix with Preview

1. Press `Ctrl+Shift+P` or right-click → Fix This File (Preview Diff First)
2. VS Code opens a diff editor (original vs. AI fix)
3. Click **Apply** to confirm or **Cancel**

## Watch Mode

Toggle "Watch Mode: ON/OFF" in the sidebar panel. When enabled, agents auto-run when files change (debounced). Configure via settings:
- `watchMode.enabled` — enable/disable
- `watchMode.debounceMs` — debounce delay (default 1500ms)
- `watchMode.agents` — pattern → agent mapping
- `watchMode.excludedPaths` — paths to ignore

## Multi-Model (Per-Agent)

Set different models per agent via `agentDefaults`:
```json
{
  "fixer-agent": { "provider": "nvidia", "model": "deepseek-ai/deepseek-v4-flash" },
  "commit-agent": { "provider": "openai", "model": "gpt-4o" }
}
```

## Requirements

- Node.js 18+
- Agents installed globally via `npm install -g`

## Setup

1. Open VS Code Settings → AI Code Agents (or sidebar ⚙ button)
2. Configure API key, model, base URL (or use `.env`)

## Development

```bash
cd vscode-extension/ai-code-agents
npm install
npm run compile
# Press F5 in VS Code for Extension Development Host
```

## Package

```bash
npm run package
code --install-extension ai-code-agents-0.1.0.vsix
```

## Project Structure

```
ai-code-agents/
├── package.json
├── tsconfig.json
├── README.md
├── media/icon.svg
└── src/
    ├── extension.ts           ← entry point, commands, watcher
    ├── AgentRunner.ts         ← spawns agents, per-agent model overrides
    ├── CodeActionProvider.ts  ← inline code actions (lightbulb)
    ├── DiagnosticsProvider.ts ← report → Problems panel
    ├── StatusBarManager.ts    ← status bar (idle/running/watching)
    ├── PanelProvider.ts       ← sidebar webview UI
    ├── WatchManager.ts        ← file watcher, debounce, glob matching
    └── types.ts               ← shared types & agent definitions
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Agent not found" | Run `npm install -g ./{agent}` from repo root |
| Settings button doesn't work | Search "AI Code Agents" in VS Code Settings |
| No diagnostics after review | Ensure `"aiCodeAgents.showDiagnostics": true` |
| Node.js errors | Install Node.js 18+ from nodejs.org |
| API errors | Check API key in settings or `.env` |
| Extension not loading | Run `npm run compile` first |
