#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Loader } from "./_loader.mjs";

const pathArg = process.argv.find((arg) => arg.startsWith("--path="))?.slice("--path=".length);
const root = pathArg ? path.resolve(pathArg) : process.cwd();

const langArg = process.argv.find((arg) => arg.startsWith("--lang="))?.slice("--lang=".length);
const lang = (langArg === "id" || langArg === "en") ? langArg : "en";
const projectLangArg = process.argv.find((arg) => arg.startsWith("--project-lang="))?.slice("--project-lang=".length);
const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const printFiles = process.argv.includes("--print-files");
const useStream = process.argv.includes("--stream") || process.env.SECURITY_REVIEW_STREAM === "1";
const debugStream = process.argv.includes("--debug-stream");
const shellEnvKeys = new Set(Object.keys(process.env));

loadDotEnv(path.join(agentRoot, ".env"));
loadDotEnv(path.join(root, ".env"), { override: true });

let config = await loadJson(path.join(root, ".ai-security.json"), null);
if (!config) {
  // use --project-lang arg or auto-detect
  const detectedLang = projectLangArg ?? await detectProjectLanguage(root);
  const skillConfig = detectedLang
    ? await loadJson(path.join(agentRoot, "skills", `${detectedLang}-security-reviewer.json`), null)
    : null;

  config = skillConfig ?? {
    include: [
      // JS/TS
      "src/**/*.js", "src/**/*.jsx", "src/**/*.ts", "src/**/*.tsx",
      "server/**/*.js", "server/**/*.ts", "api/**/*.js", "api/**/*.ts",
      // Python
      "**/*.py",
      // Go
      "**/*.go",
      // Java/Kotlin
      "**/*.java", "**/*.kt",
      // Dart
      "**/*.dart",
      // Config files
      "package.json", "tsconfig.json", ".env.example",
      "pubspec.yaml", "go.mod", "requirements.txt",
      "pom.xml", "build.gradle", "build.gradle.kts",
    ],
    exclude: [
      "node_modules/**", "dist/**", "build/**", "coverage/**", ".git/**",
      ".dart_tool/**", "vendor/**", "venv/**", ".venv/**",
      "__pycache__/**", "target/**",
      "**/*.test.*", "**/*.spec.*", "**/__tests__/**",
      "**/*_test.go", "**/*_test.py", "**/test_*.py",
      "**/*Test.java", "**/*.g.dart", "**/*.freezed.dart",
    ]
  };

  if (detectedLang) {
    console.error(`[config] Detected language: ${detectedLang}. Using ${detectedLang}-security-reviewer config.`);
  } else {
    console.error(`[config] No .ai-security.json found. Using default multi-language config.`);
  }
}

const maxFiles = Number(process.env.SECURITY_REVIEW_MAX_FILES ?? process.env.CODE_REVIEW_MAX_FILES ?? 80);
const maxBytes = Number(process.env.SECURITY_REVIEW_MAX_BYTES ?? process.env.CODE_REVIEW_MAX_BYTES ?? 180000);
const failOn = new Set(
  (process.env.SECURITY_REVIEW_FAIL_ON ?? "critical,high")
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
  for (const file of snapshot.files) {
    console.log(`- ${file.relativePath} (${file.bytes} bytes)`);
  }
  console.log(`Total bytes: ${snapshot.totalBytes}`);
  if (dryRun) process.exit(0);
}

const apiKey = process.env.SECURITY_REVIEW_API_KEY ?? process.env.CODE_REVIEW_API_KEY ?? process.env.OPENAI_API_KEY;
if (!apiKey) {
  fail("SECURITY_REVIEW_API_KEY, CODE_REVIEW_API_KEY, or OPENAI_API_KEY is missing.");
}

if (snapshot.files.length === 0) {
  console.log("No matching files found for security review (check .ai-security.json include patterns).");
  process.exit(0);
}

const skill = await readSkill();
const model = process.env.SECURITY_REVIEW_MODEL ?? process.env.CODE_REVIEW_MODEL ?? "gpt-5";
const baseUrl = process.env.SECURITY_REVIEW_BASE_URL ?? process.env.CODE_REVIEW_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const input = createInput(snapshot);

const projectTree = buildProjectTree(snapshot.files.map((f) => f.relativePath));
const configFiles = await readConfigFiles(root, snapshot.files.map((f) => f.relativePath));
const configContext = `## Project Structure\n\`\`\`\n${projectTree}\n\`\`\`\n${configFiles}\n---\n`;

const finalInput = configContext + input;

const loader = new Loader("security");
loader.start(`${snapshot.files.length} files`);

const review = await callOpenAICompatible({ apiKey, baseUrl, model, instructions: skill, input: finalInput, loader });
loader.stop();

const report = formatReport(review, { model, fileCount: snapshot.files.length });
const reportFilename = `ai-security-report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
await writeFile(path.join(root, reportFilename), report, "utf8");

const status = parseSecurityStatus(report);
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

// ─── Helpers ────────────────────────────────────────────────────────────────

async function detectProjectLanguage(dir) {
  const markers = [
    { file: "pubspec.yaml",        lang: "dart"   },
    { file: "go.mod",              lang: "go"     },
    { file: "requirements.txt",    lang: "python" },
    { file: "pyproject.toml",      lang: "python" },
    { file: "pom.xml",             lang: "java"   },
    { file: "build.gradle",        lang: "java"   },
    { file: "build.gradle.kts",    lang: "java"   },
    { file: "package.json",        lang: "javascript" },
    { file: "tsconfig.json",       lang: "javascript" },
  ];
  for (const { file, lang } of markers) {
    if (existsSync(path.join(dir, file))) return lang;
  }
  return null;
}

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
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readSkill() {
  const projectSkillPath = path.join(root, "skills", "SKILL.md");
  const bundledSkillPath = path.join(agentRoot, "skills", "SKILL.md");
  const skillContent = existsSync(projectSkillPath)
    ? await readFile(projectSkillPath, "utf8")
    : await readFile(bundledSkillPath, "utf8");
  const langInstruction = lang === "id"
    ? "**CRITICAL INSTRUCTION: You MUST write the ENTIRE security review output in Bahasa Indonesia. No English whatsoever.**\n\n---\n\n"
    : "";
  return langInstruction + skillContent;
}

async function collectFiles(baseDir, reviewConfig) {
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
      if ([".git", "node_modules", "dist", "build", "coverage"].includes(entry.name)) continue;
      if (matchesAny(relativePath, excludePatterns)) continue;
      results.push(...await walk(absolutePath, excludePatterns));
      continue;
    }
    if (entry.isFile()) results.push(absolutePath);
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

function createInput(snapshot) {
  const langReminder = lang === "id"
    ? "PENTING: Seluruh hasil security review harus ditulis dalam Bahasa Indonesia.\n\n"
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
    "Audit this repository snapshot for security vulnerabilities before merge.",
    "Line numbers are provided in the format `line_number | code` and are the source of truth.",
    "When reporting a finding, use the exact line or line range from the numbered snapshot. Do not estimate line numbers.",
    "Return only the required security report format.",
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

function buildProjectTree(allFiles) {
  const tree = {};
  for (const f of allFiles) {
    const parts = f.split("/");
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1) {
        node[parts[i]] = null;
      } else {
        if (!node[parts[i]]) node[parts[i]] = {};
        node = node[parts[i]];
      }
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
  const configFileNames = new Set([
    "package.json", "tsconfig.json", ".env.example", "Dockerfile", "docker-compose.yml",
    "pubspec.yaml", "go.mod", "go.sum",
    "requirements.txt", "pyproject.toml", "setup.py",
    "pom.xml", "build.gradle", "build.gradle.kts",
  ]);
  const parts = [];
  for (const f of allFiles) {
    const name = f.split("/").pop();
    if (!configFileNames.has(name)) continue;
    try {
      const content = await readFile(path.join(baseDir, f), "utf8");
      parts.push(`### ${f}\n\`\`\`\n${content.trim()}\n\`\`\``);
    } catch { /* skip */ }
  }
  return parts.length > 0 ? `## Key Config Files\n${parts.join("\n\n")}\n\n` : "";
}

async function callOpenAICompatible({ apiKey, baseUrl, model, instructions, input, loader }) {
  const endpoint = buildChatUrl(baseUrl);
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
          max_tokens: 16384,
          temperature: 0.40,
          top_p: 0.95,
          presence_penalty: 0,
          stream: useStream
        })
      });

      if (!response.ok) {
        let errMsg = `${response.status} ${response.statusText}`;
        try { const p = await response.json(); errMsg = p?.error?.message ?? errMsg; } catch {}
        if (attempt < maxRetries && (response.status === 429 || response.status >= 500)) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`API request failed (${response.status}), retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
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
        ?.map((c) => c.text)
        ?.filter(Boolean)
        ?.join("\n")
        ?.trim();
      if (textFromOutput) return textFromOutput;

      fail("LLM API response did not contain readable output text.");
    } catch (error) {
      lastError = error;
      const cause = error?.cause?.message || error?.message || error?.code || String(error);
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`API request failed (${cause}), retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }

  const cause = lastError?.cause?.message || lastError?.message || lastError?.code || "unknown error";
  console.error(`\n✗ Endpoint: ${endpoint}`);
  console.error(`✗ Model: ${model}`);
  fail(`LLM API request failed after ${maxRetries + 1} attempts: ${cause}`);
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
    if (debugStream) rawLog += `--- CHUNK ${++chunkCount} ---\n${text}\n`;
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
        const content = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.text ?? "";
        if (content) {
          if (!hasFirstToken) { hasFirstToken = true; if (loader) loader.stop(); }
          process.stdout.write(content);
          fullText += content;
        }
      } catch { /* skip malformed SSE */ }
    }
  }

  if (!hasFirstToken && loader) loader.stop();

  if (debugStream && rawLog) {
    await writeFile(path.join(root, "ai-security-stream-debug.log"), rawLog, "utf8");
  }

  process.stdout.write("\n");
  return fullText.trim();
}

function buildChatUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function parseSecurityStatus(review) {
  for (const line of review.split(/\r?\n/)) {
    if (!line.toLowerCase().includes("security_status")) continue;
    const normalized = normalizeMarkdown(line);
    const match = normalized.match(/\bsecurity_status\b\s*:\s*(pass|fail)\b/i) ?? normalized.match(/\b(pass|fail)\b/i);
    if (match) return match[1].toLowerCase();
  }
  return "unknown";
}

function findBlockingSeverities(review, configuredFailOn) {
  const severities = [];
  for (const line of review.split(/\r?\n/)) {
    const normalized = normalizeMarkdown(line);
    const matches = [
      normalized.match(/\bseverity\s*:\s*(critical|high|medium|low)\b/i),
      normalized.match(/^\|\s*(critical|high|medium|low)\s*\|/i)
    ].filter(Boolean);
    for (const match of matches) {
      const severity = match[1].toLowerCase();
      if (configuredFailOn.has(severity)) severities.push(severity);
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

function matchesAny(relativePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(relativePath));
}

function globToRegExp(pattern) {
  const posixPattern = toPosix(pattern);
  let source = "";
  for (let i = 0; i < posixPattern.length; i++) {
    const char = posixPattern[i];
    const next = posixPattern[i + 1];
    const afterNext = posixPattern[i + 2];
    if (char === "*" && next === "*" && afterNext === "/") { source += "(?:.*/)?"; i += 2; continue; }
    if (char === "*" && next === "*") { source += ".*"; i += 1; continue; }
    if (char === "*") { source += "[^/]*"; continue; }
    if (char === "?") { source += "."; continue; }
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
