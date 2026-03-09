# yelly-time

Local HTTP server that bridges the [YellySpark](https://github.com/yellyloveai-ops/userscripts) Tampermonkey script to AI agent CLIs.

## Supported Runtimes

| Runtime | Binary | Flag |
|---------|--------|------|
| `claude-code` | `claude` | `--runtime claude-code` |
| `codex-cli` | `codex-cli` | `--runtime codex-cli` |
| `gpt-codex` | `codex` | `--runtime gpt-codex` |

## Quick Start

```bash
node server.js --runtime claude-code
```

Open **http://localhost:2026** in your browser for the Server Manager UI.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--port <n>` | `2026` | HTTP server port |
| `--runtime <name>` | `codex-cli` | Active runtime |
| `--claude <path>` | `claude` | Path to claude binary |
| `--codex <path>` | `codex` | Path to codex binary |
| `--model <name>` | — | Model override |
| `--repo <path>` | — | Git repo for schedule persistence |
| `--alias <name>` | OS username | User alias for schedule file |
| `--session-dir <path>` | `~/.yelly-time/sessions` | Session YAML storage |
| `--interactive` | off | Enable interactive stdin mode |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `YELLYTIME_RUNTIME` | Default runtime |
| `YELLYTIME_CLAUDE_BIN` | Path to claude binary |
| `YELLYTIME_MODEL` | Model name override |
| `YELLYTIME_SCHEDULE_REPO` | Schedule git repo path |
| `YELLYTIME_ALIAS` | User alias |

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Server Manager UI |
| `GET` | `/health` | Health check |
| `GET` | `/token` | Get CSRF token |
| `POST` | `/run` | Run agent (stream) |
| `GET` | `/yelly-time?initialPrompt=` | Start session (PRG) |
| `GET` | `/sessions` | List active sessions |
| `GET` | `/sessions/:id/logs` | Session logs |
| `GET` | `/sessions/:id/export` | Export (json/markdown/text) |
| `POST` | `/sessions/:id/kill` | Kill session |
| `GET` | `/history` | Completed sessions |
| `GET` | `/schedules` | List schedules |
| `POST` | `/schedules` | Create schedule |
| `POST` | `/schedules/:id/run` | Manual trigger |
| `POST` | `/stop` | Shutdown server |

No npm dependencies — stdlib only.
