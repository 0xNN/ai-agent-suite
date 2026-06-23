import * as vscode from "vscode";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { AgentRunner } from "./AgentRunner";
import { DiagnosticsProvider } from "./DiagnosticsProvider";
import { StatusBarManager } from "./StatusBarManager";
import { PanelProvider } from "./PanelProvider";
import { AgentName, ALL_AGENTS, AiTasksData } from "./types";
import { AIReviewCodeActionProvider, registerIgnoreCommand } from "./CodeActionProvider";
import { WatchManager } from "./WatchManager";
import { installAgents, resolveAgentScript, agentsAvailable } from "./setupAgents";

let outputChannel: vscode.OutputChannel;
let runner: AgentRunner;
let diagnostics: DiagnosticsProvider;
let statusBar: StatusBarManager;
let watchManager: WatchManager;
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

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("AI Code Agents");

  const nodeCheck = checkNodeVersion();
  nodeOk = nodeCheck.ok;

  if (nodeOk) {
    outputChannel.appendLine(`AI Code Agents: Node.js ${nodeCheck.version} detected. ✓`);
  } else {
    showNodeError(nodeCheck.version);
    statusBar.setState("error", nodeCheck.version ? `Node ${nodeCheck.version} too old` : "Node.js not found");
  }

  if (nodeOk) {
    if (!agentsAvailable()) {
      outputChannel.appendLine("AI Code Agents: Installing agents...");
      const installed = await installAgents(context);
      if (installed) {
        outputChannel.appendLine("AI Code Agents: Agents installed successfully. ✓");
        vscode.window.showInformationMessage("AI Code Agents: Agents installed. Ready to use.");
      } else {
        outputChannel.appendLine("AI Code Agents: Agent installation failed.");
      }
    } else {
      outputChannel.appendLine("AI Code Agents: Agents already installed. ✓");
    }
  }

  runner = new AgentRunner(outputChannel, context);
  diagnostics = new DiagnosticsProvider();
  statusBar = new StatusBarManager();

  const panelProvider = new PanelProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PanelProvider.viewType, panelProvider, { webviewOptions: { retainContextWhenHidden: true } })
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ pattern: "**/*" }, new AIReviewCodeActionProvider(), {
      providedCodeActionKinds: AIReviewCodeActionProvider.providedCodeActionKinds,
    })
  );

  registerIgnoreCommand(context, outputChannel);

  watchManager = new WatchManager(runner, panelProvider);

  watchManager.onStatusChange(({ watching }) => {
    panelProvider.postWatchStatus(watching);
    if (watching) {
      statusBar.setState("watching");
    } else {
      const config = vscode.workspace.getConfiguration("aiCodeAgents");
      if (config.get<boolean>("watchMode.enabled")) {
        statusBar.setState("idle");
      }
    }
  });

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
      case "openSettings":
vscode.commands.executeCommand("workbench.action.openSettings", "AI Code Agents");
        return;
      case "toggleWatch":
        await toggleWatchMode(panelProvider);
        return;
      case "run":
        if (msg.agent) {
          await runAgent(msg.agent as AgentName, msg.args ?? [], panelProvider);
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
    vscode.commands.registerCommand("aiCodeAgents.securityAudit", async () => {
      await runAgent("security-agent", [], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.securityAuditFile", async () => {
      const file = vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!file) { vscode.window.showWarningMessage("Open a file first."); return; }
      await runAgent("security-agent", [`--path="${file}"`], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.taskPlan", async () => {
      await runAgent("tasker-agent", ["--dry-run"], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.fixAll", async () => {
      await runAgent("fixer-agent", ["--apply", "--learn"], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.fixFile", async () => {
      const file = vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!file) { vscode.window.showWarningMessage("Open a file first."); return; }
      await runAgent("fixer-agent", ["--apply", "--learn", `--path="${file}"`], panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.fixFileWithPreview", async () => {
      const file = vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!file) { vscode.window.showWarningMessage("Open a file first."); return; }
      await previewAndFixFile(file, panelProvider, outputChannel);
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
    vscode.commands.registerCommand("aiCodeAgents.toggleWatch", async () => {
      await toggleWatchMode(panelProvider);
    }),
    vscode.commands.registerCommand("aiCodeAgents.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "AI Code Agents");
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
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("aiCodeAgents")) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) return;
        const supFile = path.join(root, ".ai-learning", "suppressions.json");
        if (fs.existsSync(supFile)) {
          try {
            const suppressions = JSON.parse(fs.readFileSync(supFile, "utf8"));
            if (Array.isArray(suppressions) && suppressions.length > 0) {
              outputChannel.appendLine(`[learn] ${suppressions.length} suppression(s) active`);
            }
          } catch {}
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("aiCodeAgents.watchMode")) {
        watchManager.restart();
      }
    })
  );

  context.subscriptions.push(
    new vscode.Disposable(() => {
      diagnostics.dispose();
      statusBar.dispose();
      watchManager.dispose();
      outputChannel.dispose();
    })
  );

  if (vscode.workspace.getConfiguration("aiCodeAgents").get<boolean>("watchMode.enabled")) {
    watchManager.start();
  }

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

async function toggleWatchMode(panel: PanelProvider) {
  const config = vscode.workspace.getConfiguration("aiCodeAgents");
  const current = config.get<boolean>("watchMode.enabled", false);
  await config.update("watchMode.enabled", !current, vscode.ConfigurationTarget.Workspace);
  outputChannel.appendLine(`Watch mode: ${!current ? "ON" : "OFF"}`);
  if (!current) {
    watchManager.start();
  } else {
    watchManager.stop();
  }
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

async function previewAndFixFile(file: string, panel: PanelProvider, log: vscode.OutputChannel) {
  if (!guardNode()) return;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) { vscode.window.showWarningMessage("No workspace folder open."); return; }

  if (!hasReportFile(workspaceRoot)) {
    const runReview = await vscode.window.showInformationMessage(
      "No review report found. Run review first?",
      { modal: true },
      "Review Workspace"
    );
    if (runReview) {
      await runAgent("code-reviewer-agent", [], panel);
      if (!hasReportFile(workspaceRoot)) return;
    } else {
      return;
    }
  }

  abortController = new AbortController();
  statusBar.setState("running", "Preview fix");
  panel.postState("running", undefined, "Preview fix");
  log.show(true);
  log.appendLine(`\n▶ Preview fix for: ${file}`);

  try {
    const result = await runner.run({
      agent: "fixer-agent",
      args: ["--diff"],
      cwd: workspaceRoot,
      token: abortController.signal,
      onStdout: (line) => panel.postLog(line),
      onStderr: (line) => panel.postLog(`[err] ${line}`),
    });

    if (result.exitCode !== 0) {
      vscode.window.showErrorMessage("Fix preview failed. Check output.");
      return;
    }

    const allDiffs = parseDiffs(result.stdout);
    const diffs = allDiffs.filter((d) => d.file === file);

    if (diffs.length === 0) {
      vscode.window.showInformationMessage("No changes suggested for this file.");
      statusBar.setState("clean");
      panel.postState("done", 0);
      return;
    }

    const encoder = new TextEncoder();

    for (const d of diffs) {
      const uri = vscode.Uri.file(d.file);
      const origUri = uri.with({ scheme: "ai-fix-orig" });
      const fixUri = uri.with({ scheme: "ai-fix-new" });

      await vscode.workspace.fs.writeFile(origUri, encoder.encode(d.original));
      await vscode.workspace.fs.writeFile(fixUri, encoder.encode(d.fixed));

      await vscode.commands.executeCommand("vscode.diff", origUri, fixUri, `Fix preview: ${path.basename(d.file)}`);
    }

    const apply = await vscode.window.showInformationMessage(
      `Apply fix for ${path.basename(file)}?`,
      { modal: true },
      "Apply",
      "Cancel"
    );

    if (apply === "Apply") {
      log.appendLine("▶ Applying fixes...");
      await runAgent("fixer-agent", ["--apply"], panel);
      statusBar.setState("idle");
      panel.postState("done");
      vscode.window.showInformationMessage("Fixes applied.");
    } else {
      statusBar.setState("idle");
      panel.postState("done", 0);
      log.appendLine("✗ Cancelled by user.");
    }
  } catch (err: any) {
    statusBar.setState("error", err?.message);
    panel.postState("error");
    log.appendLine(`Extension error: ${err?.message ?? err}`);
  } finally {
    abortController = null;
  }
}

function parseDiffs(stdout: string): { file: string; original: string; fixed: string }[] {
  const results: { file: string; original: string; fixed: string }[] = [];
  const lines = stdout.split("\n");
  let i = 0;

  while (i < lines.length) {
    const diffMatch = lines[i].match(/^## DIFF: (.+)$/);
    if (!diffMatch) { i++; continue; }
    const file = diffMatch[1];

    const origLines: string[] = [];
    const fixLines: string[] = [];
    let reading = 0; // 0=none, 1=orig, 2=fixed

    i++;
    while (i < lines.length && !lines[i].startsWith("## ENDDIFF")) {
      const line = lines[i];
      if (reading === 0) {
        if (line.startsWith("--- a/")) reading = 1;
        else reading = 0;
      } else if (reading === 1) {
        if (line.startsWith("+++ b/")) reading = 2;
        else if (line.startsWith("---")) { /* skip */ }
      } else if (reading === 2) {
        if (line.startsWith("@@ ")) { /* skip hunk header */ }
        else if (line.startsWith("-")) origLines.push(line.slice(1));
        else if (line.startsWith("+")) fixLines.push(line.slice(1));
        else { origLines.push(line.slice(1)); fixLines.push(line.slice(1)); }
      }
      i++;
    }

    results.push({ file, original: origLines.join("\n"), fixed: fixLines.join("\n") });
    i++;
  }
  return results;
}

async function fixSelectedTasks(taskIds: number[], panel: PanelProvider) {
  if (taskIds.length === 0) {
    vscode.window.showWarningMessage("No tasks selected.");
    return;
  }

  const ids = taskIds.join(",");
  outputChannel.appendLine(`\n▶ Fixing selected tasks: ${ids}`);
  await runAgent("tasker-agent", ["--apply", "--learn", `--task=${ids}`], panel);
}

function appendLearningEvent(root: string, event: Record<string, unknown>) {
  try {
    const dir = path.join(root, ".ai-learning");
    const file = path.join(dir, "events.ndjson");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + "\n";
    fs.appendFileSync(file, line, "utf8");
  } catch {}
}
