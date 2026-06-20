import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Finding } from "./types";

export class DiagnosticsProvider {
  private collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection("ai-code-agents");
  }

  dispose() {
    this.collection.dispose();
  }

  clear() {
    this.collection.clear();
  }

  async loadFromWorkspace(workspaceRoot: string): Promise<number> {
    const reportFile = this.findLatestReport(workspaceRoot, "ai-review-report");
    if (!reportFile) return 0;
    return this.loadFromFile(reportFile, workspaceRoot);
  }

  loadFromFile(reportFile: string, workspaceRoot: string): number {
    const content = fs.readFileSync(reportFile, "utf8");
    const findings = this.parseFindings(content);
    this.pushDiagnostics(findings, workspaceRoot);
    return findings.length;
  }

  private pushDiagnostics(findings: Finding[], workspaceRoot: string) {
    const map = new Map<string, vscode.Diagnostic[]>();

    for (const f of findings) {
      const absPath = path.resolve(workspaceRoot, f.file);
      const uri = vscode.Uri.file(absPath);
      const key = uri.toString();

      if (!map.has(key)) map.set(key, []);

      const range = this.parseRange(f.lines);
      const severity = this.mapSeverity(f.severity);

      const message = f.recommendation
        ? `[${f.category}] ${f.issue}\n💡 ${f.recommendation}`
        : `[${f.category}] ${f.issue}`;

      const diag = new vscode.Diagnostic(range, message, severity);
      diag.source = "ai-code-agents";
      diag.code = f.category;

      map.get(key)!.push(diag);
    }

    this.collection.clear();
    for (const [uriStr, diags] of map) {
      this.collection.set(vscode.Uri.parse(uriStr), diags);
    }
  }

  private parseRange(linesRaw: string): vscode.Range {
    const match = linesRaw.match(/^(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/);
    if (!match) {
      return new vscode.Range(0, 0, 0, 999);
    }

    const startLine = Math.max(0, parseInt(match[1]) - 1);
    const startChar = match[2] ? parseInt(match[2]) - 1 : 0;
    const endLine = match[3] ? Math.max(0, parseInt(match[3]) - 1) : startLine;
    const endChar = match[4] ? parseInt(match[4]) - 1 : 999;

    return new vscode.Range(startLine, startChar, endLine, endChar);
  }

  private mapSeverity(severity: string): vscode.DiagnosticSeverity {
    switch (severity.toLowerCase()) {
      case "critical":
      case "error":
      case "high":
        return vscode.DiagnosticSeverity.Error;
      case "warning":
      case "medium":
        return vscode.DiagnosticSeverity.Warning;
      case "info":
      case "low":
        return vscode.DiagnosticSeverity.Information;
      default:
        return vscode.DiagnosticSeverity.Hint;
    }
  }

  private findLatestReport(baseDir: string, prefix: string): string | null {
    try {
      const entries = fs.readdirSync(baseDir);
      const reports = entries
        .filter((f) => new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}T.*\\.md$`).test(f))
        .sort()
        .reverse();
      return reports.length > 0 ? path.join(baseDir, reports[0]) : null;
    } catch {
      return null;
    }
  }

  private parseFindings(reportText: string): Finding[] {
    const lines = reportText.split(/\r?\n/);
    const findings: Finding[] = [];
    let inTable = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("| ---")) { inTable = true; continue; }
      if (!inTable || !trimmed.startsWith("|") || trimmed.startsWith("| Severity")) continue;

      const cells = trimmed.split("|")
        .map((c) => c.replace(/<[^>]+>/g, "").trim())
        .filter(Boolean);

      if (cells.length < 5) continue;

      findings.push({
        severity: cells[0],
        category: cells[1],
        file: cells[2].replace(/^`|`$/g, "").trim(),
        lines: cells[3].replace(/^`|`$/g, "").trim(),
        issue: cells[4],
        recommendation: cells.slice(5).join(" | "),
      });
    }

    return findings;
  }
}
