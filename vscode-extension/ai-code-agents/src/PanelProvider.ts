import * as vscode from "vscode";
import { AgentName, PanelMessage, AiTask, AiTasksData } from "./types";

export class PanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "aiCodeAgents.panel";

  private _view?: vscode.WebviewView;
  private _onDidReceiveMessage = new vscode.EventEmitter<PanelMessage>();
  readonly onDidReceiveMessage = this._onDidReceiveMessage.event;

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg: PanelMessage) => {
      this._onDidReceiveMessage.fire(msg);
    });
  }

  postLog(line: string) {
    this._view?.webview.postMessage({ type: "log", text: line });
  }

  postState(state: "idle" | "running" | "done" | "error", issueCount?: number, agentName?: string) {
    this._view?.webview.postMessage({ type: "state", state, issueCount, agentName });
  }

  postTasks(data: AiTasksData) {
    this._view?.webview.postMessage({ type: "tasks", data });
  }

  clearTasks() {
    this._view?.webview.postMessage({ type: "clearTasks" });
  }

  postWatchStatus(watching: boolean) {
    this._view?.webview.postMessage({ type: "watchStatus", watching });
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
:root {
  --radius: 8px;
  --sm: 6px;
  --transition: 0.15s;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  padding: 12px;
}

/* ─── Status Bar ─── */
.status-bar {
  display: none;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: var(--radius);
  font-size: 12px;
  background: var(--vscode-inputValidation-infoBackground);
  border-left: 3px solid var(--vscode-inputValidation-infoBorder);
}
.status-bar.show { display: flex; }
.status-bar.error {
  background: var(--vscode-inputValidation-errorBackground);
  border-color: var(--vscode-inputValidation-errorBorder);
}
.status-bar.success {
  background: var(--vscode-inputValidation-warningBackground);
  border-color: var(--vscode-inputValidation-warningBorder);
}
.status-bar.watching {
  background: color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent);
  border-color: var(--vscode-focusBorder);
}
.spinner {
  width: 14px; height: 14px;
  border: 2px solid var(--vscode-widget-border);
  border-top-color: var(--vscode-focusBorder);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

.stop-btn {
  display: none;
  margin-left: auto;
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  color: var(--vscode-errorForeground);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.4;
  flex-shrink: 0;
  transition: opacity 0.15s;
}
.stop-btn:hover { opacity: 0.8; }
.stop-btn.show { display: inline-block; }

/* ─── Pipeline Flow ─── */
.flow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin-bottom: 14px;
  padding: 6px 8px;
  background: var(--vscode-editor-background);
  border-radius: var(--radius);
  font-size: 9px;
  line-height: 1.6;
}
.flow .step {
  padding: 1px 4px;
  border-radius: 3px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.5;
  white-space: nowrap;
}
.flow .step.active {
  opacity: 1;
  color: var(--vscode-foreground);
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  font-weight: 600;
}
.flow .sep {
  color: var(--vscode-descriptionForeground);
  opacity: 0.3;
  font-size: 7px;
}

/* ─── Sections ─── */
.group {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: var(--radius);
  margin-bottom: 10px;
  overflow: hidden;
}
.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-widget-border);
  background: color-mix(in srgb, var(--vscode-widget-border) 30%, transparent);
}
.group-body {
  padding: 6px;
}

/* ─── Buttons ─── */
.actions { display: flex; flex-direction: column; gap: 4px; }
.actions.row { flex-direction: row; }

.btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  transition: all var(--transition);
  text-align: left;
}
.btn:hover { transform: translateY(-1px); }
.btn:active { transform: scale(0.98); }
.btn:disabled { opacity: 0.35; cursor: not-allowed; transform: none; }

.btn-full {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  font-weight: 500;
}
.btn-full:hover { background: var(--vscode-button-hoverBackground); }

.btn-outline {
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-widget-border);
}
.btn-outline:hover {
  background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
  border-color: var(--vscode-focusBorder);
}

.btn-subtle {
  background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
  color: var(--vscode-foreground);
}
.btn-subtle:hover {
  background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
}

.btn-danger {
  background: color-mix(in srgb, var(--vscode-errorForeground) 15%, transparent);
  color: var(--vscode-errorForeground);
  border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 30%, transparent);
}
.btn-danger:hover {
  background: color-mix(in srgb, var(--vscode-errorForeground) 25%, transparent);
}

.btn-icon { font-size: 14px; line-height: 1; width: 16px; text-align: center; }

/* ─── Task List ─── */
.task-section { display: none; margin-bottom: 10px; }
.task-section.show { display: block; }

.task-card {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 6px;
  margin-bottom: 4px;
  overflow: hidden;
  transition: border-color var(--transition);
}
.task-card:hover { border-color: var(--vscode-focusBorder); }
.task-card.checked {
  background: color-mix(in srgb, var(--vscode-focusBorder) 8%, transparent);
}

.task-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
}
.task-header input[type="checkbox"] {
  accent-color: var(--vscode-focusBorder);
  cursor: pointer;
  flex-shrink: 0;
}

.task-info { flex: 1; min-width: 0; }
.task-title {
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.task-meta {
  display: flex;
  gap: 4px;
  margin-top: 3px;
  flex-wrap: wrap;
}

.badge {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.badge-high {
  background: color-mix(in srgb, var(--vscode-errorForeground) 20%, transparent);
  color: var(--vscode-errorForeground);
}
.badge-medium {
  background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 20%, transparent);
  color: var(--vscode-editorWarning-foreground);
}
.badge-low {
  background: color-mix(in srgb, var(--vscode-descriptionForeground) 20%, transparent);
  color: var(--vscode-descriptionForeground);
}
.badge-type {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

.task-body {
  display: none;
  padding: 0 10px 8px 34px;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.5;
}
.task-card.expanded .task-body { display: block; }

.fix-bar {
  display: none;
  gap: 4px;
  padding: 8px 0 0;
}
.fix-bar.show { display: flex; }
.fix-bar .btn { flex: 1; }

/* ─── Log ─── */
.log-section { margin-top: 4px; }
.log-box {
  background: var(--vscode-terminal-background);
  color: var(--vscode-terminal-foreground);
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 10px;
  padding: 8px;
  border-radius: 6px;
  max-height: 160px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.4;
}
.log-box:empty::before {
  content: "Ready.";
  opacity: 0.35;
}

/* ─── Empty / Legend ─── */
.empty {
  text-align: center;
  padding: 20px 12px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.6;
  font-size: 12px;
}
.legend {
  font-size: 9px;
  opacity: 0.3;
  text-align: center;
  margin-top: 16px;
  padding-bottom: 4px;
}

/* ─── Animation ─── */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
.task-card { animation: fadeIn 0.2s ease both; }
.task-card:nth-child(1) { animation-delay: 0s; }
.task-card:nth-child(2) { animation-delay: 0.04s; }
.task-card:nth-child(3) { animation-delay: 0.08s; }
.task-card:nth-child(4) { animation-delay: 0.12s; }
</style>
</head>
<body>

<div id="statusBar" class="status-bar"><button id="stopBtn" class="stop-btn" onclick="cancel()" title="Stop">⏹</button></div>

  <div class="flow" id="flowBar">
  <span class="step" data-step="scan">Scan</span>
  <span class="sep">→</span>
  <span class="step" data-step="review">Review</span>
  <span class="sep">→</span>
  <span class="step" data-step="plan">Plan</span>
  <span class="sep">→</span>
  <span class="step" data-step="fix">Fix</span>
  <span class="sep">→</span>
  <span class="step" data-step="test">Test</span>
  <span class="sep">→</span>
  <span class="step" data-step="commit">Commit</span>
</div>

<div class="group">
  <div class="group-header"><span>🔍</span> Scan & Review</div>
  <div class="group-body">
    <div class="actions">
      <button class="btn btn-full" onclick="run('ai-scanner')"><span class="btn-icon">🔍</span> Scan Project</button>
      <div class="actions row">
        <button class="btn btn-outline" style="flex:1" onclick="run('code-reviewer-agent')"><span class="btn-icon">🔬</span> Review</button>
        <button class="btn btn-outline" style="flex:1" onclick="run('diff-reviewer')"><span class="btn-icon">📝</span> Diff</button>
      </div>
    </div>
  </div>
</div>

<div class="group">
  <div class="group-header"><span>🔧</span> Plan & Fix</div>
  <div class="group-body">
    <div class="actions">
      <button class="btn btn-subtle" onclick="run('tasker-agent')"><span class="btn-icon">📋</span> Plan Tasks</button>
      <button class="btn btn-subtle" onclick="run('fixer-agent', ['--apply'])"><span class="btn-icon">🔧</span> Fix All Issues</button>
    </div>
  </div>
</div>

<div class="group">
  <div class="group-header"><span>🧪</span> Test & Commit</div>
  <div class="group-body">
    <div class="actions row">
      <button class="btn btn-outline" style="flex:1" onclick="run('test-agent', ['--apply'])"><span class="btn-icon">🧪</span> Tests</button>
      <button class="btn btn-outline" style="flex:1" onclick="run('commit-agent', ['--staged'])"><span class="btn-icon">💬</span> Commit</button>
    </div>
  </div>
</div>

<div class="group">
  <div class="group-header"><span>⚙</span> Settings & Tools</div>
  <div class="group-body">
    <div class="actions">
      <button class="btn btn-subtle" onclick="openSettings()"><span class="btn-icon">⚙</span> Extension Settings</button>
      <button class="btn btn-subtle" onclick="toggleWatch()" id="watchBtn"><span class="btn-icon" id="watchIcon">👁</span> Watch Mode: <span id="watchState">OFF</span></button>
      <button class="btn btn-subtle" onclick="run('learn-agent')"><span class="btn-icon">🧠</span> Learning Status</button>
    </div>
  </div>
</div>

<div class="actions" style="margin-bottom: 10px;">
  <button class="btn btn-danger" onclick="run('orchestrator')"><span class="btn-icon">🚀</span> Run Full Pipeline</button>
</div>

<div id="taskSection" class="task-section">
  <div id="taskList"></div>
  <div id="fixBar" class="fix-bar">
    <button class="btn btn-danger" id="btnFixSelected" onclick="fixSelected()">✕ Fix Selected</button>
    <button class="btn btn-outline" onclick="clearAllTasks()">Clear</button>
  </div>
</div>

<div class="log-section">
  <div class="log-box" id="logBox"></div>
</div>

<div class="legend">Ctrl+Shift+R · D · X · P · Esc · C</div>

<script>
const vscode = acquireVsCodeApi();
let selected = new Set();
let tasks = [];
let running = false;

function run(agent, args) {
  if (running) return;
  vscode.postMessage({ type: 'run', agent, args: args || [] });
}

function cancel() {
  vscode.postMessage({ type: 'cancel' });
}

function openSettings() {
  vscode.postMessage({ type: 'openSettings' });
}

function toggleWatch() {
  vscode.postMessage({ type: 'toggleWatch' });
}

function setRunning(state) {
  running = state;
  document.querySelectorAll('.btn').forEach(b => { b.disabled = state; });
  document.querySelectorAll('input[type="checkbox"]').forEach(b => { b.disabled = state; });
  const stopBtn = document.getElementById('stopBtn');
  if (stopBtn) stopBtn.classList.toggle('show', state);
}

function setFlowStep(agentName) {
  document.querySelectorAll('.flow .step').forEach(s => s.classList.remove('active'));
  const map = {
    'ai-scanner': 'scan',
    'code-reviewer-agent': 'review',
    'diff-reviewer': 'review',
    'tasker-agent': 'plan',
    'fixer-agent': 'fix',
    'test-agent': 'test',
    'commit-agent': 'commit',
    'orchestrator': 'scan',
  };
  const step = map[agentName];
  if (step) document.querySelector('.flow .step[data-step="' + step + '"]')?.classList.add('active');
}

function appendLog(t) {
  const el = document.getElementById('logBox');
  el.textContent += t + '\\n';
  el.scrollTop = el.scrollHeight;
}

function setStatus(text, type) {
  const el = document.getElementById('statusBar');
  if (!text) { el.classList.remove('show', 'error', 'success', 'watching'); return; }
  el.textContent = text;
  el.className = 'status-bar show';
  if (type) el.classList.add(type);
}

function renderTasks(data) {
  tasks = data.tasks || [];
  selected.clear();
  const list = document.getElementById('taskList');
  const section = document.getElementById('taskSection');

  if (tasks.length === 0) {
    section.classList.remove('show');
    return;
  }

  section.classList.add('show');
  const iconMap = { security: '🔒', bug: '🐛', refactor: '🔧', style: '🎨', todo: '📝', test: '🧪' };

  list.innerHTML = tasks.map(t => {
    const icon = iconMap[t.type] || '•';
    const badge = 'badge-' + (t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'medium' : 'low');
    const files = (t.files || []).join(', ');
    return \`<div class="task-card" data-id="\${t.id}" onclick="toggle(this)">
      <div class="task-header">
        <input type="checkbox" onclick="event.stopPropagation(); toggleCheck(this, \${t.id})">
        <div class="task-info">
          <div class="task-title">\${icon} \${t.description.substring(0, 80)}</div>
          <div class="task-meta">
            <span class="badge \${badge}">\${t.priority}</span>
            <span class="badge badge-type">\${t.type}</span>
            <span class="badge badge-type">\${t.complexity}</span>
          </div>
        </div>
      </div>
      <div class="task-body">
        <div><strong>Files:</strong> <span style="font-family:var(--vscode-editor-font-family,monospace)">\${files}</span></div>
        \${t.why ? '<div style="margin-top:2px">' + t.why.substring(0, 120) + '</div>' : ''}
        <div style="margin-top:2px;opacity:0.5">\${t.findings.length} finding(s) · Task #\${t.id}</div>
      </div>
    </div>\`;
  }).join('');

  document.getElementById('fixBar').classList.remove('show');
}

function toggle(el) {
  el.classList.toggle('expanded');
}

function toggleCheck(el, id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  el.closest('.task-card').classList.toggle('checked');
  const bar = document.getElementById('fixBar');
  const btn = document.getElementById('btnFixSelected');
  if (selected.size > 0) {
    bar.classList.add('show');
    btn.textContent = '✕ Fix Selected (' + selected.size + ')';
  } else {
    bar.classList.remove('show');
  }
}

function fixSelected() {
  vscode.postMessage({ type: 'fixSelected', taskIds: [...selected].sort((a,b) => a-b) });
}

function clearAllTasks() {
  selected.clear();
  tasks = [];
  document.getElementById('taskSection').classList.remove('show');
  document.getElementById('taskList').innerHTML = '';
  document.getElementById('fixBar').classList.remove('show');
}

window.addEventListener('message', ({ data }) => {
  if (data.type === 'log') appendLog(data.text);
  if (data.type === 'tasks') renderTasks(data.data);
  if (data.type === 'clearTasks') clearAllTasks();

  if (data.type === 'watchStatus') {
    const btn = document.getElementById('watchBtn');
    const state = document.getElementById('watchState');
    const icon = document.getElementById('watchIcon');
    if (data.watching) {
      state.textContent = 'ON';
      icon.textContent = '👁';
      btn.style.borderColor = 'var(--vscode-focusBorder)';
    } else {
      state.textContent = 'OFF';
      icon.textContent = '👁';
      btn.style.borderColor = '';
    }
  }

  if (data.type === 'state') {
    if (data.state === 'running') {
      setRunning(true);
      setFlowStep(data.agentName);
      const bar = document.getElementById('statusBar');
      bar.innerHTML = '<div class="spinner"></div><span>' + (data.agentName || 'Running...') + '</span>';
      bar.className = 'status-bar show';
    } else if (data.state === 'done') {
      setRunning(false);
      const count = data.issueCount ?? 0;
      setStatus(count > 0 ? '⚠ ' + count + ' issue(s) found' : '✅ No issues found', count > 0 ? 'success' : '');
    } else if (data.state === 'error') {
      setRunning(false);
      setStatus('❌ Agent failed', 'error');
    } else {
      setRunning(false);
      setStatus('');
    }
  }
});
</script>
</body>
</html>`;
  }
}
