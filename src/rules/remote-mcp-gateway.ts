/**
 * Rule: agent.remote-generic-mcp-gateway
 *
 * Detects MCP configs and tool manifests that describe themselves as
 * generic gateways, proxies, routers, marketplaces, registries,
 * "universal" toolboxes, or use broad scope wording such as "any tool",
 * "all prompts", "every request", "contextual". Generic gateway surfaces
 * concentrate trust on a single operator who can pivot to any downstream
 * capability after install.
 *
 * Scope: mcp-config and tool-manifest artifacts.
 *
 * Score: marketplace/toolbox/universal-gateway wording contributes the
 * `gateway` signal (+30); broad-scope wording contributes the
 * `broad-wording` signal (+15). When the same artifact also declares a
 * remote endpoint, the finding adds `remote-endpoint` (+35) so the
 * combination escalates per the scoring engine.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';

import {
	findLinePatternMatches,
	type LinePatternMatch,
	type LinePatternSpec,
} from './line-patterns.ts';
import { computeScore, computeSeverity, Signal } from './scoring.ts';

type GatewayKind =
	| 'broad-all-prompts'
	| 'broad-any-tool'
	| 'broad-contextual'
	| 'broad-every-request'
	| 'broad-universal'
	| 'marketplace-wording'
	| 'mcp-gateway-wording'
	| 'toolbox-wording'
	| 'universal-gateway-wording';

interface PatternSpec extends LinePatternSpec<GatewayKind> {
	readonly signal: Signal;
	readonly title: string;
}

const PATTERNS: readonly PatternSpec[] = [
	{
		kind: 'marketplace-wording',
		pattern:
			/\b(?:tool|mcp|plugin|agent)\s+marketplace\b|\bmarketplace\s+(?:server|gateway)\b/i,
		signal: Signal.Gateway,
		title: 'Marketplace wording in MCP/tool artifact',
	},
	{
		kind: 'toolbox-wording',
		pattern:
			/\b(?:universal|generic|all[- ]in[- ]one|any)\s+toolbox\b|\btoolbox\s+(?:server|gateway|mcp)\b/i,
		signal: Signal.Gateway,
		title: 'Toolbox wording in MCP/tool artifact',
	},
	{
		kind: 'universal-gateway-wording',
		pattern:
			/\b(?:universal|generic|all[- ]purpose)\s+(?:gateway|proxy|router|registry|mcp|server)\b/i,
		signal: Signal.Gateway,
		title: 'Universal/generic gateway wording in MCP/tool artifact',
	},
	{
		kind: 'mcp-gateway-wording',
		pattern: /\b(?:supergateway|mcp[- ]?gateway|tool[- ]?gateway|gateway[- ]?mcp)\b/i,
		signal: Signal.Gateway,
		title: 'MCP gateway wording in agent artifact',
	},
	{
		kind: 'broad-any-tool',
		pattern: /\bany\s+(?:tool|server|capability|capabilities|plugin)\b/i,
		signal: Signal.BroadWording,
		title: 'Broad "any tool" wording in agent artifact',
	},
	{
		kind: 'broad-all-prompts',
		pattern: /\ball\s+(?:prompts?|messages?|requests?|user\s+input)\b/i,
		signal: Signal.BroadWording,
		title: 'Broad "all prompts" wording in agent artifact',
	},
	{
		kind: 'broad-universal',
		pattern:
			/\buniversal(?:ly)?\s+(?:tool|tools|capabilities|access|invoke|invoked|invocation)\b/i,
		signal: Signal.BroadWording,
		title: 'Broad "universal" wording in agent artifact',
	},
	{
		kind: 'broad-contextual',
		pattern:
			/\bcontextual(?:ly)?\s+(?:tool|tools|invoke|invoked|invocation|route|routed|routing)\b/i,
		signal: Signal.BroadWording,
		title: 'Broad "contextual" wording in agent artifact',
	},
	{
		kind: 'broad-every-request',
		pattern: /\bevery\s+(?:request|prompt|message|invocation|tool\s+call)\b/i,
		signal: Signal.BroadWording,
		title: 'Broad "every request" wording in agent artifact',
	},
];

const REMOTE_ENDPOINT_PATTERN =
	/["']?(?:url|endpoint|api[_-]?url|baseUrl|base_url|server[_-]?url)["']?\s*[:=]\s*"https?:\/\/[^"]+"|["']?(?:transport|type)["']?\s*[:=]\s*["'](?:sse|http|streamable[-_]?http)["']/i;

const RECOMMENDATION =
	'Prefer single-purpose tools with named, narrow scope. A generic gateway, ' +
	'marketplace, or "universal" toolbox concentrates trust on one operator who ' +
	'can pivot to any downstream capability without re-review. Replace generic ' +
	'gateway entries with explicit per-tool definitions, and avoid wording like ' +
	'"any tool", "all prompts", or "every request" that grants broad invocation ' +
	'authority.';

const IN_SCOPE: ReadonlySet<Artifact['type']> = new Set(['mcp-config', 'tool-manifest']);

type Match = LinePatternMatch<GatewayKind, PatternSpec>;

function buildFinding(artifact: Artifact, match: Match, hasRemoteEndpoint: boolean): Finding {
	const signals: string[] = [match.signal];
	if (hasRemoteEndpoint) signals.push(Signal.RemoteEndpoint);
	return {
		confidence: match.signal === Signal.Gateway ? 'medium' : 'low',
		evidence: `[${match.kind}] ${match.evidence}`,
		file: artifact.path,
		group: 'remote-capabilities',
		id: `agent.remote-generic-mcp-gateway:${artifact.path}:${match.kind}:${match.line}`,
		line: match.line,
		recommendation: RECOMMENDATION,
		ruleId: 'agent.remote-generic-mcp-gateway',
		score: computeScore(signals),
		severity: computeSeverity(signals),
		signals,
		source: artifact.source,
		title: match.title,
	};
}

export const remoteMcpGatewayRule: Rule = {
	description:
		'Flags MCP configs and tool manifests that describe themselves as generic ' +
		'gateways, marketplaces, "universal" toolboxes, or use broad-scope wording ' +
		'like "any tool" or "all prompts". When the same artifact also declares a ' +
		'remote endpoint, the finding escalates accordingly.',
	group: 'remote-capabilities',
	id: 'agent.remote-generic-mcp-gateway',
	async scan(ctx: RuleContext): Promise<Finding[]> {
		const findings: Finding[] = [];
		for (const artifact of ctx.artifacts) {
			if (!IN_SCOPE.has(artifact.type)) continue;
			const matches = findLinePatternMatches(artifact.content, PATTERNS);
			if (matches.length === 0) continue;
			const hasRemoteEndpoint = REMOTE_ENDPOINT_PATTERN.test(artifact.content);
			for (const match of matches) {
				findings.push(buildFinding(artifact, match, hasRemoteEndpoint));
			}
		}
		return findings;
	},
	title: 'Remote generic MCP gateway',
};
