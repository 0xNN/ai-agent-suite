# Fixer Agent

AI agent untuk otomatis memperbaiki kode berdasarkan hasil review dari `code-reviewer-agent`.

## Setup

```bash
cd fixer-agent
npm install
npm install -g .
```

Buat `.env`:

```env
FIXER_API_KEY=your-api-key
FIXER_BASE_URL=https://token-plan-sgp.xiaomimimo.com/v1
FIXER_MODEL=nama-model
```

Bisa复用 env vars dari code-reviewer-agent (FIXER_API_KEY fallback ke CODE_REVIEW_API_KEY).

## Usage

Jalankan dari root project yang sudah di-review:

```bash
# Lihat daftar perbaikan yang bisa diterapkan (default: report terbaru)
fixer-agent

# Apply perbaikan ke file
fixer-agent --apply

# Gunakan report tertentu
fixer-agent --apply --report=ai-review-report-2026-06-17T05-00-00-000Z.md

# Dry-run (tanpa LLM)
fixer-agent --dry-run

# Path spesifik
fixer-agent --path=./my-project
```

Alur: baca report → parse findings → kirim file + issue ke LLM → tampilkan diff → apply jika `--apply`.

Juga bisa dipicu otomatis dari `code-reviewer-agent` — setelah review selesai, akan ada prompt untuk menjalankan `fixer-agent --apply`.

## Related Agents

| Agent | Role |
|-------|------|
| `code-reviewer-agent` | AI code review → generate report |
| `scan-agent` | Local deterministic scan (pre-filter, no AI) |
| `fixer-agent` | Auto-fix berdasarkan report review |
