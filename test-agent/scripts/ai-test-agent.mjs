#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { Loader } = await import("./_loader.mjs");

const pathArg = process.argv.find((arg) => arg.startsWith("--path="))?.slice("--path=".length);
const root = pathArg ? path.resolve(pathArg) : process.cwd();
const dryRun = process.argv.includes("--dry-run");
const applyTests = process.argv.includes("--apply");
const reportArg = process.argv.find((arg) => arg.startsWith("--report="))?.slice("--report=".length);
const customPrompt = process.argv.find((arg) => arg.startsWith("--prompt="))?.slice("--prompt=".length);
const outDirArg = process.argv.find((arg) => arg.startsWith("--out-dir="))?.slice("--out-dir=".length);
const shellEnvKeys = new Set(Object.keys(process.env));

loadDotEnv(path.resolve(agentRoot, "..", "code-reviewer-agent", ".env"));
loadDotEnv(path.join(agentRoot, ".env"), { override: true });
loadDotEnv(path.join(root, ".env"), { override: true });

const reportFile = reportArg
  ? path.resolve(root, reportArg)
  : await findLatestReport(root);

if (!reportFile || !existsSync(reportFile)) {
  console.log("Report file not found:", reportArg ?? "ai-review-report-*.md in " + root);
  process.exit(0);
}

console.log("Found report:", path.relative(root, reportFile));

const report = await readFile(reportFile, "utf8");
const findings = parseFindings(report);

if (findings.length === 0) {
  console.log("No findings found in the report.");
  process.exit(0);
}

const grouped = groupBy(findings, (f) => f.file);
console.log(`Found ${findings.length} findings across ${grouped.size} file(s).\n`);

const apiKey = process.env.TEST_API_KEY ?? process.env.CODE_REVIEW_API_KEY ?? process.env.OPENAI_API_KEY;
if (!apiKey && !dryRun) {
  fail("TEST_API_KEY, CODE_REVIEW_API_KEY, or OPENAI_API_KEY is missing.");
}

const model = process.env.TEST_MODEL ?? process.env.CODE_REVIEW_MODEL ?? "gpt-5";
const baseUrl = process.env.TEST_BASE_URL ?? process.env.CODE_REVIEW_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

const skill = await readSkill();
const results = [];

for (const [file, fileFindings] of grouped) {
  const absolutePath = path.resolve(root, file);
  if (!existsSync(absolutePath)) {
    console.warn(`  [!] File not found: ${file}`);
    continue;
  }

  const original = await readFile(absolutePath, "utf8");
  const testFile = resolveTestPath(root, file, outDirArg);
  const existingTest = existsSync(testFile) ? await readFile(testFile, "utf8") : null;
  const input = buildTestPrompt(file, fileFindings, original, existingTest, customPrompt);

  if (dryRun) {
    console.log(`=== ${file} ===`);
    console.log(`  Test output → ${path.relative(root, testFile)}`);
    for (const f of fileFindings) {
      console.log(`  - [${f.severity}] ${f.issue}`);
    }
    console.log();
    continue;
  }

  const loader = new Loader("test");
  loader.start(file);

  const generated = await callLLM({ apiKey, baseUrl, model, instructions: skill, input });
  loader.stop();
  const cleaned = cleanCodeBlock(generated);

  results.push({ file, testFile, content: cleaned, findings: fileFindings });

  if (applyTests) {
    const dir = path.dirname(testFile);
    await mkdir(dir, { recursive: true });
    await writeFile(testFile, cleaned, "utf8");
    console.log(`    ✓ Written → ${path.relative(root, testFile)}`);
  } else {
    console.log(`\n  ${path.relative(root, testFile)}:`);
    console.log(cleaned.split("\n").slice(0, 20).map((l) => `    ${l}`).join("\n"));
    if (cleaned.split("\n").length > 20) {
      console.log(`    ... (${cleaned.split("\n").length - 20} more lines)`);
    }
  }
}

if (results.length > 0 && !applyTests && !dryRun) {
  console.log("\n── Summary ──");
  console.log(`${results.length} test file(s) ready to write.`);
  console.log("Run with --apply to write: test-agent --apply");
}

if (results.length > 0 && applyTests) {
  console.log(`\n✓ ${results.length} test file(s) written.`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findLatestReport(baseDir) {
  let entries;
  try {
    entries = await readdir(baseDir);
  } catch {
    return null;
  }

  const reports = entries
    .filter((f) => /^ai-review-report-\d{4}-\d{2}-\d{2}T.*\.md$/.test(f))
    .sort()
    .reverse();

  return reports.length > 0 ? path.join(baseDir, reports[0]) : null;
}

function parseFindings(reportText) {
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
    const category = cells[1];
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

/**
 * Resolves where the test file should be written.
 * Strategy:
 *   1. If --out-dir is given, mirror the source structure inside that dir.
 *   2. Otherwise, place the test file next to the source file with .test.ts / .spec.ts suffix.
 */
function resolveTestPath(root, sourceFile, outDir) {
  const ext = path.extname(sourceFile);
  const base = path.basename(sourceFile, ext);
  const dir = path.dirname(sourceFile);

  let testFileName;
  if (ext === ".dart") {
    testFileName = `${base}_test.dart`;
  } else if (ext === ".go") {
    testFileName = `${base}_test.go`;
  } else if (ext === ".ts" || ext === ".tsx") {
    testFileName = `${base}.test.ts`;
  } else {
    testFileName = `${base}.test.js`;
  }

  if (outDir) {
    return path.resolve(root, outDir, dir, testFileName);
  }

  return path.resolve(root, dir, testFileName);
}

function buildTestPrompt(file, fileFindings, content, existingTest, customPrompt) {
  const details = fileFindings.map((f, i) =>
    `Issue #${i + 1}: ${f.issue}\nLines: ${f.lines}\nSeverity: ${f.severity}\nRecommendation: ${f.recommendation}`
  ).join("\n\n");

  const existingSection = existingTest
    ? `\n\n## Existing Test File\n\nThe following test file already exists. Preserve existing tests and add new ones:\n\n${existingTest}`
    : "";

  const extra = customPrompt ? `\n\n## User Instructions\n\n${customPrompt}` : "";

  return `FILE: ${file}\n\n## Issues Found\n\n${details}\n\n---\n\n## Source Code\n\n${addLineNumbers(content)}${existingSection}${extra}`;
}

function addLineNumbers(content) {
  return content.split(/\r?\n/).map((line, i) => `${String(i + 1).padStart(5)} | ${line}`).join("\n");
}

function cleanCodeBlock(text) {
  return text.replace(/^```[\w]*\s*\n/gm, "").replace(/\n```\s*$/g, "").trim();
}

async function callLLM({ apiKey, baseUrl, model, instructions, input }) {
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
        { role: "user", content: input }
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

  if (text?.trim()) return text.trim();
  fail("LLM response did not contain readable output.");
}

function buildChatCompletionsUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
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

async function readSkill() {
  const projectPath = path.join(root, "skills", "SKILL.md");
  const bundledPath = path.join(agentRoot, "skills", "SKILL.md");
  return existsSync(projectPath) ? await readFile(projectPath, "utf8") : await readFile(bundledPath, "utf8");
}

function groupBy(items, fn) {
  const map = new Map();
  for (const item of items) {
    const key = fn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
