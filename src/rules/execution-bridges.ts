/**
 * Rule: agent.local-execution-bridge
 *
 * Detects local execution bridges declared by agent MCP configs and tool
 * manifests — i.e. command fields that spawn an interpreter (npx, bunx, uvx,
 * node, python, pwsh, powershell, bash, sh), reference a local binary path,
 * or wire a stdio MCP server. These are not automatically malicious; they
 * just mean the agent can launch local code, and that code path deserves
 * review for pinning and publisher trust.
 *
 * Scope: mcp-config and tool-manifest artifacts.
 *
 * Score: each finding contributes the `local-execution` signal (+25). When
 * paired with `remote-endpoint` plus `dynamic-registry` the combination
 * escalates to `critical` per the scoring engine.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';

import { computeScore, computeSeverity, Signal } from './scoring.ts';

type BridgeKind =
	| 'bunx-command'
	| 'local-binary'
	| 'node-command'
	| 'npx-command'
	| 'powershell-command'
	| 'python-command'
	| 'shell-command'
	| 'stdio-server'
	| 'uvx-command';

interface PatternSpec {
	readonly kind: BridgeKind;
	readonly pattern: RegExp;
	readonly title: string;
}

const PATTERNS: readonly PatternSpec[] = [
	{
		kind: 'npx-command',
		pattern: /"command"\s*:\s*"(?:[^"]*[\\/])?npx(?:\.(?:cmd|exe))?"/i,
		title: 'MCP/tool command launches via npx',
	},
	{
		kind: 'bunx-command',
		pattern: /"command"\s*:\s*"(?:[^"]*[\\/])?bunx(?:\.(?:cmd|exe))?"/i,
		title: 'MCP/tool command launches via bunx',
	},
	{
		kind: 'uvx-command',
		pattern: /"command"\s*:\s*"(?:[^"]*[\\/])?uvx(?:\.(?:cmd|exe))?"/i,
		title: 'MCP/tool command launches via uvx',
	},
	{
		kind: 'node-command',
		pattern: /"command"\s*:\s*"(?:[^"]*[\\/])?node(?:\.exe)?"/i,
		title: 'MCP/tool command launches a node interpreter',
	},
	{
		kind: 'python-command',
		pattern: /"command"\s*:\s*"(?:[^"]*[\\/])?python(?:3(?:\.\d+)?)?(?:\.exe)?"/i,
		title: 'MCP/tool command launches a python interpreter',
	},
	{
		kind: 'powershell-command',
		pattern: /"command"\s*:\s*"(?:[^"]*[\\/])?(?:pwsh|powershell)(?:\.exe)?"/i,
		title: 'MCP/tool command launches a PowerShell interpreter',
	},
	{
		kind: 'shell-command',
		pattern: /"command"\s*:\s*"(?:[^"]*[\\/])?(?:bash|sh|zsh|dash)(?:\.exe)?"/i,
		title: 'MCP/tool command launches a POSIX shell',
	},
	{
		kind: 'local-binary',
		pattern: /"command"\s*:\s*"(?:[a-zA-Z]:[\\/]|\/|~[\\/]|\.{1,2}[\\/])[^"]+"/,
		title: 'MCP/tool command references a local binary path',
	},
	{
		kind: 'stdio-server',
		pattern: /"(?:type|transport)"\s*:\s*"stdio"/i,
		title: 'MCP server declared with stdio transport',
	},
];

const RECOMMENDATION =
	'Local execution bridges are not inherently malicious, but they let the ' +
	'agent spawn local code with the user’s privileges. Pin package versions ' +
	'(avoid bare `npx <pkg>` / `uvx <pkg>` without a version), verify the ' +
	'publisher of every command target, and confirm the binary or script is ' +
	'one you actually intended to expose to the agent.';

const IN_SCOPE: ReadonlySet<Artifact['type']> = new Set(['mcp-config', 'tool-manifest']);

interface Match {
	readonly evidence: string;
	readonly kind: BridgeKind;
	readonly line: number;
	readonly title: string;
}

function findMatches(content: string): Match[] {
	const seen = new Set<BridgeKind>();
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
	const signals: readonly string[] = [Signal.LocalExecution];
	return {
		confidence: 'medium',
		evidence: `[${match.kind}] ${match.evidence}`,
		file: artifact.path,
		group: 'local-execution-bridges',
		id: `agent.local-execution-bridge:${artifact.path}:${match.kind}:${match.line}`,
		line: match.line,
		recommendation: RECOMMENDATION,
		ruleId: 'agent.local-execution-bridge',
		score: computeScore(signals),
		severity: computeSeverity(signals),
		signals,
		source: artifact.source,
		title: match.title,
	};
}

export const localExecutionBridgeRule: Rule = {
	description:
		'Flags agent MCP configs and tool manifests that launch local interpreters ' +
		'(npx, bunx, uvx, node, python, pwsh, bash), reference local binaries, or ' +
		'declare stdio MCP servers — i.e. capability surfaces that execute code on ' +
		'the user’s machine.',
	group: 'local-execution-bridges',
	id: 'agent.local-execution-bridge',
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
	title: 'Local execution bridge',
};
