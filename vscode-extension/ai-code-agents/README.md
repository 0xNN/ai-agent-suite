# AI Code Agents — VS Code Extension

Integrates all 8 AI agents directly into VS Code.

## Features

| Feature | Sidebar | Keyboard | Right-click |
|---|---|---|---|
| Scan (local, no AI) | 🔍 Scan | — | Yes |
| Review Workspace | 🔬 Review | Ctrl+Shift+R | Yes |
| Diff Review (fast) | 📝 Diff Review | Ctrl+Shift+D | Yes |
| Plan Tasks | 📋 Plan Tasks | — | — |
| Fix All Issues | 🔧 Fix All | Ctrl+Shift+X | Yes |
| Generate Tests | 🧪 Generate Tests | — | — |
| Generate Commit | 💬 Generate Commit | Ctrl+Shift+C | — |
| Full Pipeline | 🚀 Run Full Pipeline | — | — |

Findings appear in the **Problems panel** (Errors/Warnings) — exactly like ESLint.

## Requirements

- Node.js 18+
- Agents installed globally: `npm install -g` for each agent

### Install all agents

```bash
cd scan-agent              && npm install -g .
cd code-reviewer-agent     && npm install -g .
cd diff-reviewer-agent     && npm install -g .
cd tasker-agent            && npm install -g .
cd fixer-agent             && npm install -g .
cd test-agent              && npm install -g .
cd commit-agent            && npm install -g .
cd orchestrator-agent      && npm install -g .
```

## Setup

1. Open VS Code Settings (`Ctrl+,`) and search for **AI Code Agents**
2. Configure API key, model, and base URL (or leave empty — agents use `.env`)

```json
{
  "aiCodeAgents.apiKey": "",
  "aiCodeAgents.model": "gpt-4o",
  "aiCodeAgents.baseUrl": "https://api.openai.com/v1",
  "aiCodeAgents.language": "en",
  "aiCodeAgents.autoReviewOnSave": false,
  "aiCodeAgents.showDiagnostics": true,
  "aiCodeAgents.streamOutput": false
}
```

## Development

```bash
cd vscode-extension/ai-code-agents
npm install
npm run compile
```

Press `F5` in VS Code to launch Extension Development Host.

### Package for distribution

```bash
npm run package
# Generates ai-code-agents-0.1.0.vsix
code --install-extension ai-code-agents-0.1.0.vsix
```

## Two Workflows

### Jalur Cepat (pre-commit / daily push)

```
Diff Review (sidebar or Ctrl+Shift+D) → Generate Commit (sidebar or Ctrl+Shift+C)
```

### Jalur Lengkap (release / PR besar)

```
Run Full Pipeline (sidebar) → reviews all → plans tasks → fixes → tests → commits
```

Or step by step:
```
Review Workspace → Plan Tasks → Fix All Issues → Generate Tests → Generate Commit
```

## Project Structure

```
ai-code-agents/
├── package.json
├── tsconfig.json
├── README.md
├── media/icon.svg
└── src/
    ├── extension.ts           ← entry point, registers commands
    ├── AgentRunner.ts         ← spawns agent CLI processes
    ├── DiagnosticsProvider.ts ← parses report → Problems panel
    ├── StatusBarManager.ts    ← bottom status bar
    ├── PanelProvider.ts       ← sidebar webview UI
    └── types.ts               ← shared types & agent definitions
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Agent not found" | Run `npm install -g ./{agent}` from repo root |
| No diagnostics after review | Ensure `"aiCodeAgents.showDiagnostics": true` |
| Node.js errors | Install Node.js 18+ from nodejs.org |
| API errors | Check API key in settings or `.env` |
| Extension not loading | Run `npm run compile` first |
