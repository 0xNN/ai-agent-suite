import * as vscode from "vscode";

export type StatusBarState =
  | "idle"
  | "running"
  | "issues"
  | "clean"
  | "error"
  | "watching";

export class StatusBarManager {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.item.command = "aiCodeAgents.showPanel";
    this.setState("idle");
    this.item.show();
  }

  setState(state: StatusBarState, detail?: string) {
    switch (state) {
      case "idle":
        this.item.text = "$(robot) AI Agents";
        this.item.tooltip = "Click to open AI Code Agents panel";
        this.item.color = undefined;
        break;
      case "running":
        this.item.text = `$(sync~spin) ${detail ?? "Running…"}`;
        this.item.tooltip = "Agent is running…";
        this.item.color = new vscode.ThemeColor("statusBarItem.warningBackground");
        break;
      case "issues":
        this.item.text = `$(warning) ${detail ?? "Issues found"}`;
        this.item.tooltip = "AI Agents found issues — click to view";
        this.item.color = new vscode.ThemeColor("statusBarItem.warningForeground");
        break;
      case "clean":
        this.item.text = "$(check) No Issues";
        this.item.tooltip = "AI Agents: all clear";
        this.item.color = undefined;
        break;
      case "error":
        this.item.text = "$(error) Agent Failed";
        this.item.tooltip = detail ?? "An agent failed — check Output panel";
        this.item.color = new vscode.ThemeColor("statusBarItem.errorBackground");
        break;
      case "watching":
        this.item.text = `$(eye) ${detail ?? "Watching…"}`;
        this.item.tooltip = "Watch mode active — auto-reviewing changes";
        this.item.color = new vscode.ThemeColor("statusBarItem.prominentForeground");
        break;
    }
  }

  dispose() {
    this.item.dispose();
  }
}
