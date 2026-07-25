# AgentWatch

Cross-platform TypeScript/Bun CLI for local, read-only inspection of AI-agent capability surfaces.

> Show me what agent capabilities are installed, what they can reach, what can change remotely, and where personal or work context could flow.

## What It Does

AgentWatch scans your local machine for installed AI-agent configurations and reports on security-relevant findings:

- **Remote capabilities** — Remote MCP endpoints, hosted tool APIs, vendor-controlled surfaces
- **Memory/context exposure** — Skills requesting personal data, preferences, or work context
- **Dynamic tool surfaces** — Capabilities that can change after installation
- **Local execution bridges** — Agent-configured paths to local command execution
- **Untrusted provenance** — Install sources that are hard to audit
- **Credential reachability** — Agent capabilities that can reach sensitive files or tokens

## Supported Agents

| Agent         | Config Locations                                                               |
| ------------- | ------------------------------------------------------------------------------ |
| Claude        | `~/.claude`, `%APPDATA%/Claude/`, `./.claude`                                  |
| Codex         | `~/.codex`, `./.codex`, `./AGENTS.md`                                          |
| OpenCode      | `~/.config/opencode`, `~/.opencode`, `./.opencode`                            |
| Kilo          | `~/.config/kilo`, `~/.kilocode`, `./.kilo`                                     |
| Cursor        | `~/.cursor`, `%APPDATA%/Cursor/`, `./.cursor`                                  |
| Windsurf      | `~/.codeium/windsurf`, `~/.windsurf`, `%APPDATA%/Windsurf/`, `./.windsurf`     |
| Windsurf Next | `~/.windsurf-next`, `%APPDATA%/Windsurf-Next/`, `./.windsurf-next`             |
| Antigravity   | `~/.gemini/antigravity`, `~/.antigravity`, `%APPDATA%/Antigravity/`, `./.antigravity` |
| Gemini        | `~/.gemini`, `./.gemini`                                                       |
| Grok          | `~/.grok`, `./.grok`                                                           |
| Kiro          | `~/.kiro`, `./.kiro`                                                           |
| Copilot       | `~/.copilot`, `./.copilot`                                                     |
| Zcode         | `~/.zcode`, `./.zcode`                                                         |
| Generic Agents | `~/.agents`, `./.agents`                                                      |
| Cline         | `~/.cline`, `./.cline`                                                         |
| Pi            | `~/.pi`, `%APPDATA%/Pi/`, `./.pi`                                              |
| Global Skills | `~/skills`, `./skills`                                                         |
| Global MCP    | `~/.mcp.json`, `./.mcp.json`                                                   |

Fourteen of these form the canonical agent-home set agentwatch recognizes (Claude, Codex,
OpenCode, Kilo, Cursor, Windsurf, Antigravity, Gemini, Grok, Kiro, Copilot, Zcode, Generic
Agents, Cline). Windsurf Next, Pi, Global Skills, and Global MCP are agentwatch-only
inspection surfaces.

## Installation

```bash
# Install dependencies
bun install
```

That is enough to run the CLI directly. Optionally:

```bash
# Compile to a standalone binary at dist/agentwatch (dist\agentwatch.exe on Windows)
bun run compile

# Or expose a global `agentwatch` shim that runs src/cli.ts via Bun
bun link
```

## Usage

Pick whichever invocation matches your install:

| How you installed   | Invocation                    |
| ------------------- | ----------------------------- |
| `bun install` only  | `bun src/cli.ts <command>`    |
| `bun run compile`   | `./dist/agentwatch <command>` |
| `bun link` (global) | `agentwatch <command>`        |

Examples (using `bun src/cli.ts` — substitute your preferred form):

```bash
# Scan all known agent surfaces
bun src/cli.ts scan

# JSON output
bun src/cli.ts scan --json

# Limit to specific agent
bun src/cli.ts scan --agent claude

# Add custom scan paths
bun src/cli.ts scan --path ~/.config --path ./my-project

# Inspect a specific skill file
bun src/cli.ts inspect-skill ./SKILL.md

# Inspect a specific MCP config
bun src/cli.ts inspect-mcp ~/.config/Claude/claude_desktop_config.json

# Probe a remote MCP server (opt-in network access; enumerates only)
bun src/cli.ts probe https://example.com/mcp

# Explain a specific finding
bun src/cli.ts explain agent.remote-capability
```

### `probe` — opt-in remote MCP enumeration

`scan` is purely static and cannot see what an MCP server actually returns at
runtime. A "single-purpose" config can sit in front of a generic gateway that
serves different tools to different sessions; that dynamism only shows up over
the wire. The `probe` subcommand contacts a URL the user supplies, performs the
MCP `initialize` handshake, and calls `tools/list` (plus `prompts/list` and
`resources/list` if advertised). It never invokes a tool — only enumerates.

```bash
# Plain probe
bun src/cli.ts probe https://example.com/mcp

# With auth and a custom header
bun src/cli.ts probe https://example.com/mcp --auth "$TOKEN" --header "X-Tenant: acme"

# JSON output
bun src/cli.ts probe https://example.com/mcp --json
```

Heuristics flag generic-dispatch tool names (`call`, `invoke`, `dispatch`, `proxy`),
gateway/marketplace wording in tool descriptions, broad/universal capability claims,
and unusually high tool counts.

## Safety Principles

- **Read-only** — Never writes, executes, or modifies anything
- **Network access is opt-in** — `scan`, `inspect-skill`, `inspect-mcp`, and `explain` never touch the network. Only `probe <url>` contacts the URL the user passes, and only to enumerate the server's declared surface — never to invoke a tool
- **No cloud upload** — Scan and probe results stay on your machine
- **Credential masking** — Full secret values are never printed
- **Agent-linked boundary** — Only scans paths related to AI agents, not broad workstation surfaces

## Development

### Prerequisites

- [Bun](https://bun.sh/) runtime

### Setup

```bash
bun install
```

### Commands

```bash
bun run build       # Build the CLI
bun run compile     # Compile to standalone binary
bun run test        # Run tests
bun run typecheck   # TypeScript type checking
bun run lint        # Lint code
bun run format      # Format code with Prettier
```

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict, ES Modules)
- **CLI:** Commander
- **Glob:** fast-glob
- **Validation:** zod
- **Testing:** bun test

## License

[MIT](LICENSE). Third-party dependency licenses are reproduced in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
