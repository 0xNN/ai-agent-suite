#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pathArg = process.argv.find((arg) => arg.startsWith("--path="))?.slice("--path=".length);
const root = pathArg ? path.resolve(pathArg) : process.cwd();
const quiet = process.argv.includes("--quiet");
const skipBigFile = process.argv.includes("--skip-big-file");

const MAX_FILE_SIZE = 500 * 1024;
const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte",
  ".dart", ".go", ".rs", ".py", ".rb", ".php", ".java", ".kt", ".swift",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".scala", ".ex", ".exs",
]);
const EXCLUDE_DIRS = new Set(["node_modules", ".dart_tool", "build", "dist", "coverage", ".git", ".next", ".cache", "vendor", ".pub-cache", ".idea", ".vscode", "Pods", ".build", "DerivedData"]);

function buildLineChecks(ext) {
  const isDart = ext === ".dart";
  const isGo = ext === ".go";
  return [
    {
      name: "console",
      severity: "low",
      category: "CONSOLE",
      test: (line) => {
        if (isDart) return /\b(print|debugPrint|log)\(/.test(line);
        if (isGo) return /fmt\.(Print|Printf|Println)\(/.test(line);
        return /console\.(log|debug|info|warn|error)\(/.test(line);
      },
      message: (line) => `Debug output left in production: ${line.trim().substring(0, 80)}`,
    },
    {
      name: "todo",
      severity: "low",
      category: "TODO",
      test: (line) => /\/\/\s*(TODO|FIXME|HACK|XXX|TEMP)\b/i.test(line),
      message: (line) => line.trim().substring(0, 100),
    },
    {
      name: "debugger",
      severity: "medium",
      category: "DEBUGGER",
      test: (line) => {
        if (isDart) return /^\s*debugger\s*\(/.test(line);
        return /^\s*debugger;?\s*$/.test(line);
      },
      message: () => "debugger statement left in production code",
    },
    {
      name: "secret",
      severity: "high",
      category: "SECRETS",
      test: (line) => {
        if (/\/\/\s*(TODO|FIXME)/i.test(line)) return false;
        const pattern = /(api[_-]?key|secret|token|password|credential|passwd|private_key)\s*[:=]\s*["']([^"']{8,})["']/i;
        const match = line.match(pattern);
        if (!match) return false;
        if (/process\.env|import\.meta\.env|Platform\.environment/i.test(line)) return false;
        return true;
      },
      message: (line) => {
        const match = line.match(/(api[_-]?key|secret|token|password|credential)/i);
        return `Possible hardcoded ${match?.[1] ?? "secret"} in source`;
      },
    },
    {
      name: "empty_catch",
      severity: "medium",
      category: "EMPTY_CATCH",
      test: (line) => {
        const trimmed = line.trim();
        if (/^\}\s*(catch|on)/.test(trimmed)) return false;
        return /(catch|on\s+\w+)\s*(\([\w\s:]+\))?\s*\{[\s]*\}/.test(trimmed) && !/\/\/\s*(TODO|FIXME)/i.test(line);
      },
      message: () => "Empty catch block silently swallows errors",
    },
    {
      name: "magic_number",
      severity: "low",
      category: "MAGIC_NUMBERS",
      test: (line) => {
        const skipPatterns = /import\s|require\(|from\s|\.test\(|\.spec\(|padding|margin|width|height|fontSize|zIndex|opacity|flex|grid|gap|borderRadius|\d+-\d+-\d+|http|\/\/|['"`]|\.css|px|%|ms|: \d+[a-z]/i;
        if (skipPatterns.test(line)) return false;
        const match = line.match(/(?<!=)\b[3-9]\d{3,}\b(?!\s*(px|%|ms|rem|em))/);
        return !!match;
      },
      message: (line) => {
        const m = line.match(/\b[3-9]\d{3,}\b/);
        return `Magic number: ${m?.[0] ?? "?"} — consider a named constant`;
      },
    },
    {
      name: "hardcoded_url",
      severity: "low",
      category: "HARDCODED_URL",
      test: (line) => {
        if (/\/\/\s*(TODO|FIXME)/i.test(line)) return false;
        if (/(localhost|https?:\/\/[\w.-]+)/i.test(line)) {
          return !/(baseURL|baseUrl|BASE_URL|endpoint|ENDPOINT|\.env|mock|example\.com)/i.test(line);
        }
        return false;
      },
      message: (line) => `Hardcoded URL: ${line.trim().substring(0, 80)}`,
    },
    {
      name: "var_keyword",
      severity: "low",
      category: "LEGACY",
      test: (line) => {
        if (isDart || isGo) return false;
        return /^\s*var\s+\w+/.test(line) && !/\/\/\s*(TODO|FIXME)/i.test(line);
      },
      message: (line) => `Legacy 'var' keyword: ${line.trim().substring(0, 60)}`,
    },
    {
      name: "any_type",
      severity: "low",
      category: "UNSAFE_TYPE",
      test: (line) => {
        if (/\/\/\s*(TODO|FIXME)|eslint|@ts-/.test(line)) return false;
        if (isDart) return /^\s*(?:dynamic\s+\w+|final\s+dynamic\s+\w+|var\s+dynamic)/.test(line);
        if (isGo) return /interface\{\}/.test(line);
      },
      message: (line) => `Using unsafe type (any/dynamic): ${line.trim().substring(0, 60)}`,
    },
    {
      name: "unused_import",
      severity: "low",
      category: "UNUSED_IMPORT",
      test: (line) => {
        if (isGo) return /^\s*_\s+"[^"]+"/.test(line);
        return false;
      },
      message: () => "Blank import — consider removing or documenting why needed",
    },
  ];
}

export async function scanProject(baseDir) {
  const findings = [];
  const files = await collectFiles(baseDir);

  for (const file of files) {
    const filePath = path.join(baseDir, file);
    const fileStat = await stat(filePath);

    if (!skipBigFile && fileStat.size > MAX_FILE_SIZE) {
      findings.push({
        severity: "low",
        category: "BIG_FILE",
        file,
        line: 1,
        message: `File too large (${(fileStat.size / 1024).toFixed(0)} KB) — consider splitting`,
      });
      continue;
    }

    const ext = path.extname(file).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;

    await scanFileLines(filePath, file, findings, ext);
  }

  const maxFiles = Number(process.env.SCAN_MAX_FILES ?? 80);
  if (files.length > maxFiles) {
    findings.push({
      severity: "low",
      category: "BIG_PROJECT",
      file: ".",
      line: 1,
      message: `Project has ${files.length} files (limit: ${maxFiles}) — review may be truncated`,
    });
  }

  findings.sort(severityOrder);
  return { findings, fileCount: files.length };
}

async function collectFiles(baseDir) {
  const results = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const rel = path.relative(baseDir, fullPath);
        results.push(rel);
      }
    }
  }
  await walk(baseDir);
  return results;
}

async function scanFileLines(filePath, relPath, findings, ext) {
  const checks = buildLineChecks(ext);
  const imported = new Set();

  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber++;

    const trimmed = line.trim();

    let impPath = null;
    let m = trimmed.match(/^import\s+.*\bfrom\s+['"]([^'"]+)['"]/);
    if (m) impPath = m[1];
    if (!impPath) {
      m = trimmed.match(/^(?:import|library|export)\s+['"]([^'"]+)['"]/);
      if (m) impPath = m[1];
    }
    if (!impPath && trimmed.startsWith("import ")) {
      m = trimmed.match(/^import\s+(?:(?:package|dart):)?([^\s;]+)/);
      if (m) impPath = m[1];
    }
    if (impPath) {
      if (imported.has(impPath)) {
        findings.push({
          severity: "low",
          category: "DUPLICATE_IMPORT",
          file: relPath,
          line: lineNumber,
          message: `Duplicate import: '${impPath}'`,
        });
      }
      imported.add(impPath);
    }

    for (const check of checks) {
      if (check.test(trimmed)) {
        findings.push({
          severity: check.severity,
          category: check.category,
          file: relPath,
          line: lineNumber,
          message: check.message(trimmed),
        });
      }
    }
  }
}

function severityOrder(a, b) {
  const order = { high: 0, medium: 1, low: 2 };
  return (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
}

function formatReport({ findings, fileCount }, baseDir) {
  const now = new Date().toISOString();
  const lines = [
    `# AI Scan Report (local, no AI)`,
    ``,
    `> Generated: \`${now}\``,
    `> Files scanned: \`${fileCount}\``,
    `> Findings: \`${findings.length}\``,
    ``,
  ];

  if (findings.length === 0) {
    lines.push("No issues found.");
    return lines.join("\n");
  }

  lines.push("| Severity | Category | File | Line | Issue |");
  lines.push("| --- | --- | --- | --- | --- |");

  for (const f of findings) {
    lines.push(`| ${f.severity} | ${f.category} | \`${f.file}\` | ${f.line} | ${f.message} |`);
  }

  return lines.join("\n");
}

async function main() {
  const result = await scanProject(root);
  const report = formatReport(result, root);

  if (!quiet) console.log(report);

  const filename = `ai-scan-report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  await writeFile(path.join(root, filename), report, "utf8");

  if (!quiet) {
    console.log(`\nScan report written to ${filename}`);
    console.log(`Found ${result.findings.length} issue(s) across ${result.fileCount} file(s).`);
  }

  return result;
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === "ai-scanner.mjs";

if (isMain) {
  main().catch((err) => {
    console.error("Scan failed:", err.message);
    process.exit(1);
  });
}

