#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Loader } from "./_loader.mjs";
let scanProject = null;
try {
  scanProject = (await import("../../scan-agent/scripts/ai-scanner.mjs")).scanProject;
} catch {
  // scan-agent not available as module
}

// const root = process.cwd();
const pathArg = process.argv.find((arg) => arg.startsWith("--path="))?.slice("--path=".length);
const root = pathArg ? path.resolve(pathArg) : process.cwd();

const langArg = process.argv.find((arg) => arg.startsWith("--lang="))?.slice("--lang=".length);
const lang = (langArg === 'id' || langArg === 'en') ? langArg : 'en';
const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const printFiles = process.argv.includes("--print-files");
const useStream = process.argv.includes("--stream") || process.env.CODE_REVIEW_STREAM === "1";
const debugStream = process.argv.includes("--debug-stream");
const shellEnvKeys = new Set(Object.keys(process.env));

loadDotEnv(path.join(agentRoot, ".env"));
loadDotEnv(path.join(root, ".env"), { override: true });

let config = await loadJson(path.join(root, ".ai-reviewer.json"), null);
if (!config) {
  config = await loadJson(path.join(agentRoot, ".ai-reviewer.json"), {
    include: ["src/**/*.js", "src/**/*.jsx", "src/**/*.ts", "src/**/*.tsx", "package.json", "tsconfig.json"],
    exclude: ["node_modules/**", "dist/**", "build/**", "coverage/**", ".git/**"]
  });
  console.error(`[config] No .ai-reviewer.json found in project root (${root}). Using agent default.` +
    `\n  To review Dart/Go files, copy skills/<lang>-ai-reviewer.json to your project root as .ai-reviewer.json`);
}

const maxFiles = Number(process.env.CODE_REVIEW_MAX_FILES ?? 80);
const maxBytes = Number(process.env.CODE_REVIEW_MAX_BYTES ?? 180000);
const failOn = new Set(
  (process.env.CODE_REVIEW_FAIL_ON ?? "critical,high,medium")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

if (process.env.AI_REVIEW_SKIP === "1") {
  console.log("AI review skipped because AI_REVIEW_SKIP=1.");
  process.exit(0);
}

const files = await collectReviewFiles(root, config);
const snapshot = await buildSnapshot(files, maxFiles, maxBytes);

if (dryRun || printFiles) {
  console.log(`Files selected for review: ${snapshot.files.length}`);
  for (const file of snapshot.files) {
    console.log(`- ${file.relativePath} (${file.bytes} bytes)`);
  }
  console.log(`Total bytes: ${snapshot.totalBytes}`);
  if (dryRun) process.exit(0);
}

const apiKey = process.env.CODE_REVIEW_API_KEY ?? process.env.OPENAI_API_KEY;
if (!apiKey) {
  fail("CODE_REVIEW_API_KEY or OPENAI_API_KEY is missing. Add it to .env or the shell environment.");
}

if (snapshot.files.length === 0) {
  console.log("No matching files found for AI review (check .ai-reviewer.json include patterns).");
  process.exit(0);
}

const skill = await readSkill();
const model = process.env.CODE_REVIEW_MODEL ?? "gpt-5";
const baseUrl = process.env.CODE_REVIEW_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const input = createReviewInput(snapshot);

let scanContext = "";
if (process.env.AI_REVIEW_SKIP_SCAN !== "1" && scanProject) try {
  const scanResult = await scanProject(root);
  const findings = scanResult.findings;
  if (findings.length > 0) {
    const highMed = findings.filter((f) => f.severity === "high" || f.severity === "medium");
    const lines = findings.slice(0, 40).map((f) =>
      `| ${f.severity} | ${f.category} | \`${f.file}\` | ${f.line} | ${f.message} |`
    );
    scanContext = `\n\n## Local Scan Results\n\nFindings: ${findings.length} (${highMed.length} medium/high).\nTrivial issues (console.log, TODO, any, etc.) already listed here — DO NOT report them again.\nFocus on deeper logic/security/architecture issues not in this list.\n\n| Severity | Category | File | Line | Issue |\n| --- | --- | --- | --- | --- |\n${lines.join("\n")}`;
  }
} catch {
  // scan-agent not available, continue without local context
}

const finalInput = input + scanContext;

const loader = new Loader("review");
loader.start(`${snapshot.files.length} files`);

const review = await callOpenAICompatible({ apiKey, baseUrl, model, instructions: skill, input: finalInput, loader });
loader.stop();
const report = formatMarkdownReport(review, { model, fileCount: snapshot.files.length });
const reportFilename = `ai-review-report-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
await writeFile(path.join(root, reportFilename), report, "utf8");

const status = parseReviewStatus(report);
const blockingSeverities = findBlockingSeverities(report, failOn);

console.log(report);
console.log(`Review report written to ${reportFilename}`);

if (status === "fail" && blockingSeverities.length > 0) {
  fail(`AI review failed. Blocking severities: ${[...new Set(blockingSeverities)].join(", ")}.`);
}

if (status === "unknown") {
  console.warn("REVIEW_STATUS not found in output. Defaulting to pass.");
  process.exit(0);
}

console.log("AI review passed.");

function loadDotEnv(filePath, options = {}) {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8");
  const override = options.override === true;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
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
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

// async function readSkill() {
//   const projectSkillPath = path.join(root, "skills", "SKILL.md");
//   const bundledSkillPath = path.join(agentRoot, "skills", "SKILL.md");

//   if (existsSync(projectSkillPath)) {
//     return readFile(projectSkillPath, "utf8");
//   }

//   return readFile(bundledSkillPath, "utf8");
// }

async function readSkill() {
  const projectSkillPath = path.join(root, "skills", "SKILL.md");
  const bundledSkillPath = path.join(agentRoot, "skills", "SKILL.md");

  const skillContent = existsSync(projectSkillPath)
    ? await readFile(projectSkillPath, "utf8")
    : await readFile(bundledSkillPath, "utf8");
  
  const langInstruction = lang === "id"
    ? "**CRITICAL INSTRUCTION: You MUST write the ENTIRE review output in Bahasa Indonesia. No English whatsoever.**\n\n---\n\n"
    : "";
  
  return langInstruction + skillContent;
}

async function collectReviewFiles(baseDir, reviewConfig) {
  const allFiles = await walk(baseDir, reviewConfig.exclude ?? []);
  return allFiles
    .map((absolutePath) => toPosix(path.relative(baseDir, absolutePath)))
    .filter((relativePath) => matchesAny(relativePath, reviewConfig.include ?? []))
    .filter((relativePath) => !matchesAny(relativePath, reviewConfig.exclude ?? []))
    .sort();
}

async function walk(directory, excludePatterns = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = toPosix(path.relative(root, absolutePath));

    if (entry.isDirectory()) {
      if ([".git", "node_modules", "dist", "build", "coverage", ".dart_tool", ".pub-cache"].includes(entry.name)) continue;
      if (matchesAny(relativePath, excludePatterns)) continue;
      results.push(...await walk(absolutePath, excludePatterns));
      continue;
    }

    if (entry.isFile()) {
      results.push(absolutePath);
    }
  }

  return results;
}

async function buildSnapshot(relativeFiles, fileLimit, byteLimit) {
  const selected = [];
  let totalBytes = 0;

  for (const relativePath of relativeFiles) {
    if (selected.length >= fileLimit) break;

    const absolutePath = path.join(root, relativePath);
    const fileStat = await stat(absolutePath);
    if (totalBytes + fileStat.size > byteLimit) continue;

    const content = await readFile(absolutePath, "utf8");
    selected.push({ relativePath, bytes: fileStat.size, content });
    totalBytes += fileStat.size;
  }

  return { files: selected, totalBytes };
}

function createReviewInput(snapshot) {
  const langReminder = lang === "id"
    ? "PENTING: Seluruh hasil review harus ditulis dalam Bahasa Indonesia.\n\n"
    : "";

  const files = snapshot.files
    .map((file) => [
      `### FILE: ${file.relativePath}`,
      "Each code line below is prefixed with its real 1-based source line number. Use only these line numbers when reporting findings.",
      "```text",
      addLineNumbers(file.content),
      "```"
    ].join("\n"))
    .join("\n\n");

  return [
    langReminder,
    "Review this repository snapshot before build.",
    "Line numbers are provided in the format `line_number | code` and are the source of truth.",
    "When reporting a finding, use the exact line or line range from the numbered snapshot. Do not estimate line numbers.",
    "Return only the required review format.",
    "",
    files
  ].join("\n");
}

function addLineNumbers(content) {
  return content
    .split(/\r?\n/)
    .map((line, index) => `${String(index + 1).padStart(5, " ")} | ${line}`)
    .join("\n");
}

async function callOpenAICompatible({ apiKey, baseUrl, model, instructions, input, loader }) {
  const endpoint = buildChatCompletionsUrl(baseUrl);
  const maxRetries = 2;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
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
          // temperature: 1,
          // top_p: 0.95,
          // max_tokens: 16384,
          max_tokens: 16384,
          temperature: 0.60,
          top_p: 0.95,
          top_k: 20,
          presence_penalty: 0,
          repetition_penalty: 1,
          stream: useStream
        })
      });

      if (!response.ok) {
        let errMsg = `${response.status} ${response.statusText}`;
        try { const p = await response.json(); errMsg = p?.error?.message ?? errMsg; } catch {}
        if (attempt < maxRetries && (response.status === 429 || response.status >= 500)) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`LLM API request failed (${response.status}), retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        fail(`LLM API request failed: ${errMsg}`);
      }

      if (useStream) return await readStream(response, loader);

      const payload = await response.json().catch(() => null);
      const chatText = payload?.choices?.[0]?.message?.content;
      if (typeof chatText === "string" && chatText.trim()) return chatText.trim();

      const outputText = payload?.output_text;
      if (typeof outputText === "string" && outputText.trim()) return outputText.trim();

      const textFromOutput = payload?.output
        ?.flatMap((item) => item.content ?? [])
        ?.map((content) => content.text)
        ?.filter(Boolean)
        ?.join("\n")
        ?.trim();
      if (textFromOutput) return textFromOutput;

      fail("LLM API response did not contain readable output text.");
    } catch (error) {
      if (!useStream) { lastError = error; }
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`LLM API request failed, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (useStream) { lastError = error; }
    }
  }

  fail(`LLM API request failed after ${maxRetries + 1} attempts: ${lastError?.message ?? "unknown error"}`);
}

async function readStream(response, loader) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let rawLog = "";
  let chunkCount = 0;
  let hasFirstToken = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    if (debugStream) {
      rawLog += `--- CHUNK ${++chunkCount} ---\n${text}\n`;
    }
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "[DONE]") continue;

      let jsonStr = trimmed;
      if (trimmed.startsWith("data: ")) {
        jsonStr = trimmed.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
      }

      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed?.choices?.[0]?.delta?.content
          ?? parsed?.choices?.[0]?.text
          ?? parsed?.choices?.[0]?.message?.content
          ?? "";
        if (content) {
          if (!hasFirstToken) {
            hasFirstToken = true;
            if (loader) loader.stop();
          }
          process.stdout.write(content);
          fullText += content;
        }
      } catch {
        // skip malformed SSE
      }
    }
  }

  if (!hasFirstToken && loader) loader.stop();

  try {
    const remaining = buffer.trim();
    if (remaining && remaining !== "[DONE]") {
      let jsonStr = remaining;
      if (remaining.startsWith("data: ")) jsonStr = remaining.slice(6).trim();
      if (jsonStr !== "[DONE]") {
        const parsed = JSON.parse(jsonStr);
        const content = parsed?.choices?.[0]?.delta?.content
          ?? parsed?.choices?.[0]?.text
          ?? parsed?.choices?.[0]?.message?.content
          ?? "";
        if (content) {
          process.stdout.write(content);
          fullText += content;
        }
      }
    }
  } catch {}

  if (debugStream && rawLog) {
    const logFile = path.join(root, "ai-stream-debug.log");
    await writeFile(logFile, rawLog, "utf8");
    console.error(`\n[debug] Raw stream saved to ${logFile}`);
  }

  process.stdout.write("\n");
  return fullText.trim();
}

function buildChatCompletionsUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "");

  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }

  return `${trimmed}/v1/chat/completions`;
}

function parseReviewStatus(review) {
  for (const line of review.split(/\r?\n/)) {
    if (!line.toLowerCase().includes("review_status")) continue;

    const normalized = normalizeMarkdownSignal(line);
    const match = normalized.match(/\breview_status\b\s*:\s*(pass|fail)\b/i) ?? normalized.match(/\b(pass|fail)\b/i);
    if (match) return match[1].toLowerCase();
  }

  return "unknown";
}

function findBlockingSeverities(review, configuredFailOn) {
  const severities = [];

  for (const line of review.split(/\r?\n/)) {
    const normalized = normalizeMarkdownSignal(line);
    const matches = [
      normalized.match(/\bseverity\s*:\s*(critical|high|medium|low)\b/i),
      normalized.match(/^\|\s*(critical|high|medium|low)\s*\|/i)
    ].filter(Boolean);

    for (const match of matches) {
      const severity = match[1].toLowerCase();
      if (configuredFailOn.has(severity)) {
        severities.push(severity);
      }
    }
  }

  return severities;
}

function normalizeMarkdownSignal(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatMarkdownReport(review, metadata) {
  const trimmed = review.trim();
  const title = trimmed.startsWith("# ") ? "" : "# AI Code Review Report\n\n";
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

function matchesAny(relativePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(relativePath));
}

function globToRegExp(pattern) {
  const posixPattern = toPosix(pattern);
  let source = "";

  for (let index = 0; index < posixPattern.length; index += 1) {
    const char = posixPattern[index];
    const next = posixPattern[index + 1];
    const afterNext = posixPattern[index + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 2;
      continue;
    }

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += ".";
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`^${source}$`);
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
