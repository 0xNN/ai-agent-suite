# Commit Agent

AI agent untuk generate Conventional Commit message dari git diff.

## Setup

```bash
cd D:\Puninar\commit-agent
npm install
npm install -g .
```

Buat `.env`:

```env
COMMIT_API_KEY=your-api-key
COMMIT_BASE_URL=https://token-plan-sgp.xiaomimimo.com/v1
COMMIT_MODEL=nama-model
```

## Usage

```bash
# Staged + unstaged changes (default)
commit-agent

# Staged changes only
commit-agent --staged

# Dry-run (lihat diff tanpa panggil LLM)
commit-agent --dry-run

# Auto-commit
commit-agent --commit

# Bahasa Indonesia
commit-agent --lang=id
```
