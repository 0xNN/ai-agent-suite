#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Loader } from "./_loader.mjs";

const pathArg = process.argv.find((a) => a.startsWith("--path="))?.slice("--path=".length);
const root = pathArg ? path.resolve(pathArg) : process.cwd();

const langArg = process.argv.find((a) => a.startsWith("--lang="))?.slice("--lang=".length);
const lang = langArg === "id" ? "id" : "en";

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const printFiles = process.argv.includes("--print-files");
const useStream = process.argv.includes("--stream") || process.env.CODE_REVIEW_STREAM === "1";
const shellEnvKeys = new Set(Object.keys(process.env));

loadDotEnv(path.join(agentRoot, ".env"));
loadDotEnv(path.join(root, ".env"), { override: true });

let config = await loadJson(path.join(root, ".ai-security.json"), null);
if (!config) {
  config = {
    include: [
      "src/**/*.ts", "src/**/*.tsx", "src/**/*.js", "src/**/*.jsx",
      "src/**/*.mjs", "src/**/*.cjs",
      "package.json", ".env.example",
      "**/*.config.ts", "**/*.config.js",
      "**/constants.ts", "**/settings.ts", "**/config.ts",
    ],
    exclude: [
      "node_modules/**", "dist/**", "build/**", "coverage/**",
      ".git/**", "out/**", "**/*.test.*", "**/*.spec.*", "**/__tests__/**"
    ]
  };
}

const maxFiles = Number(process.env.SECURITY_MAX_FILES ?? 80);
const maxBytes = Number(process.env.SECURITY_MAX_BYTES ?? 180000);
const failOn = new Set(
  (process.env.SECURITY_FAIL_ON ?? "critical,high")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
);

if (process.env.AI_SECURITY_SKIP === "1") {
  console.log("AI security review skipped because AI_SECURITY_SKIP=1.");
  process.exit(0);
}

const files = await collectFiles(root, config);
const snapshot = await buildSnapshot(files, maxFiles, maxBytes);

if (dryRun || printFiles) {
  console.log(`Files selected for security review: ${snapshot.files.length}`);
  for (const f of snapshot.files) {
    console.log(`  - ${f.relativePath} (${f.bytes} bytes)`);
  }
  console.log(`Total bytes: ${snapshot.totalBytes}`);
  if (dryRun) process.exit(0);
}

const apiKey = process.env.CODE_REVIEW_API_KEY ?? process.env.OPENAI_API_KEY;
if (!apiKey) {
  fail("CODE_REVIEW_API_KEY or OPENAI_API_KEY is missing. Add it to .env or the shell environment.");
}

if (snapshot.files.length === 0) {
  console.log("No matching files found for security review (check .ai-security.json include patterns).");
  process.exit(0);
}

const skill = await readSkill();
const model = process.env.CODE_REVIEW_MODEL ?? "gpt-4o";
const baseUrl = process.env.CODE_REVIEW_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const input = buildInput(snapshot);

const projectTree = buildProjectTree(snapshot.files.map((f) => f.relativePath));
const configFiles = await readConfigFiles(root, snapshot.files.map((f) => f.relativePath));
const context = `## Project Structure\n\`\`\`\n${projectTree}\n\`\`\`\n${configFiles}\n---\n`;
const finalInput = context + input;

const loader = new Loader("security");
loader.start(`${snapshot.files.length} files`);

const review = await callOpenAICompatible({ apiKey, baseUrl, model, instructions: skill, input: finalInput, loader });
loader.stop();

const report = formatReport(review, { model, fileCount: snapshot.files.length });
const reportFilename = `ai-security-report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
await writeFile(path.join(root, reportFilename), report, "utf8");

const status = parseStatus(report);
const blockingSeverities = findBlockingSeverities(report, failOn);

console.log(report);
console.log(`Security report written to ${reportFilename}`);

if (status === "fail" && blockingSeverities.length > 0) {
  fail(`AI security review failed. Blocking severities: ${[...new Set(blockingSeverities)].join(", ")}.`);
}

if (status === "unknown") {
  console.warn("SECURITY_STATUS not found in output. Defaulting to pass.");
  process.exit(0);
}

console.log("AI security review passed.");

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}

async function readSkill() {
  const projectSkillPath = path.join(root, "skills", "SKILL.md");
  const bundledSkillPath = path.join(agentRoot, "skills", "SKILL.md");

  const content = existsSync(projectSkillPath)
    ? await readFile(projectSkillPath, "utf8")
    : await readFile(bundledSkillPath, "utf8");

  const langInstruction = lang === "id"
    ? "**CRITICAL INSTRUCTION: You MUST write the ENTIRE security review output in Bahasa Indonesia. No English whatsoever.**\n\n---\n\n"
    : "";

  return langInstruction + content;
}

async function collectFiles(baseDir, cfg) {
  const all = await walk(baseDir, cfg.exclude ?? []);
  return all
    .map((abs) => toPosix(path.relative(baseDir, abs)))
    .filter((rel) => matchesAny(rel, cfg.include ?? []))
    .filter((rel) => !matchesAny(rel, cfg.exclude ?? []))
    .sort();
}

async function walk(dir, excludePatterns = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = toPosix(path.relative(root, abs));

    if (entry.isDirectory()) {
      if ([".git", "node_modules", "dist", "build", "coverage", "out"].includes(entry.name)) continue;
      if (matchesAny(rel, excludePatterns)) continue;
      results.push(...await walk(abs, excludePatterns));
      continue;
    }

    if (entry.isFile()) results.push(abs);
  }

  return results;
}

async function buildSnapshot(relFiles, fileLimit, byteLimit) {
  const selected = [];
  let totalBytes = 0;

  for (const rel of relFiles) {
    if (selected.length >= fileLimit) break;
    const abs = path.join(root, rel);
    const s = await stat(abs);
    if (totalBytes + s.size > byteLimit) continue;
    const content = await readFile(abs, "utf8");
    selected.push({ relativePath: rel, bytes: s.size, content });
    totalBytes += s.size;
  }

  return { files: selected, totalBytes };
}

function buildInput(snapshot) {
  const langReminder = lang === "id"
    ? "PENTING: Seluruh hasil security review harus ditulis dalam Bahasa Indonesia.\n\n"
    : "";

  const files = snapshot.files
    .map((f) => [
      `### FILE: ${f.relativePath}`,
      "Each code line below is prefixed with its real 1-based source line number. Use only these line numbers when reporting findings.",
      "```text",
      addLineNumbers(f.content),
      "```"
    ].join("\n"))
    .join("\n\n");

  return [
    langReminder,
    "Audit this repository snapshot for security vulnerabilities.",
    "Line numbers are provided in the format `line_number | code` and are the source of truth.",
    "When reporting a finding, use the exact line or line range from the numbered snapshot.",
    "Return only the required security review format.",
    "",
    files
  ].join("\n");
}

function addLineNumbers(content) {
  return content
    .split(/\r?\n/)
    .map((line, i) => `${String(i + 1).padStart(5, " ")} | ${line}`)
    .join("\n");
}

function buildProjectTree(allFiles) {
  const tree = {};
  for (const f of allFiles) {
    const parts = f.split("/");
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1) { node[parts[i]] = null; }
      else { if (!node[parts[i]]) node[parts[i]] = {}; node = node[parts[i]]; }
    }
  }
  const lines = [];
  function print(node, prefix) {
    const keys = Object.keys(node).sort();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const isLast = i === keys.length - 1;
      lines.push(prefix + (isLast ? "└── " : "├── ") + key + (node[key] ? "/" : ""));
      if (node[key]) print(node[key], prefix + (isLast ? "    " : "│   "));
    }
  }
  print(tree, "");
  return lines.join("\n");
}

async function readConfigFiles(baseDir, allFiles) {
  const targets = new Set(["package.json", ".env.example", "tsconfig.json", "Dockerfile"]);
  const parts = [];
  for (const f of allFiles) {
    const name = f.split("/").pop();
    if (!targets.has(name)) continue;
    try {
      const content = await readFile(path.join(baseDir, f), "utf8");
      parts.push(`### ${f}\n\`\`\`\n${content.trim()}\n\`\`\``);
    } catch { /* skip */ }
  }
  return parts.length > 0 ? `## Key Config Files\n${parts.join("\n\n")}\n\n` : "";
}

async function callOpenAICompatible({ apiKey, baseUrl, model, instructions, input, loader }) {
  const endpoint = buildUrl(baseUrl);
  const maxRetries = 2;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      };
      if (useStream) headers["Accept"] = "text/event-stream";

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: instructions },
            { role: "user", content: input }
          ],
          max_tokens: 16384,
          temperature: 0.4,
          top_p: 0.95,
          stream: useStream
        })
      });

      if (!response.ok) {
        let errMsg = `${response.status} ${response.statusText}`;
        try { const p = await response.json(); errMsg = p?.error?.message ?? errMsg; } catch {}
        if (attempt < maxRetries && (response.status === 429 || response.status >= 500)) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`LLM API request failed (${response.status}), retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        fail(`LLM API request failed: ${errMsg}`);
      }

      if (useStream) return await readStream(response, loader);

      const payload = await response.json().catch(() => null);
      const text = payload?.choices?.[0]?.message?.content
        ?? payload?.output_text
        ?? payload?.output?.flatMap((i) => i.content ?? []).map((c) => c.text).filter(Boolean).join("\n");

      if (typeof text === "string" && text.trim()) return text.trim();
      fail("LLM API response did not contain readable output text.");
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`LLM API request failed, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }

  const cause = lastError?.cause?.message || lastError?.message || "unknown error";
  console.error(`\n✗ Endpoint: ${endpoint}`);
  console.error(`✗ Model: ${model}`);
  fail(`LLM API request failed after ${maxRetries + 1} attempts: ${cause}`);
}

async function readStream(response, loader) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let hasFirstToken = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "[DONE]") continue;
      let jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6).trim() : trimmed;
      if (jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? "";
        if (content) {
          if (!hasFirstToken) { hasFirstToken = true; if (loader) loader.stop(); }
          process.stdout.write(content);
          fullText += content;
        }
      } catch { /* skip malformed SSE */ }
    }
  }

  if (!hasFirstToken && loader) loader.stop();
  process.stdout.write("\n");
  return fullText.trim();
}

function buildUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function parseStatus(report) {
  for (const line of report.split(/\r?\n/)) {
    if (!line.toLowerCase().includes("security_status")) continue;
    const normalized = normalizeMarkdown(line);
    const match = normalized.match(/\bsecurity_status\b\s*:\s*(pass|fail)\b/i) ?? normalized.match(/\b(pass|fail)\b/i);
    if (match) return match[1].toLowerCase();
  }
  return "unknown";
}

function findBlockingSeverities(report, configuredFailOn) {
  const severities = [];
  for (const line of report.split(/\r?\n/)) {
    const normalized = normalizeMarkdown(line);
    const matches = [
      normalized.match(/\bseverity\s*:\s*(critical|high|medium|low)\b/i),
      normalized.match(/^\|\s*(critical|high|medium|low)\s*\|/i)
    ].filter(Boolean);
    for (const match of matches) {
      const sev = match[1].toLowerCase();
      if (configuredFailOn.has(sev)) severities.push(sev);
    }
  }
  return severities;
}

function normalizeMarkdown(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function formatReport(review, metadata) {
  const trimmed = review.trim();
  const title = trimmed.startsWith("# ") ? "" : "# AI Security Review Report\n\n";
  const generatedAt = new Date().toISOString();
  return [
    title,
    `> Generated: \`${generatedAt}\`  `,
    `> Model: \`${metadata.model}\`  `,
    `> Files reviewed: \`${metadata.fileCount}\``,
    "",
    trimmed,
    ""
  ].join("\n");
}

function matchesAny(rel, patterns) {
  return patterns.some((p) => globToRegExp(p).test(rel));
}

function globToRegExp(pattern) {
  const posix = toPosix(pattern);
  let source = "";
  for (let i = 0; i < posix.length; i++) {
    const c = posix[i], n = posix[i + 1], a = posix[i + 2];
    if (c === "*" && n === "*" && a === "/") { source += "(?:.*/)?"; i += 2; continue; }
    if (c === "*" && n === "*") { source += ".*"; i += 1; continue; }
    if (c === "*") { source += "[^/]*"; continue; }
    if (c === "?") { source += "."; continue; }
    source += c.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function toPosix(v) { return v.split(path.sep).join("/"); }

function fail(message) { console.error(message); process.exit(1); }
