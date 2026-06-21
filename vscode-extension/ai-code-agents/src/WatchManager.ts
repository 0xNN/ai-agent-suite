import * as vscode from "vscode";
import * as path from "path";
import { AgentRunner } from "./AgentRunner";
import { PanelProvider } from "./PanelProvider";

interface WatchRule {
  pattern: string;
  agent: string;
}

interface WatchConfig {
  enabled: boolean;
  debounceMs: number;
  agents: WatchRule[];
  excludedPaths: string[];
}

export class WatchManager {
  private timers = new Map<string, NodeJS.Timeout>();
  private disposables: vscode.Disposable[] = [];
  private runner: AgentRunner;
  private panel: PanelProvider;
  private watcher: vscode.FileSystemWatcher | null = null;
  private _onStatusChange = new vscode.EventEmitter<{ watching: boolean; file?: string }>();
  readonly onStatusChange = this._onStatusChange.event;

  constructor(runner: AgentRunner, panel: PanelProvider) {
    this.runner = runner;
    this.panel = panel;
  }

  private loadConfig(): WatchConfig {
    const cfg = vscode.workspace.getConfiguration("aiCodeAgents");
    return {
      enabled: cfg.get<boolean>("watchMode.enabled", false),
      debounceMs: cfg.get<number>("watchMode.debounceMs", 1500),
      agents: cfg.get<WatchRule[]>("watchMode.agents", [
        { pattern: "*.{ts,tsx,js,jsx}", agent: "diff-reviewer" },
        { pattern: "*.{tsx,jsx}", agent: "code-reviewer-agent" },
      ]),
      excludedPaths: cfg.get<string[]>("watchMode.excludedPaths", [
        "node_modules/**", "dist/**", "out/**", ".git/**", "build/**",
      ]),
    };
  }

  private matchAgent(filePath: string): string | null {
    const config = this.loadConfig();
    const basename = path.basename(filePath);
    const relative = path.relative(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
      filePath
    );

    for (const exclude of config.excludedPaths) {
      if (this.globMatch(relative, exclude)) return null;
    }

    for (const rule of config.agents) {
      if (this.globMatch(basename, rule.pattern) || this.globMatch(relative, rule.pattern)) {
        return rule.agent;
      }
    }
    return null;
  }

  private globMatch(text: string, pattern: string): boolean {
    const regexStr = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, ":::GLOBSTAR:::")
      .replace(/\*/g, "[^/]*")
      .replace(/:::/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${regexStr}$`).test(text);
  }

  private debouncedRun(filePath: string, agent: string) {
    const key = `${agent}:${filePath}`;
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key)!);
    }
    this.timers.set(key, setTimeout(async () => {
      this.timers.delete(key);
      this._onStatusChange.fire({ watching: true, file: path.basename(filePath) });
      this.panel.postLog(`[watch] ${agent} → ${path.basename(filePath)}`);
      try {
        await this.runner.run({
          agent: agent as any,
          args: [],
          cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        });
      } catch (err: any) {
        this.panel.postLog(`[watch] Error: ${err.message}`);
      }
      this._onStatusChange.fire({ watching: false });
    }, this.loadConfig().debounceMs));
  }

  start() {
    this.stop();
    const config = this.loadConfig();
    if (!config.enabled) return;

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    const patterns = new Set<string>();
    for (const rule of config.agents) {
      patterns.add(rule.pattern);
    }
    const globPattern = `{${[...patterns].join(",")}}`;

    this.watcher = vscode.workspace.createFileSystemWatcher(globPattern);

    this.disposables.push(
      this.watcher.onDidChange((uri) => {
        const agent = this.matchAgent(uri.fsPath);
        if (agent) this.debouncedRun(uri.fsPath, agent);
      }),
      this.watcher.onDidCreate((uri) => {
        const agent = this.matchAgent(uri.fsPath);
        if (agent) this.debouncedRun(uri.fsPath, agent);
      }),
    );

    this._onStatusChange.fire({ watching: true });
    this.panel.postLog(`[watch] Watching ${patterns.size} pattern(s), ${config.debounceMs}ms debounce`);
  }

  stop() {
    for (const [, t] of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    if (this.watcher) { this.watcher.dispose(); this.watcher = null; }
    this._onStatusChange.fire({ watching: false });
  }

  isActive(): boolean {
    return this.watcher !== null;
  }

  restart() {
    if (this.isActive()) this.stop();
    this.start();
  }

  dispose() {
    this.stop();
    this._onStatusChange.dispose();
  }
}
