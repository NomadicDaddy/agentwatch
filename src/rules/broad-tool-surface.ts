/**
 * Rule: agent.broad-tool-surface
 *
 * Detects broad capability wording in skills, MCP configs, tool manifests,
 * and agent instructions. Phrases like "any tool", "all prompts",
 * "universal", "execute any command", or "full system access" describe a
 * capability surface that is intentionally unbounded — a strong signal
 * that the artifact will not constrain what the agent can do.
 *
 * Scope: skill, mcp-config, tool-manifest, and agent-instruction artifacts.
 *
 * Score: each finding contributes the `broad-wording` signal (+15). When
 * paired with `remote-endpoint` or `dynamic-registry` upstream, the
 * composite score escalates the finding into the medium/high band.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';

import { computeScore, computeSeverity, Signal } from './scoring.ts';

type BroadKind =
	| 'all-prompts'
	| 'any-tool'
	| 'contextual-toolbox'
	| 'execute-any-command'
	| 'full-system-access'
	| 'universal'
	| 'unlimited';

interface PatternSpec {
	readonly kind: BroadKind;
	readonly pattern: RegExp;
	readonly title: string;
}

const PATTERNS: readonly PatternSpec[] = [
	{
		kind: 'any-tool',
		pattern: /\b(?:any|every)\s+tool\b/i,
		title: 'Broad wording: "any tool"',
	},
	{
		kind: 'all-prompts',
		pattern: /\ball\s+(?:prompts?|requests?|messages?|queries|questions)\b/i,
		title: 'Broad wording: "all prompts"',
	},
	{
		kind: 'universal',
		pattern: /\buniversal\s+(?:tool|tools|skill|agent|access|capability|capabilities)\b/i,
		title: 'Broad wording: "universal" capability',
	},
	{
		kind: 'contextual-toolbox',
		pattern:
			/\bcontextual\s+(?:tool|tools|skill|agent)\b|\b(?:agent|tool)\s+toolbox\b|\btoolbox\b/i,
		title: 'Broad wording: "contextual" / "toolbox"',
	},
	{
		kind: 'execute-any-command',
		pattern:
			/\bexecute\s+any\s+(?:command|tool|action|script)\b|\brun\s+any\s+(?:command|tool|script)\b/i,
		title: 'Broad wording: "execute any command"',
	},
	{
		kind: 'full-system-access',
		pattern:
			/\bfull\s+(?:system|machine|host|filesystem|file\s+system)\s+access\b|\bunrestricted\s+(?:access|tool|tools)\b/i,
		title: 'Broad wording: "full system access"',
	},
	{
		kind: 'unlimited',
		pattern:
			/\bunlimited\s+(?:tool|tools|access|capability|capabilities|commands?)\b|\bno\s+(?:limits?|restrictions?)\b/i,
		title: 'Broad wording: "unlimited" capability',
	},
];

const RECOMMENDATION =
	'Prefer narrowly scoped tool descriptions. Wording like "any tool", "all ' +
	'prompts", "universal", "execute any command", or "full system access" ' +
	'tells the agent (and the user reviewing it) that the capability surface ' +
	'is intentionally unbounded. Replace broad phrases with the specific set ' +
	'of inputs, outputs, and side effects the tool actually needs.';

const IN_SCOPE: ReadonlySet<Artifact['type']> = new Set([
	'skill',
	'mcp-config',
	'tool-manifest',
	'agent-instruction',
]);

interface Match {
	readonly evidence: string;
	readonly kind: BroadKind;
	readonly line: number;
	readonly title: string;
}

function findMatches(content: string): Match[] {
	const seen = new Set<BroadKind>();
	const matches: Match[] = [];
	const lines = content.split(/\r?\n/);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		for (const spec of PATTERNS) {
			if (seen.has(spec.kind)) continue;
			if (spec.pattern.test(line)) {
				seen.add(spec.kind);
				matches.push({
					evidence: line.trim().slice(0, 240),
					kind: spec.kind,
					line: i + 1,
					title: spec.title,
				});
			}
		}
	}

	return matches;
}

function buildFinding(artifact: Artifact, match: Match): Finding {
	const signals: readonly string[] = [Signal.BroadWording];
	return {
		confidence: 'low',
		evidence: `[${match.kind}] ${match.evidence}`,
		file: artifact.path,
		group: 'dynamic-tool-surfaces',
		id: `agent.broad-tool-surface:${artifact.path}:${match.kind}:${match.line}`,
		line: match.line,
		recommendation: RECOMMENDATION,
		ruleId: 'agent.broad-tool-surface',
		score: computeScore(signals),
		severity: computeSeverity(signals),
		signals,
		source: artifact.source,
		title: match.title,
	};
}

export const broadToolSurfaceRule: Rule = {
	description:
		'Flags skill, mcp-config, tool-manifest, and agent-instruction artifacts ' +
		'whose capability descriptions use intentionally unbounded wording — ' +
		'"any tool", "all prompts", "universal", "execute any command", "full ' +
		'system access", "unlimited". Such wording is a strong indicator the ' +
		'artifact will not constrain agent behavior.',
	group: 'dynamic-tool-surfaces',
	id: 'agent.broad-tool-surface',
	async scan(ctx: RuleContext): Promise<Finding[]> {
		const findings: Finding[] = [];
		for (const artifact of ctx.artifacts) {
			if (!IN_SCOPE.has(artifact.type)) continue;
			for (const match of findMatches(artifact.content)) {
				findings.push(buildFinding(artifact, match));
			}
		}
		return findings;
	},
	title: 'Broad tool surface wording',
};
