export type AgentName =
  | "ai-scanner"
  | "code-reviewer-agent"
  | "diff-reviewer"
  | "tasker-agent"
  | "fixer-agent"
  | "test-agent"
  | "commit-agent"
  | "orchestrator";

export type AgentCategory = "scan" | "review" | "fix" | "test" | "commit" | "pipeline";

export interface AgentDef {
  cli: AgentName;
  label: string;
  icon: string;
  category: AgentCategory;
  needsApiKey: boolean;
  defaultArgs: string[];
}

export const ALL_AGENTS: Record<AgentName, AgentDef> = {
  "ai-scanner":          { cli: "ai-scanner",          label: "Scan (local)",         icon: "🔍", category: "scan",    needsApiKey: false, defaultArgs: [] },
  "code-reviewer-agent": { cli: "code-reviewer-agent", label: "Review Workspace",     icon: "🔬", category: "review",  needsApiKey: true,  defaultArgs: [] },
  "diff-reviewer":       { cli: "diff-reviewer",       label: "Diff Review (fast)",   icon: "📝", category: "review",  needsApiKey: true,  defaultArgs: [] },
  "tasker-agent":        { cli: "tasker-agent",        label: "Plan Tasks",           icon: "📋", category: "review",  needsApiKey: false, defaultArgs: ["--dry-run"] },
  "fixer-agent":         { cli: "fixer-agent",          label: "Fix All Issues",       icon: "🔧", category: "fix",     needsApiKey: true,  defaultArgs: ["--apply"] },
  "test-agent":          { cli: "test-agent",           label: "Generate Tests",       icon: "🧪", category: "test",    needsApiKey: true,  defaultArgs: ["--apply"] },
  "commit-agent":        { cli: "commit-agent",         label: "Generate Commit",      icon: "💬", category: "commit",  needsApiKey: true,  defaultArgs: ["--staged"] },
  "orchestrator":        { cli: "orchestrator",         label: "Full Pipeline",        icon: "🚀", category: "pipeline",needsApiKey: false, defaultArgs: [] },
};

export interface RunOptions {
  agent: AgentName;
  args?: string[];
  cwd?: string;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  token?: AbortSignal;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface PanelMessage {
  type: "run" | "cancel" | "fixSelected" | "tasksLoad" | "openSettings" | "toggleWatch";
  agent?: string;
  args?: string[];
  taskIds?: number[];
}

export interface Finding {
  severity: string;
  category: string;
  file: string;
  lines: string;
  issue: string;
  recommendation: string;
}

export interface AiTask {
  id: number;
  priority: string;
  type: string;
  complexity: string;
  files: string[];
  description: string;
  why: string;
  findings: number[];
}

export interface AiTasksData {
  completed: number[];
  tasks: AiTask[];
}
