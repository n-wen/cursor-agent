# Cursor Agent — OpenClaw Plugin

English | [中文](README.zh-CN.md)

Invoke the local Cursor Agent CLI directly from OpenClaw chat conversations via the `/cursor` command to analyze, troubleshoot, and modify project code. Results are returned verbatim without LLM re-summarization. Also supports registration as a PI Agent Tool for automatic invocation when the user doesn't use the command explicitly.

## Key Features

- Direct invocation via `/cursor` command with verbatim result passthrough (bypasses LLM agent)
- Optional Agent Tool registration for automatic PI Agent invocation (fallback mechanism)
- Automatically loads project context from `.cursor/rules`, `AGENTS.md`, etc.
- Supports enabling project-configured MCP servers (GitLab, databases, monitoring, etc.)
- Three execution modes: `agent` (default, can modify files), `ask` (read-only analysis), `plan` (generate plans)
- Session management: continue/resume previous sessions
- Multi-project mapping table for quick project switching by name
- Robust subprocess management: isolated process groups, two-phase graceful termination, concurrency control, Gateway exit cleanup
- Automatic long content splitting into multiple messages

## Prerequisites

| Dependency | Description |
|------------|-------------|
| Cursor Agent CLI | Must be installed locally (`agent` command, see installation steps below) |
| Cursor Subscription | CLI uses model quota from your Cursor subscription |
| OpenClaw Gateway | v2026.2.24+ |

## Installing Cursor Agent CLI

### Linux / macOS

```bash
curl https://cursor.com/install -fsSL | bash
```

After installation, you may need to add `$HOME/.local/bin` to your PATH:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Windows

Run in PowerShell:

```powershell
irm https://cursor.com/install | iex
```

Default installation path: `%LOCALAPPDATA%\cursor-agent\agent.cmd`.

### Verify Installation

```bash
agent --version
```

### Authentication

First-time usage requires logging into your Cursor account:

```bash
agent login
```

Or set the API key via environment variable:

```bash
export CURSOR_API_KEY="your-api-key"
```

## Plugin Installation

### Option 1: Source Path Loading (Development Mode)

Add the plugin source path to `plugins.load.paths` in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/cursor-agent"]
    }
  }
}
```

### Option 2: tgz Package Install

```bash
# Build and pack
cd plugins/cursor-agent
npm ci && npm run build && npm pack

# Install via OpenClaw CLI
openclaw plugin install cursor-agent-0.1.0.tgz
```

## Configuration

Configure the plugin in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "cursor-agent": {
        "enabled": true,
        "config": {
          "projects": {
            "my-project": "/home/user/projects/my-project",
            "another-project": "/home/user/projects/another"
          },
          "defaultTimeoutSec": 600,
          "noOutputTimeoutSec": 120,
          "enableMcp": true,
          "maxConcurrent": 3,
          "enableAgentTool": true
        }
      }
    }
  }
}
```

### Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `projects` | `object` | `{}` | Project name to local absolute path mapping |
| `agentPath` | `string` | auto-detect | Full path to Cursor Agent CLI |
| `defaultTimeoutSec` | `number` | `600` | Maximum execution time per invocation (seconds) |
| `noOutputTimeoutSec` | `number` | `120` | No-output timeout (seconds); process is considered hung if no output for this duration |
| `model` | `string` | CLI default | Model for Cursor Agent to use |
| `enableMcp` | `boolean` | `true` | Whether to enable MCP servers (`--approve-mcps`) |
| `maxConcurrent` | `number` | `3` | Maximum concurrent Cursor CLI processes |
| `enableAgentTool` | `boolean` | `true` | Whether to register Agent Tool for PI Agent auto-invocation |

## Usage

After configuration and Gateway restart, use the `/cursor` command in OpenClaw conversations:

### Basic Usage

```
/cursor my-project analyze the auth module implementation and find potential security issues
```

### Specifying Mode

```
/cursor my-project --mode ask explain the architecture of src/auth
/cursor my-project --mode plan design a new caching layer
```

### Session Management

```
# Continue previous session
/cursor my-project --continue are there other security issues?

# Resume a specific session (session ID is shown in the footer of each result)
/cursor my-project --resume abc123 add unit tests based on this analysis
```

### Viewing Session History

Each execution result footer displays the session ID (e.g., `💬 97fe5ea8-...`), which can be used with `--resume` to continue that session.

To view the full session history in the terminal, use the Cursor Agent CLI directly:

```bash
# List sessions in the project directory
cd /path/to/project
agent ls

# Interactively resume a session
agent resume
# Or specify a session ID
agent --resume <chatId>
```

For more information, see the [Cursor Agent CLI documentation](https://cursor.com/docs/cli/using).

### Command Format

```
/cursor <project> [options] <prompt>
```

| Parameter | Description |
|-----------|-------------|
| `<project>` | Project name (key from mapping table) or absolute path |
| `<prompt>` | Detailed description of the analysis task |
| `--mode <mode>` | Execution mode: `agent` (default) / `ask` / `plan` |
| `--continue` | Continue previous session |
| `--resume <chatId>` | Resume a specific session |

## Development

```bash
cd plugins/cursor-agent

# Install dependencies
npm install

# Development mode (watch)
npm run dev

# Build
npm run build

# Pack
npm pack
```

## Agent Tool (Fallback Invocation)

In addition to the `/cursor` command, the plugin can register a `cursor_agent` Agent Tool, enabling PI Agent to automatically invoke Cursor CLI during conversations.

### How It Works

When a user mentions code analysis needs in a conversation without using the `/cursor` command, PI Agent can automatically invoke the `cursor_agent` tool.

### Enabling

1. Ensure `enableAgentTool` is `true` (default)
2. Add `cursor_agent` or `group:plugins` to `tools.allow` in OpenClaw configuration

### Differences from /cursor Command

| Feature | `/cursor` Command | Agent Tool |
|---------|-------------------|------------|
| Trigger | User explicitly types | PI Agent auto-determines |
| Result handling | Returned directly, bypasses LLM | Returned as tool result |
| Default mode | `agent` (can modify files) | `ask` (read-only analysis) |
| Session management | Supports --continue/--resume | Not supported |

## Architecture

```
src/
├── index.ts              # Plugin entry, registers /cursor command + cursor_agent tool
├── types.ts              # Type definitions (config, events, parsed command)
├── parser.ts             # Cursor Agent stream-json output parser
├── runner.ts             # CLI process management, timeout control, event stream collection
├── formatter.ts          # Event stream formatting to Markdown output
├── process-registry.ts   # Global process registry, concurrency control, Gateway exit cleanup
└── tool.ts               # Agent Tool factory function
```

### Two Invocation Paths

```
User Message
  ├─ /cursor command ──→ registerCommand handler ──→ runCursorAgent ──→ result returned to user
  └─ Regular chat ──→ PI Agent ──→ cursor_agent tool ──→ runCursorAgent ──→ tool result
```

### Subprocess Management

- Uses `detached: true` on Unix to create isolated process groups, preventing accidental Gateway signal kills
- Two-phase termination: SIGTERM (graceful exit) → 5 seconds → SIGKILL (force kill)
- Global process registry tracks all active processes with concurrency limits
- Automatic cleanup of all subprocesses on Gateway exit

## License

[Apache-2.0](LICENSE)
