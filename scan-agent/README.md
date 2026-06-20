# Scan Agent

Local code scanner — 100% offline, no AI, no API key. Detects common code issues instantly.

## Detection

| Category | What it finds |
|----------|---------------|
| CONSOLE | `console.log`, `console.debug`, `console.info` |
| TODO | `// TODO`, `// FIXME`, `// HACK`, `// XXX` |
| DEBUGGER | `debugger;` statement |
| SECRETS | Hardcoded API keys, tokens, passwords |
| EMPTY_CATCH | Empty catch blocks |
| MAGIC_NUMBERS | Large unexplained numeric literals |
| HARDCODED_URL | Hardcoded localhost/domain URLs |
| DUPLICATE_IMPORT | Same module imported twice |
| BIG_FILE | Files over 500 KB |
| LEGACY | `var` keyword |
| TS_ANY | `: any` type usage |

## Setup

```bash
cd scan-agent
npm install
npm install -g .
```

## Usage

```bash
# Scan current project
scan-agent

# Scan specific path
scan-agent --path=./my-project

# Quiet mode (only write report file, no console output)
scan-agent --quiet
```
