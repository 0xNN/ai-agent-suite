import * as vscode from "vscode";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const AGENTS_REPO = "https://github.com/0xNN/ai-agent-suite.git";
const AGENT_NAMES = [
  "scan-agent", "code-reviewer-agent", "commit-agent", "diff-reviewer-agent",
  "fixer-agent", "learn-agent", "orchestrator-agent", "tasker-agent", "test-agent",
  "security-agent",
];

const AGENT_BINS: Record<string, string[]> = {
  "scan-agent": ["ai-scanner", "scan-agent"],
  "code-reviewer-agent": ["code-reviewer-agent"],
  "commit-agent": ["commit-agent"],
  "diff-reviewer-agent": ["diff-reviewer"],
  "fixer-agent": ["fixer-agent"],
  "learn-agent": ["learn-agent"],
  "orchestrator-agent": ["orchestrator"],
  "tasker-agent": ["tasker-agent"],
  "test-agent": ["test-agent"],
  "security-agent": ["security-agent"],
};

function getAgentDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "agents");
}

function binExists(binName: string): boolean {
  try {
    const cmd = process.platform === "win32" ? `where ${binName}` : `which ${binName}`;
    execSync(cmd, { encoding: "utf8", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export function agentsAvailable(): boolean {
  return binExists("ai-scanner");
}

export async function installAgents(context: vscode.ExtensionContext): Promise<boolean> {
  const agentDir = getAgentDir(context);

  if (fs.existsSync(agentDir)) {
    return true;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "AI Code Agents: Installing agents...",
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ message: "Cloning repository..." });
        fs.mkdirSync(agentDir, { recursive: true });
        execSync(`git clone --depth 1 ${AGENTS_REPO} "${agentDir}"`, {
          stdio: "pipe",
          timeout: 120000,
        });

        for (let i = 0; i < AGENT_NAMES.length; i++) {
          const name = AGENT_NAMES[i];
          progress.report({ message: `Installing ${name}...`, increment: Math.round((i / AGENT_NAMES.length) * 100) });
          const pkgDir = path.join(agentDir, name);
          execSync("npm install --production", { cwd: pkgDir, stdio: "pipe", timeout: 60000 });
        }

        return true;
      } catch (err) {
        vscode.window.showErrorMessage(`AI Code Agents: Failed to install agents. ${err instanceof Error ? err.message : ""}`);
        try { fs.rmSync(agentDir, { recursive: true, force: true }); } catch {}
        return false;
      }
    }
  );
}

function getBundledAgentDir(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "agents");
}

export function resolveAgentScript(agent: string, context: vscode.ExtensionContext): string | null {
  const scriptMap: Record<string, string> = {
    "ai-scanner": "scan-agent/scripts/ai-scanner.mjs",
    "scan-agent": "scan-agent/scripts/ai-scanner.mjs",
    "code-reviewer-agent": "code-reviewer-agent/scripts/ai-code-reviewer.mjs",
    "commit-agent": "commit-agent/scripts/ai-commit-generator.mjs",
    "diff-reviewer": "diff-reviewer-agent/scripts/ai-diff-reviewer.mjs",
    "fixer-agent": "fixer-agent/scripts/ai-fixer.mjs",
    "learn-agent": "learn-agent/scripts/ai-learner.mjs",
    "orchestrator": "orchestrator-agent/scripts/orchestrator.mjs",
    "tasker-agent": "tasker-agent/scripts/ai-task-generator.mjs",
    "test-agent": "test-agent/scripts/ai-test-agent.mjs",
    "security-agent": "security-agent/scripts/ai-security-agent.mjs",
  };

  const relative = scriptMap[agent];
  if (!relative) return null;

  // 1. Check bundled agents (inside VSIX)
  const bundledPath = path.join(getBundledAgentDir(context), relative);
  if (fs.existsSync(bundledPath)) return bundledPath;

  // 2. Check globally installed agents (globalStorageUri)
  const globalPath = path.join(getAgentDir(context), relative);
  if (fs.existsSync(globalPath)) return globalPath;

  return null;
}
