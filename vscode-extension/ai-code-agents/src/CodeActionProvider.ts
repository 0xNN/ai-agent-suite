import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { AgentRunner } from "./AgentRunner";

export class AIReviewCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const ourDiags = context.diagnostics.filter((d) => d.source === "ai-code-agents");
    if (ourDiags.length === 0) return [];

    const actions: vscode.CodeAction[] = [];
    const file = document.uri.fsPath;
    const seenCats = new Set<string>();

    for (const diag of ourDiags) {
      const cat = (diag.code as string) ?? "";

      if (!seenCats.has(cat)) {
        seenCats.add(cat);

        const fix = new vscode.CodeAction(`✨ Fix ${cat}`, vscode.CodeActionKind.QuickFix);
        fix.isPreferred = true;
        fix.command = { command: "aiCodeAgents.fixFile", title: "", arguments: [] };
        actions.push(fix);

        const ignore = new vscode.CodeAction(`⏭ Ignore ${cat}`, vscode.CodeActionKind.QuickFix);
        const ws = vscode.workspace.getWorkspaceFolder(document.uri);
        const root = ws?.uri.fsPath ?? path.dirname(file);
        ignore.command = {
          command: "aiCodeAgents.codeActionIgnore",
          title: "",
          arguments: [root, cat, file, diag.range.start.line + 1, diag.message.split("\n")[0].substring(0, 80)],
        };
        actions.push(ignore);
      }
    }

    actions.push(
      new vscode.CodeAction("🔬 Review file", vscode.CodeActionKind.QuickFix),
      new vscode.CodeAction("🧪 Generate tests", vscode.CodeActionKind.QuickFix),
    );
    actions[2].command = { command: "aiCodeAgents.reviewFile", title: "", arguments: [] };
    actions[3].command = { command: "aiCodeAgents.generateTests", title: "", arguments: [] };

    return actions;
  }
}

export function registerIgnoreCommand(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
  context.subscriptions.push(
    vscode.commands.registerCommand("aiCodeAgents.codeActionIgnore", (
      root: string, cat: string, file: string, line: number, issue: string
    ) => {
      const ignoreFile = path.join(root, ".ai-reviewer-ignore");
      const entry = JSON.stringify({ category: cat, file: path.relative(root, file), line, issue });
      try {
        const existing = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8").trim() : "";
        const lines = existing ? existing.split("\n") : [];
        lines.push(entry);
        fs.writeFileSync(ignoreFile, lines.join("\n") + "\n");
        outputChannel.appendLine(`⏭ Ignored: ${cat} in ${path.relative(root, file)}:${line}`);
        vscode.window.showInformationMessage("Issue ignored. Added to .ai-reviewer-ignore");
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to ignore: ${err.message}`);
      }
    })
  );
}
