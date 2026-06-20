import { spawn } from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import { AgentName, RunOptions, RunResult } from "./types";

const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(text: string): string {
  return text.replace(ansiRegex, "");
}

export class AgentRunner {
  private outputChannel: vscode.OutputChannel;
  private lineBuffer = "";

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  private resolveCommand(agent: AgentName): { command: string; shell: boolean } {
    const isWin = process.platform === "win32";

    if (isWin) {
      return { command: `${agent}.cmd`, shell: true };
    }

    return { command: agent, shell: false };
  }

  async run(opts: RunOptions): Promise<RunResult> {
    const { agent, args = [], cwd, onStdout, onStderr, token } = opts;

    const config = vscode.workspace.getConfiguration("aiCodeAgents");
    const apiKey = config.get<string>("apiKey") ?? "";
    const modelSetting = config.get<string>("model") ?? "";
    const baseUrlSetting = config.get<string>("baseUrl") ?? "";
    const provider = config.get<string>("provider") ?? "";
    const lang = config.get<string>("language") ?? "en";
    const stream = config.get<boolean>("streamOutput") ?? false;
    const workdir = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    const providerDefaults: Record<string, { model: string; baseUrl: string }> = {
      openai:   { model: "gpt-4o",                              baseUrl: "https://api.openai.com/v1" },
      anthropic:{ model: "claude-sonnet-4-20250514",             baseUrl: "https://api.anthropic.com/v1" },
      nvidia:   { model: "deepseek-ai/deepseek-v4-flash",        baseUrl: "https://integrate.api.nvidia.com/v1" },
      minimax:  { model: "minimax-m2.7",                         baseUrl: "https://api.minimax.chat/v1" },
    };

    const defaults = provider ? providerDefaults[provider] : undefined;
    const model = modelSetting || defaults?.model || "";
    const baseUrl = baseUrlSetting || defaults?.baseUrl || "";

    const { command, shell } = this.resolveCommand(agent);

    const finalArgs: string[] = [
      ...args,
      `--path="${workdir}"`,
    ];

    if (lang === "id" && agent !== "ai-scanner" && agent !== "orchestrator") {
      finalArgs.push("--lang=id");
    }

    if (stream && (agent === "code-reviewer-agent" || agent === "diff-reviewer")) {
      finalArgs.push("--stream");
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(apiKey ? { CODE_REVIEW_API_KEY: apiKey } : {}),
      ...(model ? { CODE_REVIEW_MODEL: model } : {}),
      ...(baseUrl ? { CODE_REVIEW_BASE_URL: baseUrl } : {}),
    };

    this.outputChannel.appendLine(`\n▶ ${agent} ${finalArgs.join(" ")}`);
    this.outputChannel.appendLine("─".repeat(60));

    this.lineBuffer = "";

    return new Promise((resolve) => {
      const child = spawn(command, finalArgs, {
        cwd: workdir,
        env,
        shell,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      const emitLine = (line: string, source: "stdout" | "stderr") => {
        const cleaned = stripAnsi(line).trim();
        if (!cleaned) return;
        this.outputChannel.appendLine(cleaned);
        if (source === "stdout") onStdout?.(cleaned);
        else onStderr?.(cleaned);
      };

      const onData = (chunk: Buffer, source: "stdout" | "stderr") => {
        const text = chunk.toString();
        if (source === "stdout") stdout += text;
        else stderr += text;

        this.lineBuffer += text;

        const parts = this.lineBuffer.split(/\r?\n/);
        this.lineBuffer = parts.pop() ?? "";

        for (const raw of parts) {
          if (!raw.trim()) continue;

          const segments = raw.split("\r");
          const last = segments[segments.length - 1].trim();
          if (last) emitLine(last, source);
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => onData(chunk, "stdout"));
      child.stderr?.on("data", (chunk: Buffer) => onData(chunk, "stderr"));

      token?.addEventListener("abort", () => {
        child.kill("SIGTERM");
        resolve({ exitCode: -1, stdout, stderr });
      });

      child.on("close", (code) => {
        if (this.lineBuffer.trim()) {
          emitLine(this.lineBuffer, "stdout");
        }
        this.lineBuffer = "";

        const exitCode = code ?? 1;
        this.outputChannel.appendLine(`\n✓ ${agent} exited with code ${exitCode}\n`);
        resolve({ exitCode, stdout, stderr });
      });

      child.on("error", (err) => {
        const msg = `Failed to spawn ${agent}: ${err.message}`;
        this.outputChannel.appendLine(`✗ ${msg}`);

        if ((err as any).code === "ENOENT") {
          this.outputChannel.appendLine(
            `  → Agent '${agent}' is not installed globally. Run: npm install -g ./${agent}-agent`
          );
        }

        resolve({ exitCode: 1, stdout, stderr: msg });
      });
    });
  }
}
