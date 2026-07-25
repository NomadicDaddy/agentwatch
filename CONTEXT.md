# AgentWatch Glossary

Canonical terms for AgentWatch, a cross-platform TypeScript/Bun CLI for local,
read-only inspection of installed AI-agent capability surfaces. Definitions are
plain-language and deliberately free of implementation detail; file paths appear
only when they serve as evidence for how a term is used in practice.

## Agent

A named AI assistant product or ecosystem whose local configuration AgentWatch
knows how to discover. Each Agent has a canonical identifier (for example
`claude`, `codex`, `cursor`) and a set of platform-specific filesystem roots
where its skills, MCP servers, instructions, and connector configs live. The
special `custom` Agent is not discovered from the registry; it is created on the
fly for directories the user passes via `--path`.

Fourteen canonical Agents are recognized: claude, codex, opencode, kilo, cursor, windsurf,
antigravity, gemini, grok, kiro, copilot, zcode, agents, and cline. Four agentwatch-only
inspection surfaces are also recognized:
windsurf-next, pi, mcp, skills, plus the special `custom` Agent that is created on the fly for
directories the user passes via `--path`.

## Agent Source

A concrete, existing filesystem root that has been attributed to an Agent. An
Agent Source carries the Agent name, the absolute root path, and a flag that
distinguishes registry-discovered roots from user-supplied custom paths. Every
Artifact and Finding is attributed back to the Agent Source it was discovered
under.

## Artifact

A single text file read from disk during a scan that the classifier assigned one
of the eight Artifact Types. An Artifact carries its raw content, absolute path,
the Agent Source it was discovered under, and its type. Rules consume Artifacts
and produce Findings.

Unclassified files, binary files, files larger than 1 MiB, symlinks, and files
inside ignored directories (node_modules, .git, dist, build) are never promoted
to Artifacts.

## Artifact Type

The categorical kind assigned to a discovered file. There are exactly eight:
skill, mcp-config, tool-manifest, connector-config, permission-config,
memory-config, agent-instruction, and provenance. The classifier checks filename
first, then content heuristics, and returns null for anything it cannot
categorize. A null result means the file is skipped, not given a default type.

## Capability Surface

The set of things an Agent has been configured to reach, invoke, read, or run.
AgentWatch treats the local configuration files as the static description of
that surface. A Capability Surface can be remote (endpoints the Agent contacts),
dynamic (tools that can be registered or discovered at runtime), local
(command execution bridges), credential-reaching, memory-exposing, or
broadly-worded.

## Confidence

A per-Finding estimate of how reliable the detection is: high, medium, or low.
Confidence does not change the score or severity. It gives the reader a hint
about whether the signal is a near-certain pattern match or a softer wording
heuristic.

## Connector

An Agent configuration that grants the Agent access to an external service such
as Gmail, Google Drive, GitHub, Slack, Notion, or Jira. Connectors are the
mechanism through which an Agent reaches credentials and user data held by a
third-party service. The credential-reachability rules scope to connector-config
and tool-manifest Artifacts that declare OAuth scopes, tokens, or sensitive
paths.

## Credential Reach

The condition where an Agent Artifact references, points at, or is configured to
read a credential. This covers OAuth scopes, token fields, API keys, bearer
tokens, and sensitive filesystem paths such as `.ssh`, `.aws`, `.env`, or
`.gnupg`. Credential Reach is recorded as the `credential-reach` signal and, on
its own, scores 20 points. When combined with the `remote-endpoint` signal it
forces the Finding to critical severity regardless of the numeric total.

## Dynamic Tool Surface

A Capability Surface that can change after installation. This covers tool
registries that can register or discover tools at runtime, trigger-based
invocation patterns that auto-route prompts to a tool, and broad wording that
describes an unbounded toolset. Dynamic surfaces defeat static review because the
set of capabilities active at run time can differ from what was present at audit
time.

## Execution Bridge

A path from an Agent Artifact to local command execution. An Execution Bridge
exists when an MCP config or tool manifest launches an interpreter (npx, bunx,
uvx, node, python, pwsh, bash) or references a local binary, or declares a stdio
MCP server. Execution Bridges are not inherently malicious; they mean the Agent
can spawn local code with the user's privileges, and that deserves review for
pinning and publisher trust.

An Unpinned Execution Bridge is the specific case where npx, bunx, uvx, or pipx
launches a package without a pinned version. Unpinned launchers resolve to the
latest registry release at run time, so a hijacked or republished package can
introduce new code with no review.

## Finding

A single risk signal produced by a Rule against one Artifact. A Finding carries
a rule id, a Finding Group, a severity, a composite score, one or more signals,
a confidence, the source Agent, an optional file and line, masked evidence, and a
recommendation. Findings are deduplicated by rule id, file, line, and sorted
signal set, then sorted by score descending, rule id, and finding id for
deterministic output.

## Finding Group

One of six risk categories a Finding belongs to: remote-capabilities,
memory-context-exposure, dynamic-tool-surfaces, local-execution-bridges,
untrusted-provenance, and credential-reachability. Findings are grouped and
rendered under these headings in both the human and JSON reports.

## Gateway

A generic dispatch surface: an MCP server, tool, or manifest that describes
itself as a gateway, proxy, router, marketplace, registry, or "universal"
toolbox. Gateways concentrate trust on a single operator who can pivot to any
downstream capability after install. Gateway wording is recorded as the
`gateway` signal and scores 30 points.

## Manifest

A remote document that describes which tools, plugins, or capabilities an Agent
should load. A Remote Manifest is a manifest, update URL, plugins manifest, or
hosted tool list hosted on a remote server. The publisher can change the Agent's
capability set after install by editing the remote manifest, without re-review.
Remote Manifest references are recorded with the `remote-endpoint` signal.

## Masking

The process of redacting likely secrets in evidence strings before display or
serialization. Masking keeps a short prefix so the evidence stays forensically
useful while never printing the full secret value. Masking covers prefixed API
keys, bearer tokens, keyed secret values, emails, sensitive directory paths,
`.env` filenames, and long opaque tokens.

## MCP

The Model Context Protocol. AgentWatch treats MCP as a transport and capability
model: an Agent configures MCP servers (local stdio or remote HTTP/SSE) that
expose tools, prompts, and resources. The `mcp-config` Artifact Type covers
files that declare an `mcpServers` block, and the probe subcommand performs a
live `initialize` and `tools/list` (plus `prompts/list` and `resources/list`
when advertised) to enumerate a remote MCP server's declared surface.

## Probe

The opt-in act of contacting a remote MCP server over the network to enumerate
what it actually advertises. Probing is the only place AgentWatch touches the
network. A Probe performs at most four JSON-RPC requests (initialize,
notifications/initialized, tools/list, and optionally prompts/list and
resources/list). A Probe never invokes a tool. Probe Issues are heuristic
findings about the live surface: non-HTTPS transport, high tool count, generic
dispatch tool names, gateway wording, broad capability wording, and missing
server info.

## Recommendation

The remediation guidance attached to every Finding. Recommendations describe
concrete steps a reviewer can take: pin versions, remove remote endpoints,
restrict memory access, move secrets to a credential manager, replace broad
wording with named scoped capabilities, and so on. Recommendations are constant
per Rule, not per Finding.

## Remote Capability

A Capability Surface that lives off-machine and can receive prompts, files,
memory, or tool output from the Agent. Remote Capabilities include remote MCP
endpoints, remote tool APIs, bridges to remote MCP packages (such as
mcp-remote), and remote manifests. The operator of a Remote Capability can
change behavior without re-review. Remote endpoint declarations are recorded as
the `remote-endpoint` signal and score 35 points.

## Rule

A pure function over a RuleContext (the set of Artifacts plus the detected
platform) that returns a list of Findings. Every Rule has a stable id, a title,
a description, and a Finding Group. Rules must not perform I/O, mutate shared
state, or rely on external state. Twelve Rules are registered with the scan
orchestrator, and focused subsets run for inspect-skill and inspect-mcp.

## RuleContext

The input bundle passed to every Rule: the collected Artifacts and the detected
platform. Rules are evaluated against this context in isolation so that the same
context always produces the same Findings.

## Scan

The primary AgentWatch operation. A Scan discovers Agent Sources, reads
Artifacts, runs all registered Rules, deduplicates and sorts the Findings, and
emits a human-readable or JSON report. A Scan is read-only and never touches the
network.

## Score

The numeric weight of a Finding, computed as the sum of its signal point
contributions. Scores map to severities via fixed bands: 0 to 29 is info, 30 to
59 is low, 60 to 89 is medium, 90 to 119 is high, and 120 and above is critical.
Three signal combinations override the numeric score and force critical
severity.

## Severity

The categorical risk level of a Finding: info, low, medium, high, or critical.
Severity is derived from the Score, except when a critical-escalation signal
combination is present. The default scan threshold is medium: findings below
medium are hidden in the human report unless `--all` is passed, and the exit
code is non-zero only when a finding at or above the threshold is present.

## Signal

A stable label attached to a Finding that records which detection pattern fired.
There are twelve signals, each with a frozen point contribution: remote-endpoint
(+35), gateway (+30), dynamic-registry (+30), memory-request (+25),
trigger-invocation (+25), local-execution (+25), url-shortener (+20),
unpinned-execution (+20), credential-reach (+20), vendor-hosted (+15),
broad-wording (+15), and ad-marketing (+10). Unknown signal labels contribute
zero points.

## Skill

A third-party-authored prompt or capability bundle, typically a SKILL.md file or
a file inside a `skills/` directory. Skills can request personal memory, declare
trigger-based tool invocation, reference credential files, or describe broad
capability surfaces. The `skill` Artifact Type scopes several Rules to
skill-prompt content.

## Trigger-Based Invocation

A pattern in a Skill, agent-instruction, or MCP config that directs the Agent to
auto-invoke a tool based on prompt content. Wording such as "always use this
tool", "on every prompt", "when the user asks", or auto-routing directives
indicates the artifact will pull a tool into context unprompted. Trigger-based
invocation is recorded as the `trigger-invocation` signal and scores 25 points.

## Untrusted Provenance

Install or source metadata that makes a Capability Surface hard to audit. This
covers URL shorteners on install URLs, ad/marketing/referral query parameters,
missing publisher or version fields, and mismatches between declared source
hosts and runtime API hosts. Provenance findings carry the `url-shortener` and
`ad-marketing` signals; the structural checks (missing publisher, missing
version, host mismatch) emit info-severity findings without a scoring signal so
they remain visible as audit context even when the numeric score is zero.

## Vendor-Hosted

A Capability Surface hosted and controlled by a vendor rather than the operator.
Vendor-hosted integrations can change behavior on the vendor's schedule.
Vendor-hosted is recorded as the `vendor-hosted` signal and scores 15 points.

## Example Dialogue

> "I ran a scan and it found three findings against the custom Agent Source: one
> remote-capability finding from an MCP config that declares an HTTPS endpoint,
> one local-execution-bridge finding for the npx launcher in the same config,
> and one unpinned-execution-bridge finding because the npx target has no
> version pin."
>
> "The remote endpoint scored 35, the execution bridge scored 25, and the
> unpinned bridge scored 20. None hit the medium threshold on their own, but the
> probe showed the server also exposes a generic dispatch tool, so the live
> surface is broader than the static config suggested."

## Ambiguities and Contradictions

None identified. The spec, assertions document, and implementation agree on the
nineteen Agents, eight Artifact Types, six Finding Groups, twelve Rules, twelve
Signals, the scoring table, and the three critical-escalation combinations.
