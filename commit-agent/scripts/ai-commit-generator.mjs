#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Loader } from "./_loader.mjs";

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const autoCommit = process.argv.includes("--commit");
const onlyStaged = process.argv.includes("--staged");
const langArg = process.argv.find((arg) => arg.startsWith("--lang="))?.slice("--lang=".length);
const lang = (langArg === "id" || langArg === "en") ? langArg : "en";
const shellEnvKeys = new Set(Object.keys(process.env));

loadDotEnv(path.resolve(agentRoot, "..", "code-reviewer-agent", ".env"));
loadDotEnv(path.join(agentRoot, ".env"), { override: true });

const diff = getDiff(onlyStaged);

if (!diff) {
  console.log("No changes detected. Nothing to commit.");
  process.exit(0);
}

if (dryRun) {
  console.log("=== Git Diff ===\n");
  console.log(diff);
  process.exit(0);
}

const apiKey = process.env.COMMIT_API_KEY ?? process.env.CODE_REVIEW_API_KEY ?? process.env.OPENAI_API_KEY;
if (!apiKey) {
  fail("COMMIT_API_KEY, CODE_REVIEW_API_KEY, or OPENAI_API_KEY is missing.");
}

const model = process.env.COMMIT_MODEL ?? process.env.CODE_REVIEW_MODEL ?? "gpt-5";
const baseUrl = process.env.COMMIT_BASE_URL ?? process.env.CODE_REVIEW_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

const skill = await readSkill();
const input = buildInput(diff, lang);

const loader = new Loader("commit");
loader.start();
const message = await callLLM({ apiKey, baseUrl, model, instructions: skill, input });
loader.stop();

console.log("\n" + message + "\n");

if (autoCommit) {
  try {
    execSync("git add -A", { stdio: "ignore" });
    execSync(`git commit -m "${message.split("\n")[0].replace(/"/g, '\\"')}"`, { stdio: "inherit" });
    console.log("Committed successfully.");
  } catch (error) {
    fail(`Commit failed: ${error.message}`);
  }
}

function getDiff(onlyStaged) {
  try {
    const staged = execSync("git diff --cached", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (onlyStaged) return staged;
    const unstaged = execSync("git diff", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    const parts = [staged, unstaged].filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : "";
  } catch {
    fail("Not a git repository or git is not installed.");
  }
}

function buildInput(diffText, language) {
  const langNote = language === "id"
    ? "PENTING: Hasil commit message harus ditulis dalam Bahasa Indonesia.\n\n"
    : "";
  return `${langNote}Generate conventional commit message(s) for this diff:\n\n${diffText}`;
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
    const message = payload?.error?.message ?? `${response.status} ${response.statusText}`;
    fail(`LLM API request failed: ${message}`);
  }

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

async function readSkill() {
  const projectSkillPath = path.join(process.cwd(), "skills", "SKILL.md");
  const bundledSkillPath = path.join(agentRoot, "skills", "SKILL.md");

  return existsSync(projectSkillPath)
    ? await readFile(projectSkillPath, "utf8")
    : await readFile(bundledSkillPath, "utf8");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
