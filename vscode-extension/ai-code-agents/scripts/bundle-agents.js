#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const AGENTS_DIR = path.join(ROOT, "agents");
const REPO_ROOT = path.resolve(ROOT, "..", "..", "..");

const AGENT_LIST = [
  "scan-agent", "code-reviewer-agent", "commit-agent", "diff-reviewer-agent",
  "fixer-agent", "learn-agent", "orchestrator-agent", "tasker-agent", "test-agent",
];

if (fs.existsSync(AGENTS_DIR)) {
  fs.rmSync(AGENTS_DIR, { recursive: true, force: true });
}
fs.mkdirSync(AGENTS_DIR, { recursive: true });

const sourceBase = path.join(REPO_ROOT);
if (!fs.existsSync(path.join(sourceBase, "scan-agent"))) {
  console.error("Cannot find ai-agent-suite repo root. Expected at:", sourceBase);
  process.exit(1);
}

for (const agent of AGENT_LIST) {
  const src = path.join(sourceBase, agent);
  const dest = path.join(AGENTS_DIR, agent);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true, filter: (f) => {
      const rel = path.relative(src, f);
      return !rel.startsWith("node_modules") && !rel.startsWith(".") && rel !== "package-lock.json";
    }});
    console.log(`✓ ${agent}`);
  } else {
    console.warn(`⚠ ${agent} not found at ${src}`);
  }
}

console.log("All agents bundled.");
