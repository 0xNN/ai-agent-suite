#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Loader } from "./_loader.mjs";

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pathArg = process.argv.find((arg) => arg.startsWith("--path="))?.slice("--path=".length);
const root = pathArg ? path.resolve(pathArg) : process.cwd();
const onlyStaged = process.argv.includes("--staged");
const onlyUnstaged = process.argv.includes("--unstaged");
const sinceArg = process.argv.find((arg) => arg.startsWith("--since="))?.slice("--since=".length);
const contextLines = Number(process.argv.find((arg) => arg.startsWith("--context="))?.slice("--context=".length) ?? 3);
const dryRun = process.argv.includes("--dry-run");
const useStream = process.argv.includes("--stream") || process.env.DIFF_REVIEW_STREAM === "1";
const debugStream = process.argv.includes("--debug-stream");
const langArg = process.argv.find((arg) => arg.startsWith("--lang="))?.slice("--lang=".length);
const lang = (langArg === "id" || langArg === "en") ? langArg : "en";
const shellEnvKeys = new Set(Object.keys(process.env));

loadDotEnv(path.resolve(agentRoot, "..", "code-reviewer-agent", ".env"));
loadDotEnv(path.join(agentRoot, ".env"), { override: true });
loadDotEnv(path.join(root, ".env"), { override: true });

const diff = getDiff(root, { onlyStaged, onlyUnstaged, since: sinceArg, context: contextLines });

if (!diff || diff.trim().length === 0) {
  console.log("No changes to review.");
  process.exit(0);
}

console.log(`Diff size: ${diff.split("\n").length} lines, ${Buffer.byteLength(diff, "utf8")} bytes\n`);

if (dryRun) {
  console.log(diff);
  process.exit(0);
}

const apiKey = process.env.DIFF_REVIEW_API_KEY ?? process.env.CODE_REVIEW_API_KEY ?? process.env.OPENAI_API_KEY;
if (!apiKey) {
  fail("DIFF_REVIEW_API_KEY, CODE_REVIEW_API_KEY, or OPENAI_API_KEY is missing.");
}

const model = process.env.DIFF_REVIEW_MODEL ?? process.env.CODE_REVIEW_MODEL ?? "gpt-5";
const baseUrl = process.env.DIFF_REVIEW_BASE_URL ?? process.env.CODE_REVIEW_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

const skill = await readSkill();

const input = lang === "id"
  ? `Berikut adalah diff git yang perlu di-review:\n\n\`\`\`diff\n${diff}\n\`\`\`\n\nPENTING: Seluruh hasil review harus ditulis dalam Bahasa Indonesia.`
  : `Review the following git diff:\n\n\`\`\`diff\n${diff}\n\`\`\``;

const loader = new Loader("diff");
loader.start();

let review;
if (useStream) {
  review = await callOpenAICompatibleStream({ apiKey, baseUrl, model, instructions: skill, input, debugStream });
} else {
  review = await callOpenAICompatible({ apiKey, baseUrl, model, instructions: skill, input });
}
loader.stop();

const report = formatReport(review, { model });
const filename = `ai-diff-review-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
await writeFile(path.join(root, filename), report, "utf8");

console.log(report);
console.log(`\nDiff review written to ${filename}`);

function getDiff(baseDir, opts = {}) {
  try {
    execSync("git rev-parse --git-dir", { cwd: baseDir, stdio: "pipe" });
  } catch {
    fail("Not a git repository.");
  }

  let range;
  if (opts.since) {
    range = `${opts.since}...HEAD`;
  } else if (opts.onlyUnstaged) {
    range = null;
  } else {
    range = "--staged";
  }

  const cmd = range
    ? `git diff ${range}`
    : `git diff`;

  const result = execSync(cmd, { cwd: baseDir, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return result.trim();
}

async function callOpenAICompatible({ apiKey, baseUrl, model, instructions, input }) {
  const endpoint = buildChatCompletionsUrl(baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
  if (!response.ok) fail(`LLM request failed: ${payload?.error?.message ?? response.statusText}`);

  const text = payload?.choices?.[0]?.message?.content
    ?? payload?.output_text
    ?? payload?.output?.flatMap((i) => i.content ?? [])?.map((c) => c.text)?.filter(Boolean)?.join("\n");

  if (text?.trim()) return text.trim();
  fail("LLM response did not contain readable output.");
}

async function callOpenAICompatibleStream({ apiKey, baseUrl, model, instructions, input, debugStream }) {
  const endpoint = buildChatCompletionsUrl(baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: instructions }, { role: "user", content: input }], temperature: 0.2, seed: 42, stream: true })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    fail(`LLM stream request failed: ${response.status} ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;

      const jsonStr = trimmed.slice(6);
      if (debugStream) console.log("SSE:", jsonStr);

      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed?.choices?.[0]?.delta?.content
          ?? parsed?.choices?.[0]?.text
          ?? parsed?.choices?.[0]?.message?.content
          ?? "";
        if (content) {
          process.stdout.write(content);
          chunks.push(content);
        }
      } catch {}
    }
  }

  console.log();
  return chunks.join("");
}

function formatReport(review, metadata) {
  const trimmed = review.trim();
  const title = trimmed.startsWith("# ") ? "" : "# AI Diff Review\n\n";
  return [
    title,
    `> Generated: \`${new Date().toISOString()}\`  `,
    `> Model: \`${metadata.model}\``,
    "",
    trimmed,
    ""
  ].join("\n");
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
