#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Loader } from "./_loader.mjs";

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pathArg = process.argv.find((arg) => arg.startsWith("--path="))?.slice("--path=".length);
const root = pathArg ? path.resolve(pathArg) : process.cwd();
const dryRun = process.argv.includes("--dry-run");
const applyFixes = process.argv.includes("--apply");
const reportArg = process.argv.find((arg) => arg.startsWith("--report="))?.slice("--report=".length);
const taskSelect = process.argv.find((arg) => arg.startsWith("--task="))?.slice("--task=".length)
  ?? process.argv.find((arg) => arg.startsWith("--select="))?.slice("--select=".length);
const langArg = process.argv.find((arg) => arg.startsWith("--lang="))?.slice("--lang=".length);
const lang = (langArg === "id" || langArg === "en") ? langArg : "en";
const shellEnvKeys = new Set(Object.keys(process.env));
const tasksFilename = "ai-tasks.json";

loadDotEnv(path.resolve(agentRoot, "..", "code-reviewer-agent", ".env"));
loadDotEnv(path.join(agentRoot, ".env"), { override: true });
loadDotEnv(path.join(root, ".env"), { override: true });

const reportFile = reportArg
  ? path.resolve(root, reportArg)
  : await findLatestReport(root);

const securityReportFile = await findLatestSecurityReport(root);

if ((!reportFile || !existsSync(reportFile)) && (!securityReportFile || !existsSync(securityReportFile))) {
  console.log("Report files not found:", reportArg ?? "ai-review-report-*.md or ai-security-report-*.md in " + root);
  process.exit(0);
}

let findings = [];

if (reportFile && existsSync(reportFile)) {
  console.log("Found review report:", path.relative(root, reportFile));
  findings.push(...parseFindings(await readFile(reportFile, "utf8"), "review"));
}

if (securityReportFile && existsSync(securityReportFile)) {
  console.log("Found security report:", path.relative(root, securityReportFile));
  findings.push(...parseFindings(await readFile(securityReportFile, "utf8"), "security"));
}

// Re-assign originalIndex after merging (1-based, sequential)
findings = findings.map((f, i) => ({ ...f, originalIndex: i + 1 }));

console.log(`Total findings: ${findings.length} (${findings.filter(f => f.severity === "critical").length} critical, ${findings.filter(f => f.severity === "high").length} high)`);
findings.forEach(f => console.log(`  [${f.originalIndex}] ${f.severity} | ${f.file} | ${f.issue?.substring(0, 60)}`));

if (findings.length === 0) {
  console.log("No findings found in any report.");
  process.exit(0);
}

const existingData = await loadJsonSafe(path.join(root, tasksFilename));
const completedSet = new Set(existingData?.completed ?? []);

const pendingFindings = findings
  .map((f, i) => ({ ...f, originalIndex: i + 1 }))
  .filter((f) => !completedSet.has(f.originalIndex));

if (completedSet.size > 0) {
  const skipped = findings.length - pendingFindings.length;
  console.log(`  ${findings.length} findings total, ${skipped} already completed, ${pendingFindings.length} pending.\n`);
}

if (pendingFindings.length === 0) {
  console.log("All findings have been completed. Nothing to do.");
  process.exit(0);
}

const apiKey = process.env.TASKER_API_KEY ?? process.env.CODE_REVIEW_API_KEY ?? process.env.OPENAI_API_KEY;
if (!apiKey && !dryRun) {
  fail("TASKER_API_KEY, CODE_REVIEW_API_KEY, or OPENAI_API_KEY is missing.");
}

const model = process.env.TASKER_MODEL ?? process.env.CODE_REVIEW_MODEL ?? "gpt-5";
const baseUrl = process.env.TASKER_BASE_URL ?? process.env.CODE_REVIEW_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

const skill = await readSkill();
const selectedIds = taskSelect ? taskSelect.split(",").map(Number).filter((n) => !isNaN(n)) : null;

let tasks;

if (applyFixes && existingData?.tasks) {
  tasks = existingData;
} else if (dryRun && !selectedIds) {
  tasks = generateLocalTasks(pendingFindings);
} else {
  const loader = new Loader("task");
  loader.start(`${pendingFindings.length} findings`);
  tasks = await callLLM({ apiKey, baseUrl, model, instructions: skill, findings: pendingFindings });
  loader.stop();
}

const taskFile = path.join(root, tasksFilename);
await writeFile(taskFile, JSON.stringify({ completed: [...completedSet], tasks: tasks.tasks }, null, 2), "utf8");

const filteredTasks = selectedIds
  ? tasks.tasks.filter((t) => selectedIds.includes(t.id))
  : tasks.tasks;

printTaskList(filteredTasks, pendingFindings);

console.log(`\nTask list written to ${tasksFilename}`);
console.log(`Total: ${tasks.tasks.length} task(s) across ${pendingFindings.length} finding(s).`);

if (applyFixes && filteredTasks.length > 0) {
  const completedNow = await runFixerForTasks(filteredTasks, pendingFindings);

  if (completedNow.size > 0) {
    for (const fi of completedNow) completedSet.add(fi);

    tasks.tasks = tasks.tasks.filter((t) => !t.findings.every((fi) => completedSet.has(fi)));
    await writeFile(taskFile, JSON.stringify({ completed: [...completedSet], tasks: tasks.tasks }, null, 2), "utf8");

    if (tasks.tasks.length === 0) {
      console.log(`\nAll tasks completed.`);
    } else {
      console.log(`\n${tasks.tasks.length} task(s) remaining. Updated ${tasksFilename}.`);
    }
  }
}

if (dryRun && !selectedIds) {
  process.exit(0);
}

function parseFindings(reportText, source = "review") {
  const lines = reportText.split(/\r?\n/);
  const findings = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("| ---")) { inTable = true; continue; }
    if (!inTable || !trimmed.startsWith("|") || trimmed.startsWith("| Severity")) continue;

    const cells = trimmed.split("|").map((c) => stripHtml(c.trim())).filter(Boolean);
    if (cells.length < 6) continue;

    const severity = cells[0].toLowerCase();
    const category = source === "security" ? `[SECURITY] ${cells[1]}` : cells[1];
    const file = cells[2].replace(/^`(.*)`$/, "$1").replace(/^`|`$/g, "").trim();
    const linesRaw = cells[3].replace(/^`|`$/g, "").trim();
    const issue = cells[4];
    const recommendation = cells.slice(5).join(" | ");

    if (!file || !severity) continue;

    findings.push({ severity, category, file, lines: linesRaw, issue, recommendation });
  }

  return findings;
}

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, "").trim();
}

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

function enforceSeverity(tasks, findings) {
  for (const task of tasks) {
    let maxRank = SEVERITY_RANK[task.priority] ?? 0;
    let maxSeverity = task.priority;

    // Match by finding index
    for (const fi of task.findings) {
      const fiNum = Number(fi);
      const finding = findings.find((f) => f.originalIndex === fiNum);
      if (finding) {
        const rank = SEVERITY_RANK[finding.severity] ?? 0;
        if (rank > maxRank) { maxRank = rank; maxSeverity = finding.severity; }
      }
    }

    // Fallback: match by file path
    if (maxSeverity === task.priority) {
      for (const taskFile of (task.files ?? [])) {
        const matching = findings.filter((f) =>
          toPosix(f.file).endsWith(toPosix(taskFile)) || toPosix(taskFile).endsWith(toPosix(f.file))
        );
        for (const f of matching) {
          const rank = SEVERITY_RANK[f.severity] ?? 0;
          if (rank > maxRank) { maxRank = rank; maxSeverity = f.severity; }
        }
      }
    }

    if (maxSeverity !== task.priority) {
      console.warn(`  ⚠ Task #${task.id}: priority corrected "${task.priority}" → "${maxSeverity}"`);
      task.priority = maxSeverity;
    }
  }
}

function toPosix(v) { return v ? v.replace(/\\/g, "/") : ""; }

function generateLocalTasks(findings) {
  const fileGroups = new Map();
  findings.forEach((f) => {
    if (!fileGroups.has(f.file)) fileGroups.set(f.file, []);
    fileGroups.get(f.file).push(f);
  });

  const tasks = [];
  let id = 0;

  for (const [file, fileFindings] of fileGroups) {
    const byCategory = new Map();
    for (const f of fileFindings) {
      if (!byCategory.has(f.category)) byCategory.set(f.category, []);
      byCategory.get(f.category).push(f);
    }

    for (const [category, catFindings] of byCategory) {
      id++;
      const severities = catFindings.map((f) => f.severity);
      const priority = severities.includes("high") ? "high"
        : severities.includes("medium") ? "medium"
        : "low";

      const type = /SEC(URIT|RET)/i.test(category) ? "security"
        : /BUG|EMPTY_CATCH|DEBUGGER/i.test(category) ? "bug"
        : /TODO|FIXME|HACK/i.test(category) ? "todo"
        : /CONSOLE|MAGIC_NUMBERS|HARDCODED_URL/i.test(category) ? "style"
        : "refactor";

      const complexity = /SEC(URIT|RET)/i.test(category) ? "easy"
        : /TODO|CONSOLE|MAGIC_NUMBERS|HARDCODED_URL|DUPLICATE_IMPORT/i.test(category) ? "easy"
        : /EMPTY_CATCH|UNSAFE_TYPE|LEGACY/i.test(category) ? "easy"
        : "medium";

      const desc = `${category}: ${catFindings.map((f) => f.issue).join("; ")}`;

      tasks.push({
        id,
        priority,
        type,
        complexity,
        files: [file],
        description: desc.substring(0, 200),
        why: `Found ${catFindings.length} issue(s) of type ${category} in ${file}`,
        findings: catFindings.map((f) => f.originalIndex),
      });
    }
  }

  return { tasks: tasks.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
  }) };
}

async function callLLM({ apiKey, baseUrl, model, instructions, findings }) {
  const findingsText = findings.map((f) =>
    `[${f.originalIndex}] Severity: ${f.severity} | Category: ${f.category} | File: ${f.file} | Lines: ${f.lines}\n    Issue: ${f.issue}\n    Fix: ${f.recommendation}`
  ).join("\n\n");

  const userMessage = lang === "id"
    ? `Berikut adalah daftar temuan dari code review:\n\n${findingsText}\n\n---\nPENTING: Priority task WAJIB sama dengan severity temuan. Jangan pernah downgrade. Critical temuan = critical task. High temuan = high task.\nBuat daftar task berdasarkan temuan di atas. Output JSON sesuai format yang diminta.`
    : `Here are the code review findings:\n\n${findingsText}\n\n---\nIMPORTANT: Task priority MUST match finding severity. Never downgrade. Critical finding = critical task. High finding = high task.\nGenerate a task plan from these findings. Output valid JSON matching the required format.`;

  const endpoint = buildChatCompletionsUrl(baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: userMessage }
      ],
      temperature: 0.2,
      seed: 42,
      stream: false
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    fail(`LLM API request failed: ${payload?.error?.message ?? response.statusText}`);
  }

  const text = payload?.choices?.[0]?.message?.content
    ?? payload?.output_text
    ?? payload?.output?.flatMap((i) => i.content ?? [])?.map((c) => c.text)?.filter(Boolean)?.join("\n");

  if (!text?.trim()) fail("LLM response did not contain readable output.");

  const parsed = parseJSON(text);
  if (!parsed?.tasks) {
    console.warn("Warning: LLM output did not contain valid task JSON. Using local fallback.");
    return generateLocalTasks(findings);
  }

  enforceSeverity(parsed.tasks, findings);

  return parsed;
}

function parseJSON(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function printTaskList(tasks, findings) {
  if (tasks.length === 0) {
    console.log("\nNo tasks selected.");
    return;
  }

  const prioColor = { high: 31, medium: 33, low: 90, critical: 35 };
  const typeIcon = { security: "🔒", bug: "🐛", refactor: "🔧", style: "🎨", todo: "📝" };

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  TASK PLAN  (${tasks.length} task(s))`);
  console.log(`${"─".repeat(60)}`);

  for (const task of tasks) {
    const color = prioColor[task.priority] ?? 37;
    const icon = typeIcon[task.type] ?? "•";
    const label = `${task.priority.toUpperCase()}`;

    console.log(`\n  \x1b[${color}m${icon} [${label}] Task #${task.id}\x1b[0m`);
    console.log(`  ${task.description.substring(0, 120)}`);
    console.log(`  \x1b[90mFiles: ${task.files.join(", ")}\x1b[0m`);
    console.log(`  \x1b[90mType: ${task.type}  |  Complexity: ${task.complexity}  |  Findings: ${task.findings.length}\x1b[0m`);

    if (task.findings.length <= 5) {
      for (const fi of task.findings) {
        const f = findings.find((pf) => pf.originalIndex === fi);
        if (f) console.log(`    \x1b[2m  • [${f.severity}] ${f.issue}\x1b[0m`);
      }
    }
  }

  console.log(`\n${"─".repeat(60)}\n`);
}

async function runFixerForTasks(tasks, contextFindings) {
  const allFiles = [...new Set(tasks.flatMap((t) => t.files))];
  const countDesc = tasks.length === 1 ? "1 task" : `${tasks.length} tasks`;
  const completedFindings = new Set();

  console.log(`Running fixer-agent for ${countDesc} (${allFiles.length} file(s))...\n`);

  for (const task of tasks) {
    let allSuccess = true;

    for (const file of task.files) {
      const absolutePath = path.resolve(root, file);
      if (!existsSync(absolutePath)) {
        console.warn(`  [!] File not found: ${file}`);
        allSuccess = false;
        continue;
      }

      const fileFindings = contextFindings.filter((f) => task.findings.includes(f.originalIndex) && f.file === file);
      if (fileFindings.length === 0) continue;

      const reportContent = buildMinimalReport(fileFindings);
      const tempReport = path.join(root, ".tasker-temp-report.md");
      await writeFile(tempReport, reportContent, "utf8");

      try {
        execSync(`fixer-agent --apply --report=".tasker-temp-report.md" --path="${root}"`, {
          stdio: "inherit",
          shell: true,
        });
        console.log(`  Generating tests for ${file}...`);
        try {
          execSync(`test-agent --apply --report=".tasker-temp-report.md" --path="${root}"`, {
            stdio: "inherit",
            shell: true,
          });
        } catch {
          console.warn(`  [!] Test generation skipped for ${file} (test-agent not installed or failed)`);
        }
      } catch {
        console.warn(`  [!] Fixer failed for ${file}`);
        allSuccess = false;
      }
    }

    if (allSuccess) {
      for (const fi of task.findings) completedFindings.add(fi);
    }
  }

  try { await writeFile(path.join(root, ".tasker-temp-report.md"), ""); } catch {}
  console.log(`\nDone. ${completedFindings.size} finding(s) in ${tasks.length} task(s) processed.`);
  return completedFindings;
}

function buildMinimalReport(fileFindings) {
  const lines = [
    "# AI Code Review Report (task slice)",
    "",
    "| Severity | Category | File | Lines | Issue | Fix |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const f of fileFindings) {
    lines.push(`| ${f.severity} | ${f.category} | \`${f.file}\` | \`${f.lines}\` | ${f.issue} | ${f.recommendation} |`);
  }

  return lines.join("\n");
}

async function findLatestReport(baseDir) {
  let entries;
  try { entries = await readdir(baseDir); } catch { return null; }
  const reports = entries
    .filter((f) => /^ai-review-report-\d{4}-\d{2}-\d{2}T.*\.md$/.test(f))
    .sort().reverse();
  return reports.length > 0 ? path.join(baseDir, reports[0]) : null;
}

async function findLatestSecurityReport(baseDir) {
  let entries;
  try { entries = await readdir(baseDir); } catch { return null; }
  const reports = entries
    .filter((f) => /^ai-security-report-\d{4}-\d{2}-\d{2}T.*\.md$/.test(f))
    .sort().reverse();
  return reports.length > 0 ? path.join(baseDir, reports[0]) : null;
}

async function readSkill() {
  const projectPath = path.join(root, "skills", "SKILL.md");
  const bundledPath = path.join(agentRoot, "skills", "SKILL.md");
  return existsSync(projectPath) ? await readFile(projectPath, "utf8") : await readFile(bundledPath, "utf8");
}

function loadDotEnv(filePath, options = {}) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  const override = options.override === true;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    const key = trimmed.slice(0, sep).trim();
    let value = trimmed.slice(sep + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if ((override && !shellEnvKeys.has(key)) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function buildChatCompletionsUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

async function loadJsonSafe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
