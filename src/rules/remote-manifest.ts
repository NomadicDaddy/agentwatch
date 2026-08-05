/**
 * Rule: agent.remote-manifest
 *
 * Detects remote manifest references in MCP configs and tool manifests —
 * fields that point at a remote URL describing what tools, plugins, or
 * capabilities the agent should load. A remote manifest lets the operator
 * change the agent's capability surface after install without re-review.
 *
 * Scope: mcp-config and tool-manifest artifacts.
 *
 * Score: each finding contributes the `remote-endpoint` signal (+35),
 * matching spec.md's "Score +35 for remote manifest reference (adds to
 * remote capability scoring)". Combined with `dynamic-registry` plus
 * `memory-request` or `local-execution` the finding escalates to
 * `critical` per the scoring engine.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';

import {
	findLinePatternMatches,
	type LinePatternMatch,
	type LinePatternSpec,
} from './line-patterns.ts';
import { computeScore, computeSeverity, Signal } from './scoring.ts';

type ManifestKind =
	| 'config-url'
	| 'hosted-tool-list-wording'
	| 'manifest-url'
	| 'plugins-url'
	| 'remote-plugin-registry'
	| 'tools-url'
	| 'update-url';

interface PatternSpec extends LinePatternSpec<ManifestKind> {
	readonly title: string;
}

const PATTERNS: readonly PatternSpec[] = [
	{
		kind: 'manifest-url',
		pattern: /["']?manifest(?:[_-]?url)?["']?\s*[:=]\s*"https?:\/\/[^"]+"/i,
		title: 'Remote manifest URL declared',
	},
	{
		kind: 'update-url',
		pattern: /["']?update[_-]?url["']?\s*[:=]\s*"https?:\/\/[^"]+"/i,
		title: 'Remote update URL declared',
	},
	{
		kind: 'config-url',
		pattern: /["']?config[_-]?url["']?\s*[:=]\s*"https?:\/\/[^"]+"/i,
		title: 'Remote config URL declared',
	},
	{
		kind: 'plugins-url',
		pattern: /["']?plugins?[_-]?(?:url|manifest)["']?\s*[:=]\s*"https?:\/\/[^"]+"/i,
		title: 'Remote plugins manifest URL declared',
	},
	{
		kind: 'tools-url',
		pattern: /["']?tools?[_-]?(?:url|manifest|list)["']?\s*[:=]\s*"https?:\/\/[^"]+"/i,
		title: 'Remote tools manifest URL declared',
	},
	{
		kind: 'remote-plugin-registry',
		pattern: /\bremote\s+(?:plugin|tool)\s+registry\b|\bhosted\s+(?:plugin|tool)\s+registry\b/i,
		title: 'Remote plugin registry referenced',
	},
	{
		kind: 'hosted-tool-list-wording',
		pattern:
			/\bhosted\s+(?:tool|plugin)\s+list\b|\bremote\s+(?:tool|plugin)\s+list\b|\bfetch(?:es|ed|ing)?\s+(?:the\s+)?(?:tool|plugin|capability)\s+(?:list|manifest)\b/i,
		title: 'Hosted tool/plugin list wording in agent artifact',
	},
];

const RECOMMENDATION =
	'Pin the manifest locally or verify the operator and transport. A remote ' +
	'manifest lets the publisher change the agent’s capability list, plugin ' +
	'set, or update URL after install — without re-review. Prefer a checked-' +
	'in, version-pinned manifest from a trusted publisher; if a remote ' +
	'manifest is required, lock the host, audit each update, and treat the ' +
	'manifest as untrusted input.';

const IN_SCOPE: ReadonlySet<Artifact['type']> = new Set(['mcp-config', 'tool-manifest']);

type Match = LinePatternMatch<ManifestKind, PatternSpec>;

function buildFinding(artifact: Artifact, match: Match): Finding {
	const signals: readonly string[] = [Signal.RemoteEndpoint];
	return {
		confidence: match.kind === 'hosted-tool-list-wording' ? 'medium' : 'high',
		evidence: `[${match.kind}] ${match.evidence}`,
		file: artifact.path,
		group: 'remote-capabilities',
		id: `agent.remote-manifest:${artifact.path}:${match.kind}:${match.line}`,
		line: match.line,
		recommendation: RECOMMENDATION,
		ruleId: 'agent.remote-manifest',
		score: computeScore(signals),
		severity: computeSeverity(signals),
		signals,
		source: artifact.source,
		title: match.title,
	};
}

export const remoteManifestRule: Rule = {
	description:
		'Flags MCP configs and tool manifests that reference a remote manifest, ' +
		'update URL, or hosted plugin/tool list — capability descriptions that ' +
		'live off-machine and let the operator change what the agent loads ' +
		'after install.',
	group: 'remote-capabilities',
	id: 'agent.remote-manifest',
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
	title: 'Remote manifest',
};
