/**
 * Rule: agent.remote-capability
 *
 * Detects remote capability surfaces declared in MCP configs and tool
 * manifests — i.e. agent-reachable endpoints that live off-machine. A
 * remote endpoint can receive prompts, files, memory, or tool output, and
 * its operator can change behavior without re-review.
 *
 * Scope: mcp-config and tool-manifest artifacts.
 *
 * Score: a remote MCP endpoint or remote tool API contributes the
 * `remote-endpoint` signal (+35); generic gateway/proxy/router/registry
 * wording contributes the `gateway` signal (+30). Combined with
 * `credential-reach` or with `dynamic-registry` + `memory-request`/
 * `local-execution` the finding escalates to `critical` per the scoring
 * engine.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';

import {
	findLinePatternMatches,
	type LinePatternMatch,
	type LinePatternSpec,
} from './line-patterns.ts';
import { computeScore, computeSeverity, Signal } from './scoring.ts';

type RemoteKind =
	| 'gateway-wording'
	| 'http-transport'
	| 'npx-remote-bridge'
	| 'proxy-wording'
	| 'registry-wording'
	| 'remote-mcp-url'
	| 'remote-tool-api'
	| 'router-wording'
	| 'sse-transport';

interface PatternSpec extends LinePatternSpec<RemoteKind> {
	readonly signal: Signal;
	readonly title: string;
}

const PATTERNS: readonly PatternSpec[] = [
	{
		kind: 'remote-mcp-url',
		pattern: /["']?url["']?\s*[:=]\s*"https?:\/\/[^"]+"/i,
		signal: Signal.RemoteEndpoint,
		title: 'Remote MCP endpoint declared',
	},
	{
		kind: 'sse-transport',
		pattern: /["']?(?:transport|type)["']?\s*[:=]\s*["'](?:sse|http|streamable[-_]?http)["']/i,
		signal: Signal.RemoteEndpoint,
		title: 'Remote MCP transport (SSE/HTTP) declared',
	},
	{
		kind: 'http-transport',
		pattern: /["']?endpoint["']?\s*[:=]\s*"https?:\/\/[^"]+"/i,
		signal: Signal.RemoteEndpoint,
		title: 'Remote tool endpoint declared',
	},
	{
		kind: 'remote-tool-api',
		pattern:
			/["']?(?:api[_-]?url|baseUrl|base_url|server[_-]?url)["']?\s*[:=]\s*"https?:\/\/[^"]+"/i,
		signal: Signal.RemoteEndpoint,
		title: 'Remote tool API base URL declared',
	},
	{
		kind: 'npx-remote-bridge',
		pattern:
			/"(?:mcp[-_]?remote|@modelcontextprotocol\/server-fetch|@modelcontextprotocol\/server-everything|supergateway)"/i,
		signal: Signal.RemoteEndpoint,
		title: 'Local launcher bridges to a remote MCP server',
	},
	{
		kind: 'gateway-wording',
		pattern:
			/\b(?:mcp|tool|api|service)\s+gateway\b|\bgateway\s+(?:server|endpoint|service)\b/i,
		signal: Signal.Gateway,
		title: 'Gateway wording in agent artifact',
	},
	{
		kind: 'proxy-wording',
		pattern: /\b(?:mcp|tool|api|reverse)\s+proxy\b|\bproxy\s+(?:server|endpoint|service)\b/i,
		signal: Signal.Gateway,
		title: 'Proxy wording in agent artifact',
	},
	{
		kind: 'router-wording',
		pattern: /\b(?:mcp|tool|api|request)\s+router\b|\brouter\s+(?:server|endpoint|service)\b/i,
		signal: Signal.Gateway,
		title: 'Router wording in agent artifact',
	},
	{
		kind: 'registry-wording',
		pattern: /\b(?:mcp|tool|server)\s+registry\b|\bregistry\s+(?:url|endpoint|server)\b/i,
		signal: Signal.Gateway,
		title: 'Remote registry wording in agent artifact',
	},
];

const RECOMMENDATION =
	'Remove the remote endpoint, or verify operator trust and transport. Remote MCP ' +
	'servers, gateways, and proxies receive everything the agent passes to them — ' +
	'prompts, file contents, tool output. Prefer local stdio servers from pinned, ' +
	'verified publishers, and treat remote endpoints as untrusted unless you ' +
	'control the host and the TLS chain.';

const IN_SCOPE: ReadonlySet<Artifact['type']> = new Set(['mcp-config', 'tool-manifest']);

type Match = LinePatternMatch<RemoteKind, PatternSpec>;

function buildFinding(artifact: Artifact, match: Match): Finding {
	const signals: readonly string[] = [match.signal];
	return {
		confidence: match.signal === Signal.RemoteEndpoint ? 'high' : 'medium',
		evidence: `[${match.kind}] ${match.evidence}`,
		file: artifact.path,
		group: 'remote-capabilities',
		id: `agent.remote-capability:${artifact.path}:${match.kind}:${match.line}`,
		line: match.line,
		recommendation: RECOMMENDATION,
		ruleId: 'agent.remote-capability',
		score: computeScore(signals),
		severity: computeSeverity(signals),
		signals,
		source: artifact.source,
		title: match.title,
	};
}

export const remoteCapabilityRule: Rule = {
	description:
		'Flags MCP configs and tool manifests that declare remote endpoints, ' +
		'remote tool APIs, npx/bunx bridges to remote MCP servers, or ' +
		'gateway/proxy/router/registry wording — capability surfaces that live ' +
		'off-machine and can change behavior without re-review.',
	group: 'remote-capabilities',
	id: 'agent.remote-capability',
	scan(ctx: RuleContext): Finding[] {
		const findings: Finding[] = [];
		for (const artifact of ctx.artifacts) {
			if (!IN_SCOPE.has(artifact.type)) continue;
			for (const match of findLinePatternMatches(artifact.content, PATTERNS)) {
				findings.push(buildFinding(artifact, match));
			}
		}
		return findings;
	},
	title: 'Remote capability',
};
