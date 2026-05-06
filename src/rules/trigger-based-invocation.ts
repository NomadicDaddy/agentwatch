/**
 * Rule: agent.trigger-based-invocation
 *
 * Detects prompt-triggered automatic tool invocation patterns in skills,
 * agent instructions, and MCP configs. Wording such as "always use this
 * tool", "when the user asks", "on every prompt", or other auto-routing
 * directives indicates that the artifact will pull a tool into the model's
 * context unprompted, expanding the dynamic capability surface.
 *
 * Scope: skill, agent-instruction, and mcp-config artifacts.
 *
 * Score: each finding contributes the `trigger-invocation` signal (+25).
 * Combined with `remote-endpoint` upstream, the composite score escalates
 * the finding into the medium/high band per the scoring engine.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';

import { computeScore, computeSeverity, Signal } from './scoring.ts';

type TriggerKind =
	| 'always-use'
	| 'auto-invoke'
	| 'auto-route'
	| 'on-every-prompt'
	| 'when-user-asks'
	| 'whenever-mention';

interface PatternSpec {
	readonly kind: TriggerKind;
	readonly pattern: RegExp;
	readonly title: string;
}

const PATTERNS: readonly PatternSpec[] = [
	{
		kind: 'always-use',
		pattern:
			/\balways\s+(?:use|invoke|call|prefer|reach\s+for|route\s+to)\s+(?:this|the|that)\s+(?:tool|server|skill|mcp|plugin|agent)\b/i,
		title: 'Instruction always invokes a tool',
	},
	{
		kind: 'on-every-prompt',
		pattern:
			/\bon\s+every\s+(?:prompt|request|message|turn|query)\b|\bfor\s+every\s+(?:prompt|request|message|turn|query)\b|\beach\s+(?:prompt|request|message|turn|query)\b/i,
		title: 'Instruction triggers on every prompt',
	},
	{
		kind: 'when-user-asks',
		pattern:
			/\bwhen\s+(?:the\s+)?user\s+(?:asks?|requests?|mentions?|says?|wants?|needs?)\b|\bif\s+(?:the\s+)?user\s+(?:asks?|requests?|mentions?|says?)\b/i,
		title: 'Instruction triggers on user prompt content',
	},
	{
		kind: 'auto-invoke',
		pattern:
			/\bauto(?:matically)?[-\s]?(?:invoke|call|use|run|execute|trigger|engage)\b|\bauto[-\s]?(?:invocation|trigger|routing)\b/i,
		title: 'Instruction declares automatic tool invocation',
	},
	{
		kind: 'auto-route',
		pattern:
			/\b(?:route|forward|delegate|dispatch)\s+(?:all|every|the|user)\s+(?:prompts?|requests?|messages?|queries|questions)\b|\bprompt\s+routing\b/i,
		title: 'Instruction auto-routes prompts to a tool',
	},
	{
		kind: 'whenever-mention',
		pattern:
			/\bwhenever\s+(?:the\s+)?user\s+(?:mentions?|asks?|says?|requests?)\b|\bwhenever\s+(?:a\s+)?(?:prompt|message|request)\b/i,
		title: 'Instruction triggers whenever user mentions a topic',
	},
];

const RECOMMENDATION =
	'Review automatic tool triggers. Skills, instructions, and MCP configs ' +
	'that auto-invoke a tool — "always use", "on every prompt", "when the ' +
	'user asks…" — expand the dynamic capability surface and pull tools into ' +
	'context without explicit user request. Prefer explicit, user-initiated ' +
	'invocation and remove blanket triggers from untrusted sources.';

const IN_SCOPE: ReadonlySet<Artifact['type']> = new Set([
	'skill',
	'agent-instruction',
	'mcp-config',
]);

interface Match {
	readonly evidence: string;
	readonly kind: TriggerKind;
	readonly line: number;
	readonly title: string;
}

function findMatches(content: string): Match[] {
	const seen = new Set<TriggerKind>();
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
	const signals: readonly string[] = [Signal.TriggerInvocation];
	return {
		confidence: 'medium',
		evidence: `[${match.kind}] ${match.evidence}`,
		file: artifact.path,
		group: 'dynamic-tool-surfaces',
		id: `agent.trigger-based-invocation:${artifact.path}:${match.kind}:${match.line}`,
		line: match.line,
		recommendation: RECOMMENDATION,
		ruleId: 'agent.trigger-based-invocation',
		score: computeScore(signals),
		severity: computeSeverity(signals),
		signals,
		source: artifact.source,
		title: match.title,
	};
}

export const triggerBasedInvocationRule: Rule = {
	description:
		'Flags skill, agent-instruction, and mcp-config artifacts that direct ' +
		'the agent to auto-invoke a tool based on prompt content — "always use", ' +
		'"on every prompt", "when the user asks", auto-routing, etc. These ' +
		'patterns expand the dynamic capability surface unprompted.',
	group: 'dynamic-tool-surfaces',
	id: 'agent.trigger-based-invocation',
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
	title: 'Trigger-based automatic tool invocation',
};
