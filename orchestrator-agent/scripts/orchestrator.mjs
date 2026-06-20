#!/usr/bin/env node
import { execSync } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import process from "node:process";

const pathArg = process.argv.find((arg) => arg.startsWith("--path="))?.slice("--path=".length);
const root = pathArg ? path.resolve(pathArg) : process.cwd();
const skipArg = process.argv.find((arg) => arg.startsWith("--skip="))?.slice("--skip=".length);
const interactive = process.argv.includes("--interactive");
const dryRun = process.argv.includes("--dry-run");
const taskSelect = process.argv.find((arg) => arg.startsWith("--task="))?.slice("--task=".length);
const skipSet = new Set(skipArg ? skipArg.split(",").map((s) => s.trim().toLowerCase()) : []);

const steps = [
  { name: "scan",   cli: "ai-scanner" },
  { name: "review", cli: `code-reviewer-agent` },
  { name: "task",   cli: `tasker-agent` },
  { name: "fix",    cli: `tasker-agent ${taskSelect ? `--task=${taskSelect}` : ""} --apply` },
  { name: "test",   cli: `test-agent --apply` },
  { name: "commit", cli: `commit-agent --staged --commit` },
];

printPlan(steps, skipSet, root);

if (dryRun) process.exit(0);

const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;

for (const step of steps) {
  if (skipSet.has(step.name)) {
    console.log(`  ⏭ Skipped`);
    continue;
  }

  if (rl) {
    const answer = await ask(rl, `\n  ? Run "${step.cli}"? (Y/n) `);
    if (answer === "n" || answer === "no") {
      console.log(`  ⏭ Skipped`);
      continue;
    }
  }

  console.log(`\n\x1b[36m── ${step.name} ──────────────────────────────────\x1b[0m\n`);

  try {
    execSync(step.cli, { cwd: root, stdio: "inherit", shell: true });
  } catch {
    console.error(`\n  ✗ "${step.name}" failed. Stopping pipeline.`);
    process.exit(1);
  }
}

if (rl) rl.close();

console.log(`\n\x1b[32m✓ Pipeline complete.\x1b[0m`);

function printPlan(steps, skipSet, root) {
  const active = steps.filter((s) => !skipSet.has(s.name));
  console.log(`\n\x1b[1mOrchestrator Pipeline\x1b[0m`);
  console.log(`  Path: ${root}`);
  console.log(`  Steps: ${active.map((s) => s.name).join(" → ")}\n`);
  if (skipSet.size > 0) console.log(`  Skipped: ${[...skipSet].join(", ")}\n`);
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim().toLowerCase())));
}
