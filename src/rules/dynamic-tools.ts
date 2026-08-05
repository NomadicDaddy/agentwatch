/**
 * Rule: agent.dynamic-tool-registry
 *
 * Detects dynamic tool discovery, registration, and registry patterns in
 * agent artifacts. Dynamic tool surfaces are dangerous because the set of
 * capabilities the agent can use can change after install — an operator can
 * push new tools without re-review.
 *
 * Scope: skill, mcp-config, tool-manifest, and agent-instruction artifacts.
 *
 * Score: each finding contributes the `dynamic-registry` signal (+30). When
 * paired with `remote-endpoint` plus `memory-request` or `local-execution`
 * the combination escalates to `critical` per the scoring engine.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';

import {
	findLinePatternMatches,
	type LinePatternMatch,
	type LinePatternSpec,
} from './line-patterns.ts';
import { computeScore, computeSeverity, Signal } from './scoring.ts';

type DynamicKind =
	| 'capabilities-endpoint'
	| 'discover-tools-wording'
	| 'dynamic-capabilities-wording'
	| 'list-tools-protocol'
	| 'plugin-registry-wording'
	| 'register-tool-api'
	| 'tool-registry-wording';

interface PatternSpec extends LinePatternSpec<DynamicKind> {
	readonly title: string;
}

const PATTERNS: readonly PatternSpec[] = [
	{
		kind: 'list-tools-protocol',
		pattern: /\b(?:tools\/list|list_tools|listTools)\b/,
		title: 'MCP tools/list discovery method referenced',
	},
	{
		kind: 'register-tool-api',
		pattern: /\b(?:register_tool|registerTool|register_plugin|registerPlugin)\b/,
		title: 'Dynamic tool/plugin registration API referenced',
	},
	{
		kind: 'tool-registry-wording',
		pattern: /\b(?:tool|remote)\s+registry\b/i,
		title: 'Tool registry wording in agent artifact',
	},
	{
		kind: 'discover-tools-wording',
		pattern: /\bdiscover(?:ing|ed|s)?\s+(?:new\s+)?(?:tools?|capabilities)\b/i,
		title: 'Tool discovery wording in agent artifact',
	},
	{
		kind: 'dynamic-capabilities-wording',
		pattern: /\bdynamic(?:ally)?\s+(?:tool|tools|capabilities|capability|plugin|plugins)\b/i,
		title: 'Dynamic capabilities wording in agent artifact',
	},
	{
		kind: 'capabilities-endpoint',
		pattern:
			/\bcapabilities\s+endpoint\b|"capabilities[_-]?(?:url|endpoint)"\s*:|\/capabilities\b/i,
		title: 'Remote capabilities endpoint declared',
	},
	{
		kind: 'plugin-registry-wording',
		pattern: /\bplugin\s+registry\b|\bplugin[_-]?registry\b/i,
		title: 'Plugin registry wording in agent artifact',
	},
];

const RECOMMENDATION =
	'Avoid dynamic tool registries unless you fully trust the operator and ' +
	'transport. A registry that can register, list, or discover tools after ' +
	'install lets the operator change the agent’s capability surface ' +
	'silently. Prefer a fixed, reviewed tool list and pin tool definitions in ' +
	'the agent configuration.';

const IN_SCOPE: ReadonlySet<Artifact['type']> = new Set([
	'skill',
	'mcp-config',
	'tool-manifest',
	'agent-instruction',
]);

type Match = LinePatternMatch<DynamicKind, PatternSpec>;

function buildFinding(artifact: Artifact, match: Match): Finding {
	const signals: readonly string[] = [Signal.DynamicRegistry];
	return {
		confidence: 'medium',
		evidence: `[${match.kind}] ${match.evidence}`,
		file: artifact.path,
		group: 'dynamic-tool-surfaces',
		id: `agent.dynamic-tool-registry:${artifact.path}:${match.kind}:${match.line}`,
		line: match.line,
		recommendation: RECOMMENDATION,
		ruleId: 'agent.dynamic-tool-registry',
		score: computeScore(signals),
		severity: computeSeverity(signals),
		signals,
		source: artifact.source,
		title: match.title,
	};
}

export const dynamicToolRegistryRule: Rule = {
	description:
		'Flags agent artifacts that advertise dynamic tool discovery, tool/plugin ' +
		'registration APIs, or remote tool registries — i.e. capability surfaces ' +
		'that can change after install.',
	group: 'dynamic-tool-surfaces',
	id: 'agent.dynamic-tool-registry',
	async scan(ctx: RuleContext): Promise<Finding[]> {
		const findings: Finding[] = [];
		for (const artifact of ctx.artifacts) {
			if (!IN_SCOPE.has(artifact.type)) continue;
			for (const match of findLinePatternMatches(artifact.content, PATTERNS)) {
				findings.push(buildFinding(artifact, match));
			}
		}
		return findings;
	},
	title: 'Dynamic tool registry',
};
