import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

function getAgentsDir(context: vscode.ExtensionContext): string {
  return path.join(context.extensionUri.fsPath, "agents");
}

export function agentsAvailable(): boolean {
  return true;
}

export async function installAgents(context: vscode.ExtensionContext): Promise<boolean> {
  const dir = getAgentsDir(context);
  const ok = fs.existsSync(dir);
  if (!ok) {
    vscode.window.showErrorMessage("AI Code Agents: Agent bundle not found. Reinstall the extension.");
  }
  return ok;
}

export function resolveAgentScript(agent: string, context: vscode.ExtensionContext): string | null {
  const agentDir = getAgentsDir(context);
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
  };

  const script = scriptMap[agent];
  if (script && fs.existsSync(script)) {
    return script;
  }
  return null;
}
