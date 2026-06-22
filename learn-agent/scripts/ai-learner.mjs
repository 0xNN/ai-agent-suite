#!/usr/bin/env node
import { existsSync, readFileSync, appendFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile, writeFile, readdir, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const learnDir = path.join(root, ".ai-learning");
const eventsFile = path.join(learnDir, "events.ndjson");
const confidenceFile = path.join(learnDir, "confidence.json");
const suppressionsFile = path.join(learnDir, "suppressions.json");

const mode = process.argv.includes("--analyze") ? "analyze"
  : process.argv.includes("--suggest") ? "suggest"
  : process.argv.includes("--forget") ? "forget"
  : "status";

const langId = process.argv.includes("--lang=id");

function say(en, id) {
  console.log(langId ? id : en);
}

function loadEvents() {
  if (!existsSync(eventsFile)) return [];
  return readFileSync(eventsFile, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

async function appendEvent(event) {
  await mkdir(learnDir, { recursive: true });
  const line = JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + "\n";
  await appendFile(eventsFile, line, "utf8");
}

function loadConfidence() {
  if (!existsSync(confidenceFile)) return {};
  try { return JSON.parse(readFileSync(confidenceFile, "utf8")); } catch { return {}; }
}

function saveConfidence(data) {
  mkdirSync(learnDir, { recursive: true });
  writeFileSync(confidenceFile, JSON.stringify(data, null, 2), "utf8");
}

function loadSuppressions() {
  if (!existsSync(suppressionsFile)) return [];
  try { return JSON.parse(readFileSync(suppressionsFile, "utf8")); } catch { return []; }
}

function saveSuppressions(data) {
  mkdirSync(learnDir, { recursive: true });
  writeFileSync(suppressionsFile, JSON.stringify(data, null, 2), "utf8");
}

// ─── Status ───
function cmdStatus() {
  const events = loadEvents();
  say("\n📊 Learning Status", "\n📊 Status Pembelajaran");

  if (events.length === 0) {
    say("  No learning data yet. Start using the agents to build history.", "  Belum ada data pembelajaran. Mulai gunakan agent untuk membangun riwayat.");
    return;
  }

  const byType = {};
  const byCategory = {};
  const byFile = {};
  const byDate = {};
  const now = new Date();

  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (e.category) byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    if (e.file) {
      const rel = path.relative(root, e.file) || e.file;
      byFile[rel] = (byFile[rel] || 0) + 1;
    }
    if (e.timestamp) {
      const day = e.timestamp.slice(0, 10);
      byDate[day] = (byDate[day] || 0) + 1;
    }
  }

  say(`  Total events: ${events.length}`, `  Total kejadian: ${events.length}`);
  say("", "");
  say("  By type:", "  Berdasarkan tipe:");
  for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    say(`    ${t}: ${c}`, `    ${t}: ${c}`);
  }

  const topCat = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topCat.length > 0) {
    say("  Top categories:", "  Kategori teratas:");
    for (const [c, n] of topCat) say(`    ${c}: ${n}`, `    ${c}: ${n}`);
  }

  const recentDays = Object.keys(byDate).sort().reverse().slice(0, 7);
  if (recentDays.length > 0) {
    say("  Recent activity:", "  Aktivitas terbaru:");
    for (const d of recentDays) say(`    ${d}: ${byDate[d]} events`, `    ${d}: ${byDate[d]} kejadian`);
  }

  const confidence = loadConfidence();
  const confKeys = Object.keys(confidence);
  if (confKeys.length > 0) {
    say("\n  Confidence scores:", "\n  Skor kepercayaan:");
    for (const cat of confKeys.sort()) {
      const c = confidence[cat];
      say(`    ${cat}: ${Math.round(c.score * 100)}% (${c.seen} seen)`, `    ${cat}: ${Math.round(c.score * 100)}% (${c.seen} kali)`);
    }
  }
}

// ─── Analyze ───
function cmdAnalyze() {
  say("\n🔍 Analyzing learning data...", "\n🔍 Menganalisis data pembelajaran...");
  const events = loadEvents();

  if (events.length < 3) {
    say("  Not enough data (need ≥3 events).", "  Data belum cukup (butuh ≥3 kejadian).");
    return;
  }

  const categoryStats = {};
  const filePatterns = {};

  for (const e of events) {
    const cat = e.category || "unknown";
    if (!categoryStats[cat]) categoryStats[cat] = { seen: 0, kept: 0, reverted: 0, ignored: 0 };
    categoryStats[cat].seen++;
    if (e.type === "fix_applied") categoryStats[cat].kept++;
    else if (e.type === "fix_reverted") categoryStats[cat].reverted++;
    else if (e.type === "finding_ignored") categoryStats[cat].ignored++;

    if (e.file) {
      const ext = path.extname(e.file).toLowerCase();
      if (ext) {
        if (!filePatterns[ext]) filePatterns[ext] = { seen: 0, kept: 0, ignored: 0 };
        filePatterns[ext].seen++;
        if (e.type === "fix_applied") filePatterns[ext].kept++;
        else if (e.type === "finding_ignored") filePatterns[ext].ignored++;
      }
    }
  }

  const confidence = {};
  for (const [cat, stats] of Object.entries(categoryStats)) {
    const total = stats.kept + stats.reverted + stats.ignored;
    const score = total > 0 ? stats.kept / total : 0.5;
    confidence[cat] = { score: Math.round(score * 100) / 100, seen: stats.seen, kept: stats.kept, reverted: stats.reverted, ignored: stats.ignored };
  }

  saveConfidence(confidence);

  say("\n  Confidence scores updated:", "\n  Skor kepercayaan diperbarui:");
  for (const [cat, c] of Object.entries(confidence).sort((a, b) => a[1].score - b[1].score)) {
    const bar = "█".repeat(Math.round(c.score * 10)) + "░".repeat(10 - Math.round(c.score * 10));
    const pct = Math.round(c.score * 100);
    say(`    ${cat.padEnd(20)} ${bar} ${pct}% (${c.seen}x)`, `    ${cat.padEnd(20)} ${bar} ${pct}% (${c.seen}x)`);
  }

  say("\n  File extension patterns:", "\n  Pola ekstensi file:");
  for (const [ext, s] of Object.entries(filePatterns).sort((a, b) => b[1].seen - a[1].seen)) {
    const keepRate = s.seen > 0 ? Math.round((s.kept / s.seen) * 100) : 0;
    say(`    ${ext.padEnd(8)} ${s.seen}x seen, ${keepRate}% fix applied`, `    ${ext.padEnd(8)} ${s.seen}x dilihat, ${keepRate}% perbaikan diterapkan`);
  }
}

// ─── Suggest ───
function cmdSuggest() {
  say("\n💡 Generating suppression suggestions...", "\n💡 Membuat saran pengabaian...");
  const events = loadEvents();
  const confidence = loadConfidence();

  const lowConf = Object.entries(confidence)
    .filter(([, c]) => c.score < 0.3 && c.seen >= 3)
    .sort((a, b) => a[1].score - b[1].score);

  if (lowConf.length === 0) {
    say("  No strong suppression patterns found yet.", "  Belum ada pola pengabaian yang kuat.");
    return;
  }

  say("  Low-confidence findings (consider suppressing):", "  Temuan dengan kepercayaan rendah (pertimbangkan untuk dikecualikan):");
  for (const [cat, c] of lowConf) {
    say(`    ${cat} — ${Math.round(c.score * 100)}% confidence (${c.seen}x, kept ${c.kept}x, reverted ${c.reverted}x, ignored ${c.ignored}x)`,
        `    ${cat} — ${Math.round(c.score * 100)}% kepercayaan (${c.seen}x, dipertahankan ${c.kept}x, dikembalikan ${c.reverted}x, diabaikan ${c.ignored}x)`);
  }

  const exists = loadSuppressions();
  if (exists.length > 0) {
    say("\n  Current suppressions in .ai-learning/suppressions.json:", "\n  Pengabaian saat ini di .ai-learning/suppressions.json:");
    for (const s of exists) {
      say(`    ${s.category} (since ${s.since?.slice(0, 10) || "?"})`, `    ${s.category} (sejak ${s.since?.slice(0, 10) || "?"})`);
    }
  }

  say("\n  To apply: learn-agent --forget --category=<name>", "\n  Untuk menerapkan: learn-agent --forget --category=<name>");
}

// ─── Forget (suppress a category) ───
async function cmdForget() {
  const cat = process.argv.find((a) => a.startsWith("--category="))?.slice("--category=".length);
  if (!cat) {
    say("  Usage: learn-agent --forget --category=<category>", "  Penggunaan: learn-agent --forget --category=<kategori>");
    say("  Example: learn-agent --forget --category=console.log", "  Contoh: learn-agent --forget --category=console.log");
    return;
  }

  const suppressions = loadSuppressions();
  if (suppressions.some((s) => s.category === cat)) {
    say(`  Category "${cat}" is already suppressed.`, `  Kategori "${cat}" sudah dikecualikan.`);
    return;
  }

  suppressions.push({ category: cat, since: new Date().toISOString() });
  saveSuppressions(suppressions);
  await appendEvent({ type: "category_suppressed", category: cat });
  say(`  ✓ "${cat}" suppressed. Scan/review agents will now deprioritize it.`, `  ✓ "${cat}" dikecualikan. Agent scan/review sekarang akan mengurangi prioritasknya.`);
}

// ─── Main ───
async function main() {
  try {
    switch (mode) {
      case "analyze":
        cmdAnalyze();
        break;
      case "suggest":
        cmdSuggest();
        break;
      case "forget":
        await cmdForget();
        break;
      default:
        cmdStatus();
        break;
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();
