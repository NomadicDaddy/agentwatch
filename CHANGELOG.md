# Changelog

All notable changes to AgentWatch are documented in this file.

## [0.1.0] - 2026-08-14

### Added

- Added a local, read-only CLI for scanning AI-agent configuration, inspecting individual skills
  and MCP files, and explaining findings in human-readable or JSON reports.
- Added discovery for 21 built-in agent and shared capability surfaces, plus custom scan roots
  supplied with `--path`.
- Added twelve rules covering remote capabilities, memory and context exposure, dynamic tools,
  local execution, untrusted provenance, and credential reachability.
- Added signal-based scoring, severity thresholds, cross-finding correlation, and stable exit codes
  for automation.
- Added an opt-in MCP probe that enumerates declared tools, prompts, and resources without invoking
  them.
- Added a reusable TypeScript API alongside the Bun CLI and standalone compiled binary.

### Security

- Masked credentials, sensitive paths, validation input, and remote response data before they reach
  human or JSON output.
- Restricted remote probes to the operator-selected HTTP or HTTPS endpoint, rejected redirects,
  validated response shapes, and bounded response reads by time and size.
- Rejected symbolic-link scan roots and added commit and push guards for secret material, internal
  AIDD history, and release artifact requirements.

[0.1.0]: https://github.com/NomadicDaddy/agentwatch/releases/tag/v0.1.0
