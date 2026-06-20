# Code Reviewer Agent

AI agent untuk review kode sebelum build. Membaca source project, mengirim snapshot ke LLM OpenAI-compatible, lalu membuat report Markdown.

Review fokus pada: runtime bug, security issue, performance, logic error, dead code, maintainability.

Build bisa gagal otomatis jika report berstatus `fail` dengan severity `critical`, `high`, atau `medium`.

---

## Setup

```bash
cd code-reviewer-agent
npm install
npm install -g .
```

Buat `.env` di folder agent:

```env
CODE_REVIEW_API_KEY=your-key
CODE_REVIEW_BASE_URL=https://api.openai.com/v1
CODE_REVIEW_MODEL=gpt-4o
```

---

## Usage

```bash
# Review project saat ini
code-reviewer-agent

# Path spesifik
code-reviewer-agent --path=./my-project

# Bahasa Indonesia
code-reviewer-agent --lang=id

# Stream mode (token real-time kayak ChatGPT)
code-reviewer-agent --stream

# Dry-run (tanpa panggil API)
code-reviewer-agent --dry-run

# Lihat daftar file yang akan dikirim
code-reviewer-agent --print-files

# Debug raw SSE (stream mode)
code-reviewer-agent --stream --debug-stream
```

### CI Integration

```json
{
  "scripts": {
    "review": "code-reviewer-agent",
    "build": "npm run review && vite build"
  }
}
```

Saat `npm run build`, review jalan dulu. Jika gagal, build berhenti.

---

## Multi-Language

Ganti skill prompt sesuai bahasa project:

| Bahasa | Skill File | .ai-reviewer.json |
|--------|-----------|-------------------|
| JavaScript/TypeScript | `skills/SKILL.md` (default) | `skills/ts-ai-reviewer.json` |
| Go | `skills/go-code-reviewer.md` | `skills/go-ai-reviewer.json` |
| Flutter/Dart | `skills/flutter-code-reviewer.md` | `skills/flutter-ai-reviewer.json` |

Cara pakai untuk Go:

```bash
cp skills/go-code-reviewer.md skills/SKILL.md
```

`.ai-reviewer.json`:

```json
{
  "include": ["**/*.go", "go.mod"],
  "exclude": ["vendor/**", ".git/**", "*.pb.go", "**/*_test.go"]
}
```

Untuk Flutter:

```bash
cp skills/flutter-code-reviewer.md skills/SKILL.md
```

```json
{
  "include": ["**/*.dart", "pubspec.yaml"],
  "exclude": [".dart_tool/**", "build/**", ".git/**", "**/*.g.dart", "**/*.freezed.dart", "test/**"]
}
```

> Semua file skill dan `.ai-reviewer.json` ada di `./skills/`.

---

## Features

### Local Pre-Scan (no AI)

Sebelum panggil AI, otomatis jalankan **scan-agent** untuk deteksi isu lokal (console.log, TODO, hardcoded secrets, magic numbers, dll). Hasilnya dikirim ke AI sebagai konteks — AI tidak perlu buang token untuk isu trivial.

Matikan:
```env
AI_REVIEW_SKIP_SCAN=1
```

### Auto-Fix

Setelah review selesai, muncul prompt:

```
? Run fixer-agent to auto-fix findings? (y/N)
```

Ketik `y` → jalankan `fixer-agent --apply`. Pastikan fixer-agent sudah terinstall global.

### Fail Build

Build gagal jika `REVIEW_STATUS: fail` + ada severity dalam `CODE_REVIEW_FAIL_ON`:

```env
CODE_REVIEW_FAIL_ON=critical,high,medium
```

Skip review:
```bash
$env:AI_REVIEW_SKIP="1"; npm run build
```

### Streaming

Token muncul real-time. Loader spinner jalan saat nunggu response pertama, lalu berhenti otomatis pas token pertama datang.

---

## Report

Disimpan ke `ai-review-report-<timestamp>.md` dengan format GitHub-flavored Markdown + badge HTML inline.

Struktur: metadata → status badge → summary → tabel findings → detail per finding → notes.

---

## Docker

Build image:

```bash
cd code-reviewer-agent
docker build -t code-reviewer-agent:local .
```

Jalankan:

```powershell
docker run --rm `
  -e CODE_REVIEW_API_KEY="$env:CODE_REVIEW_API_KEY" `
  -e CODE_REVIEW_BASE_URL="$env:CODE_REVIEW_BASE_URL" `
  -e CODE_REVIEW_MODEL="$env:CODE_REVIEW_MODEL" `
  -v "${PWD}:/workspace" `
  code-reviewer-agent:local
```

---

## Environment

| Variable | Default | Keterangan |
|----------|---------|------------|
| `CODE_REVIEW_API_KEY` | — | API key (required) |
| `CODE_REVIEW_BASE_URL` | — | Base URL LLM provider |
| `CODE_REVIEW_MODEL` | `gpt-5` | Nama model |
| `CODE_REVIEW_FAIL_ON` | `critical,high,medium` | Severity yang gagalkan build |
| `CODE_REVIEW_MAX_FILES` | `80` | Maks file dikirim ke LLM |
| `CODE_REVIEW_MAX_BYTES` | `180000` | Maks total bytes |
| `CODE_REVIEW_STREAM` | — | `1` untuk stream mode |
| `AI_REVIEW_SKIP` | — | `1` untuk skip review |
| `AI_REVIEW_SKIP_SCAN` | — | `1` untuk skip local scan |

Urutan prioritas: shell env → `.env` project target → `.env` agent.
