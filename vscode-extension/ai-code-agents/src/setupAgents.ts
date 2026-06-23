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

export function resolveAgentScript(agent: string, context: vscode.ExtensionContext): string | null {
  const agentDir = getAgentDir(context);
  const scriptMap: Record<string, string> = {
    "ai-scanner": path.join(agentDir, "scan-agent", "scripts", "ai-scanner.mjs"),
    "scan-agent": path.join(agentDir, "scan-agent", "scripts", "ai-scanner.mjs"),
    "code-reviewer-agent": path.join(agentDir, "code-reviewer-agent", "scripts", "ai-code-reviewer.mjs"),
    "commit-agent": path.join(agentDir, "commit-agent", "scripts", "ai-commit-generator.mjs"),
    "diff-reviewer": path.join(agentDir, "diff-reviewer-agent", "scripts", "ai-diff-reviewer.mjs"),
    "fixer-agent": path.join(agentDir, "fixer-agent", "scripts", "ai-fixer.mjs"),
    "learn-agent": path.join(agentDir, "learn-agent", "scripts", "ai-learner.mjs"),
    "orchestrator": path.join(agentDir, "orchestrator-agent", "scripts", "orchestrator.mjs"),
    "tasker-agent": path.join(agentDir, "tasker-agent", "scripts", "ai-task-generator.mjs"),
    "test-agent": path.join(agentDir, "test-agent", "scripts", "ai-test-agent.mjs"),
    "security-agent": path.join(agentDir, "security-agent", "scripts", "ai-security-agent.mjs"),
  };

  const script = scriptMap[agent];
  if (script && fs.existsSync(script)) {
    return script;
  }
  return null;
}
