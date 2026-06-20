import * as vscode from "vscode";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { AgentRunner } from "./AgentRunner";
import { DiagnosticsProvider } from "./DiagnosticsProvider";
import { StatusBarManager } from "./StatusBarManager";
import { PanelProvider } from "./PanelProvider";
import { AgentName, ALL_AGENTS, AiTasksData, AiTask } from "./types";

let outputChannel: vscode.OutputChannel;
let runner: AgentRunner;
let diagnostics: DiagnosticsProvider;
let statusBar: StatusBarManager;
let abortController: AbortController | null = null;
let nodeOk = false;

function checkNodeVersion(): { ok: boolean; version: string | null } {
  try {
    const raw = execSync("node --version", { encoding: "utf8", timeout: 5000 }).trim();
    const major = parseInt(raw.replace("v", "").split(".")[0], 10);
    return { ok: major >= 18, version: raw };
  } catch {
    return { ok: false, version: null };
  }
}

function showNodeError(version: string | null) {
  const msg = version
    ? `AI Code Agents: Node.js ${version} is too old (need v18+).`
    : "AI Code Agents: Node.js not found. Please install Node.js v18+.";
  vscode.window.showErrorMessage(msg, "Download Node.js").then((c) => {
    if (c) vscode.env.openExternal(vscode.Uri.parse("https://nodejs.org/en/download"));
  });
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("AI Code Agents");
  runner = new AgentRunner(outputChannel);
  diagnostics = new DiagnosticsProvider();
  statusBar = new StatusBarManager();

  const nodeCheck = checkNodeVersion();
  nodeOk = nodeCheck.ok;

  if (nodeOk) {
    outputChannel.appendLine(`AI Code Agents: Node.js ${nodeCheck.version} detected. ✓`);
  } else {
    showNodeError(nodeCheck.version);
    statusBar.setState("error", nodeCheck.version ? `Node ${nodeCheck.version} too old` : "Node.js not found");
  }

  const panelProvider = new PanelProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PanelProvider.viewType, panelProvider)
  );

  panelProvider.onDidReceiveMessage(async (msg) => {
    switch (msg.type) {
      case "cancel":
        abortController?.abort();
        return;
      case "fixSelected":
        await fixSelectedTasks(msg.taskIds ?? [], panelProvider);
        return;
      case "tasksLoad":
        await loadTasksFromFile(panelProvider);
        return;
      case "run":
        if (msg.agent) {
          await runAgent(msg.agent, msg.args ?? [], panelProvider);
        }
        return;
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("aiCodeAgents.scan", async () => {
      await runAgent("ai-scanner", [], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.reviewFile", async () => {
      const file = vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!file) { vscode.window.showWarningMessage("Open a file first."); return; }
      await runAgent("code-reviewer-agent", [`--path="${file}"`], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.reviewWorkspace", async () => {
      await runAgent("code-reviewer-agent", [], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.diffReview", async () => {
      await runAgent("diff-reviewer", [], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.taskPlan", async () => {
      await runAgent("tasker-agent", ["--dry-run"], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.fixAll", async () => {
      await runAgent("fixer-agent", ["--apply"], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.fixFile", async () => {
      const file = vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!file) { vscode.window.showWarningMessage("Open a file first."); return; }
      await runAgent("fixer-agent", ["--apply", `--path="${file}"`], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.generateTests", async () => {
      await runAgent("test-agent", ["--apply"], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.generateCommit", async () => {
      await runAgent("commit-agent", ["--staged"], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.fullPipeline", async () => {
      await runAgent("orchestrator", [], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.cancel", () => {
      abortController?.abort();
    }),
    vscode.commands.registerCommand("aiCodeAgents.showPanel", () => {
      outputChannel.show(true);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const config = vscode.workspace.getConfiguration("aiCodeAgents");
      if (!config.get<boolean>("autoReviewOnSave")) return;

      const ignoredExts = [".log", ".lock", ".md", ".json", ".env"];
      const ext = doc.uri.fsPath.slice(doc.uri.fsPath.lastIndexOf("."));
      if (ignoredExts.includes(ext)) return;

      await runAgent("diff-reviewer", [], panelProvider, { silent: true });
    })
  );

  context.subscriptions.push(
    new vscode.Disposable(() => {
      diagnostics.dispose();
      statusBar.dispose();
      outputChannel.dispose();
    })
  );

  outputChannel.appendLine("AI Code Agents activated.");
}

export function deactivate() {}

function guardNode(): boolean {
  if (nodeOk) return true;
  const result = checkNodeVersion();
  nodeOk = result.ok;
  if (!nodeOk) {
    showNodeError(result.version);
    return false;
  }
  statusBar.setState("idle");
  return true;
}

async function runAgent(
  agent: AgentName,
  args: string[],
  panel: PanelProvider,
  opts: { silent?: boolean } = {}
) {
  if (!guardNode()) return;

  if (abortController) {
    vscode.window.showWarningMessage("An agent is already running. Cancel it first.");
    return;
  }

  const agentDef = ALL_AGENTS[agent];
  if (!agentDef) {
    vscode.window.showErrorMessage(`Unknown agent: ${agent}`);
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage("No workspace folder open.");
    return;
  }

  abortController = new AbortController();
  statusBar.setState("running", agentDef.label);
  panel.postState("running", undefined, agentDef.label);
  diagnostics.clear();

  if (!opts.silent) {
    outputChannel.show(true);
  }

  try {
    const result = await runner.run({
      agent,
      args: [...agentDef.defaultArgs, ...args],
      cwd: workspaceRoot,
      token: abortController.signal,
      onStdout: (line) => panel.postLog(line),
      onStderr: (line) => panel.postLog(`[err] ${line}`),
    });

    const reportAgents = new Set(["ai-scanner", "code-reviewer-agent", "diff-reviewer"]);
    const isReportAgent = reportAgents.has(agent);

    const isSuccess = result.exitCode === 0 || result.exitCode === -1
      || (isReportAgent && result.exitCode === 1 && hasReportFile(workspaceRoot));

    if (isSuccess) {
      const config = vscode.workspace.getConfiguration("aiCodeAgents");

      if (agent === "tasker-agent") {
        await loadTasksFromFile(panel);
      }

      if (isReportAgent && config.get<boolean>("showDiagnostics")) {
        const count = await diagnostics.loadFromWorkspace(workspaceRoot);
        if (count > 0) {
          statusBar.setState("issues", `${count} issue(s)`);
          panel.postState("done", count);
          if (!opts.silent) {
            vscode.window.showWarningMessage(
              `AI Code Agents: ${count} issue(s) found.`,
              "Show Problems"
            ).then((c) => {
              if (c) vscode.commands.executeCommand("workbench.action.problems.focus");
            });
          }
        } else {
          statusBar.setState("clean");
          panel.postState("done", 0);
        }
      } else {
        diagnostics.clear();
        statusBar.setState("idle");
        panel.postState("done");
      }
    } else {
      statusBar.setState("error");
      panel.postState("error");
      if (!opts.silent) {
        vscode.window.showErrorMessage(
          `${agentDef.label} failed (exit ${result.exitCode}). Check Output panel.`
        );
      }
    }
  } catch (err: any) {
    statusBar.setState("error", err?.message);
    panel.postState("error");
    outputChannel.appendLine(`Extension error: ${err?.message ?? err}`);
  } finally {
    abortController = null;
  }
}

async function loadTasksFromFile(panel: PanelProvider) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  const taskFile = path.join(workspaceRoot, "ai-tasks.json");
  try {
    const data: AiTasksData = JSON.parse(fs.readFileSync(taskFile, "utf8"));
    if (data.tasks && data.tasks.length > 0) {
      panel.postTasks(data);
    } else {
      panel.clearTasks();
    }
  } catch {
    panel.clearTasks();
  }
}

function hasReportFile(workspaceRoot: string): boolean {
  try {
    const entries = fs.readdirSync(workspaceRoot);
    return entries.some((f) => /^ai-(review|scan|diff-review)-report-\d{4}-\d{2}-\d{2}T.*\.md$/.test(f));
  } catch {
    return false;
  }
}

async function fixSelectedTasks(taskIds: number[], panel: PanelProvider) {
  if (taskIds.length === 0) {
    vscode.window.showWarningMessage("No tasks selected.");
    return;
  }

  const ids = taskIds.join(",");
  outputChannel.appendLine(`\n▶ Fixing selected tasks: ${ids}`);
  await runAgent("tasker-agent", ["--apply", `--task=${ids}`], panel);
}
