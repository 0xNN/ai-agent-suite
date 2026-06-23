#!/usr/bin/env node
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import process from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentBase = path.resolve(__dirname, "..", "..");

const agentScripts = {
  scan:   path.join(agentBase, "scan-agent", "scripts", "ai-scanner.mjs"),
  review: path.join(agentBase, "code-reviewer-agent", "scripts", "ai-code-reviewer.mjs"),
  task:   path.join(agentBase, "tasker-agent", "scripts", "ai-task-generator.mjs"),
  fix:    path.join(agentBase, "fixer-agent", "scripts", "ai-fixer.mjs"),
  test:   path.join(agentBase, "test-agent", "scripts", "ai-test-agent.mjs"),
};

function runScript(scriptPath, args) {
  const cmd = `node "${scriptPath}" ${args}`;
  execSync(cmd, { cwd: root, stdio: ciMode ? "pipe" : "inherit" });
}

const pathArg = process.argv.find((arg) => arg.startsWith("--path="))?.slice("--path=".length);
const root = pathArg ? path.resolve(pathArg) : process.cwd();
const skipArg = process.argv.find((arg) => arg.startsWith("--skip="))?.slice("--skip=".length);
const interactive = process.argv.includes("--interactive");
const dryRun = process.argv.includes("--dry-run");
const taskSelect = process.argv.find((arg) => arg.startsWith("--task="))?.slice("--task=".length);
const ciMode = process.argv.includes("--ci");
const skipSet = new Set(skipArg ? skipArg.split(",").map((s) => s.trim().toLowerCase()) : []);

const steps = [
  { name: "scan",   run: () => runScript(agentScripts.scan, "") },
  { name: "review", run: () => runScript(agentScripts.review, "") },
  { name: "task",   run: () => runScript(agentScripts.task, "") },
  { name: "fix",    run: () => runScript(agentScripts.fix, `${taskSelect ? `--task=${taskSelect}` : ""} --apply`) },
  { name: "test",   run: () => runScript(agentScripts.test, "--apply") },
];

function say(msg) {
  if (!ciMode) console.log(msg);
}

function sayErr(msg) {
  console.error(msg);
}

printPlan(steps, skipSet, root);

if (dryRun) process.exit(0);

const rl = interactive && !ciMode ? createInterface({ input: process.stdin, output: process.stdout }) : null;
let hasFailures = false;

for (const step of steps) {
  if (skipSet.has(step.name)) {
    say(`  ⏭ Skipped`);
    continue;
  }

  if (rl) {
    const answer = await ask(rl, `\n  ? Run "${step.name}"? (Y/n) `);
    if (answer === "n" || answer === "no") {
      say(`  ⏭ Skipped`);
      continue;
    }
  }

  say(`\n── ${step.name} ──────────────────────────────────\n`);

  try {
    step.run();
    say(`  ✓ ${step.name} passed`);
  } catch {
    sayErr(`  ✗ "${step.name}" failed. Stopping pipeline.`);
    hasFailures = true;
    break;
  }
}

if (rl) rl.close();

// ─── CI Summary ───
if (ciMode) {
  const reportFiles = findReports(root, "ai-review-report");
  const scanFiles = findReports(root, "ai-scan-report");
  const results = { passed: !hasFailures, scan: 0, review: 0 };

  for (const rf of [...reportFiles, ...scanFiles]) {
    try {
      const content = readFileSync(rf, "utf8");
      const findingLines = content.split("\n").filter((l) => l.trim().startsWith("|") && !l.includes("---") && !l.includes("Severity"));
      const count = findingLines.length;
      if (rf.includes("review")) results.review += count;
      else results.scan += count;
    } catch {}
  }

  const summaryPath = path.join(root, "ai-ci-summary.json");
  writeFileSync(summaryPath, JSON.stringify(results, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(results));

  if (results.scan > 0 || results.review > 0) {
    sayErr(`\n✗ ${results.review} review finding(s), ${results.scan} scan finding(s) found.`);
  }

  process.exit(results.scan > 0 || results.review > 0 ? 1 : 0);
}

if (hasFailures) process.exit(1);

say(`\n✓ Pipeline complete.`);

function findReports(baseDir, prefix) {
  try {
      const entries = readdirSync(baseDir);
    return entries
      .filter((f) => new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}T.*\\.md$`).test(f))
      .sort()
      .reverse()
      .map((f) => path.join(baseDir, f));
  } catch { return []; }
}

function printPlan(steps, skipSet, root) {
  const active = steps.filter((s) => !skipSet.has(s.name));
  say(`\nOrchestrator Pipeline`);
  say(`  Path: ${root}`);
  say(`  Steps: ${active.map((s) => s.name).join(" → ")}\n`);
  if (skipSet.size > 0) say(`  Skipped: ${[...skipSet].join(", ")}\n`);
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim().toLowerCase())));
}
