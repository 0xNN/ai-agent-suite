# AI Agents — GitHub CI Integration

## Cara Kerja

Setiap PR ke `main`/`master`, GitHub Actions otomatis:
1. Install semua AI agents di runner
2. Jalanin pipeline: `scan → review → task → fix → test`
3. Post hasil review sebagai PR comment
4. Set status check **"AI Code Review"** → **WAJIB pass** sebelum merge

## Setup (sekali)

### 1. Tambah Secrets di GitHub

`Settings → Secrets and variables → Actions → New repository secret`:

| Secret | Wajib? | Deskripsi |
|--------|--------|-----------|
| `CODE_REVIEW_API_KEY` | ✅ Wajib | API key untuk AI review |
| `CODE_REVIEW_MODEL` | ❌ Optional | Model override (default: `gpt-4o`) |
| `CODE_REVIEW_BASE_URL` | ❌ Optional | Base URL override |

### 2. Copy Workflow File

```bash
cp .github/workflows/ai-review.yml project/.github/workflows/
```

Atau dari repo `ai-agent-suite`:
```bash
cp ai-agent-suite/.github/workflows/ai-review.yml project/.github/workflows/
```

### 3. Aktifkan Branch Protection

`Settings → Branches → Add branch protection rule`:
- Branch: `main` atau `master`
- ☑ **Require status checks to pass before merging**
- Cari "AI Code Review" → centang
- ☑ **Require branches to be up to date**
- Save

### 4. Push & Test

Buat PR → lihat workflow jalan otomatis → cek comment di PR.

## Struktur Workflow

```yaml
on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]

jobs:
  review:
    steps:
      - Checkout project
      - Setup Node.js 20
      - Install AI agents
      - Run orchestrator --ci
      - Upload reports (.md files)
      - Comment PR dengan hasil review
      - Set status check pass/fail
```

## Hasil

- ✅ **Passed** → PR bisa di-merge
- ❌ **Failed** → PR terblokir, developer wajib fix
- Report ada di **PR comment** + **Artifacts** (downloadable)

## Cost & Performance

| Step | Duration | Cost |
|------|----------|------|
| Install agents | ~15 detik | Free (GitHub) |
| Scan | ~5 detik | Free |
| AI Review | ~30-60 detik | API call |
| Task + Fix + Test | ~30 detik | API call (LLM) |
| **Total** | ~1-2 menit | ~$0.01-0.05/run |
