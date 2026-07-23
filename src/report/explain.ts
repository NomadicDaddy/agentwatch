/**
 * `agentwatch explain` implementation.
 *
 * Resolves either a rule id (`agent.remote-capability`) or a finding id
 * emitted by `scan` (`agent.remote-capability:/path:kind:42`) to a built-in
 * explanation describing what the rule detects, which signals it can emit,
 * how composite scoring drives severity, and concrete remediation steps.
 */

import type { FindingGroup, Severity } from '../rules/types.ts';

import { SIGNAL_SCORES } from '../rules/scoring.ts';

interface RuleExplanation {
	readonly group: FindingGroup;
	readonly remediation: readonly string[];
	readonly signals: readonly string[];
	readonly summary: string;
	readonly title: string;
}

const RULE_EXPLANATIONS: Readonly<Record<string, RuleExplanation>> = {
	'agent.broad-tool-surface': {
		group: 'dynamic-tool-surfaces',
		remediation: [
			'Replace broad wording with named, scoped capabilities.',
			'Document exactly what the skill is allowed to read, write, and call.',
		],
		signals: ['broad-wording'],
		summary:
			'A skill or manifest grants broad capability ("any tool", "all prompts", "universal", "execute any command"). Broad wording makes the surface impossible to audit and trivially escalates other findings.',
		title: 'Broad / unbounded tool surface',
	},
	'agent.connector-credential-reachability': {
		group: 'credential-reachability',
		remediation: [
			'Move secrets to a credential broker and pass scoped, short-lived tokens to the agent.',
			'Strip plaintext credential file paths and environment variables from manifests.',
		],
		signals: ['credential-reach'],
		summary:
			'A connector or skill references credentials, tokens, cookies, or browser session state in a way the agent can read. On compromise, blast radius extends to every account those credentials unlock.',
		title: 'Connector credential reachability',
	},
	'agent.credential-file-reference': {
		group: 'credential-reachability',
		remediation: [
			'Remove credential file paths from skill text and tool manifests.',
			'If access is required, use a credential broker — never read credential files directly.',
		],
		signals: ['credential-reach'],
		summary:
			'An artifact references a known credential file (`.env`, `credentials.json`, browser profile, AWS/GCP/SSH key paths). Reading these files via an agent capability leaks secrets.',
		title: 'Credential file referenced',
	},
	'agent.dynamic-tool-registry': {
		group: 'dynamic-tool-surfaces',
		remediation: [
			'Prefer static, declarative tool manifests over runtime registration.',
			'When dynamic loading is unavoidable, gate it behind explicit per-tool approval.',
		],
		signals: ['dynamic-registry', 'broad-wording'],
		summary:
			'The agent surface can register, discover, or load tools at runtime. Capabilities present at audit time may differ from capabilities active at run time, defeating static review.',
		title: 'Dynamic tool registry',
	},
	'agent.local-execution-bridge': {
		group: 'local-execution-bridges',
		remediation: [
			'Restrict shell access to a vetted allow-list of binaries and arguments.',
			'Remove `bash -c` / `sh -c` / `eval` patterns from skills and manifests.',
		],
		signals: ['local-execution', 'unpinned-execution'],
		summary:
			'The agent has a path to local command execution (shell, exec, spawn, eval). Combined with remote or dynamic surfaces this becomes a remote-code-execution risk.',
		title: 'Local execution bridge',
	},
	'agent.memory-context-request': {
		group: 'memory-context-exposure',
		remediation: [
			'Restrict memory access to skills that demonstrably need it.',
			'Audit downstream tool calls to ensure memory is not forwarded to remote endpoints.',
		],
		signals: ['memory-request'],
		summary:
			'A skill or instruction asks the agent to pull personal memory, history, profile, or saved context. This expands what flows into the prompt — and, transitively, into any remote capability the agent can reach.',
		title: 'Memory / personal-context request',
	},
	'agent.remote-capability': {
		group: 'remote-capabilities',
		remediation: [
			'Inventory every remote endpoint and confirm the operator is trusted.',
			'Pin transports and URLs; reject wildcards or environment-driven hosts.',
			'Strip gateway/proxy/router wording from manifests when the surface is local-only.',
		],
		signals: ['remote-endpoint', 'gateway'],
		summary:
			'A remote endpoint (MCP server, tool API, gateway/proxy/router) is reachable by the agent. Remote capabilities can receive prompts, files, or memory and are controlled by a third party that can change behavior without re-review.',
		title: 'Remote agent capability declared',
	},
	'agent.remote-generic-mcp-gateway': {
		group: 'remote-capabilities',
		remediation: [
			'Replace gateway servers with named, scoped MCP servers per capability.',
			'If a gateway is required, pin its allow-list and review changes on each update.',
		],
		signals: ['gateway', 'remote-endpoint', 'dynamic-registry'],
		summary:
			'An MCP server is configured as a generic gateway / aggregator for an unbounded set of downstream capabilities. The set of tools the agent can call may grow at runtime without operator notice.',
		title: 'Generic remote MCP gateway',
	},
	'agent.remote-manifest': {
		group: 'remote-capabilities',
		remediation: [
			'Pin the manifest locally or replace remote URLs with checked-in files.',
			'If a remote manifest is required, lock the host and audit each update.',
			'Combine with dynamic-tool-registry detection — remote manifests amplify dynamic surfaces.',
		],
		signals: ['remote-endpoint'],
		summary:
			'An MCP config or tool manifest references a remote manifest, update URL, plugins manifest, or hosted tool list. The publisher can change the agent’s capability set after install — without re-review — by editing the remote manifest.',
		title: 'Remote manifest reference',
	},
	'agent.trigger-based-invocation': {
		group: 'dynamic-tool-surfaces',
		remediation: [
			'Remove triggers that fire without a user-visible action.',
			'For required triggers, log every invocation and surface them in the UI.',
		],
		signals: ['trigger-invocation'],
		summary:
			'The skill or manifest declares triggers (keywords, file events, schedule) that auto-invoke the agent without an explicit user prompt. Triggers move the agent from "user-driven" to "background" and broaden the threat model.',
		title: 'Trigger-based invocation',
	},
	'agent.unpinned-execution-bridge': {
		group: 'local-execution-bridges',
		remediation: [
			'Pin launcher targets to an exact version, such as `npx pkg@1.2.3`.',
			'Review and deliberately update each pinned version instead of resolving the latest release at run time.',
		],
		signals: ['unpinned-execution'],
		summary:
			'An MCP config or tool manifest launches a package through npx, bunx, uvx, or pipx without an exact version. The resolved package can change between runs without review.',
		title: 'Unpinned execution bridge',
	},
	'agent.untrusted-install-source': {
		group: 'untrusted-provenance',
		remediation: [
			'Resolve URL shorteners to their final host before approving an install.',
			'Require a named publisher and a checked-in version for every agent surface.',
			'Strip ad/marketing/referral query parameters and fetch from the project’s canonical domain.',
			'Reject manifests where source and API hosts disagree unless the relationship is explicitly documented.',
		],
		signals: ['url-shortener', 'ad-marketing'],
		summary:
			'Provenance or install metadata is hard to audit: URL shorteners on install URLs hide the real host, ad/marketing/referral parameters route users through trackers instead of the canonical project, missing publisher or version fields prevent identity and pinning, and source/API host mismatches indicate the declared origin and the runtime endpoint disagree.',
		title: 'Untrusted install source',
	},
};

const META_EXPLANATIONS: Readonly<Record<string, { body: string; title: string }>> = {
	cli: {
		body: 'AgentWatch ships five commands: scan, inspect-skill, inspect-mcp, probe, and explain. Run `agentwatch --help` for usage. Pass `--json` to scan for machine-readable output.',
		title: 'AgentWatch CLI',
	},
	scoring: {
		body: 'Each rule emits one or more signals. Signal points sum to a composite score; severity is info (0-29), low (30-59), medium (60-89), high (90-119), critical (120+). Three combinations auto-escalate to critical regardless of the numeric total: remote-endpoint + dynamic-registry + memory-request, remote-endpoint + dynamic-registry + local-execution, and remote-endpoint + credential-reach.',
		title: 'Composite scoring',
	},
};

const SEVERITY_THRESHOLDS: readonly (readonly [Severity, number])[] = [
	['info', 0],
	['low', 30],
	['medium', 60],
	['high', 90],
	['critical', 120],
];

/** Extract a rule id from a finding id (`<ruleId>:<path>:<kind>:<line>`). */
function extractRuleId(input: string): string {
	if (!input.startsWith('agent.')) return input;
	const colon = input.indexOf(':');
	return colon === -1 ? input : input.slice(0, colon);
}

function renderRule(ruleId: string, entry: RuleExplanation, lines: string[]): void {
	lines.push(entry.title);
	lines.push('-'.repeat(entry.title.length));
	lines.push(`Rule:  ${ruleId}`);
	lines.push(`Group: ${entry.group}`);
	lines.push('');
	lines.push('What this means');
	lines.push(entry.summary);
	lines.push('');

	lines.push('Signals this rule can emit');
	if (entry.signals.length === 0) {
		lines.push('  (none)');
	} else {
		for (const signal of entry.signals) {
			const score = SIGNAL_SCORES[signal as keyof typeof SIGNAL_SCORES] ?? 0;
			lines.push(`  - ${signal} (+${score})`);
		}
	}
	lines.push('');

	lines.push('Severity classification');
	const bands = SEVERITY_THRESHOLDS.map(([sev, min]) => `${sev}≥${min}`).join(', ');
	lines.push(`  Composite score → severity bands: ${bands}.`);
	lines.push(
		'  Auto-critical when signals include: remote-endpoint+dynamic-registry+memory-request, remote-endpoint+dynamic-registry+local-execution, or remote-endpoint+credential-reach.'
	);
	lines.push('');

	lines.push('Remediation');
	for (const step of entry.remediation) {
		lines.push(`  - ${step}`);
	}
}

function listKnownIds(): readonly string[] {
	return [...Object.keys(META_EXPLANATIONS), ...Object.keys(RULE_EXPLANATIONS)].sort();
}

export function runExplain(findingId: string): number {
	const raw = findingId.trim();
	if (raw.length === 0) {
		process.stderr.write('explain: empty id. Pass a rule id or finding id.\n');
		return 1;
	}

	const meta = META_EXPLANATIONS[raw];
	if (meta !== undefined) {
		const out = process.stdout;
		out.write(`${meta.title}\n`);
		out.write(`${'-'.repeat(meta.title.length)}\n`);
		out.write(`${meta.body}\n`);
		return 0;
	}

	const ruleId = extractRuleId(raw);
	const entry = RULE_EXPLANATIONS[ruleId];
	if (entry === undefined) {
		process.stderr.write(`explain: no explanation registered for id '${raw}'.\n`);
		process.stderr.write('Available ids:\n');
		for (const known of listKnownIds()) {
			process.stderr.write(`  - ${known}\n`);
		}
		return 1;
	}

	const lines: string[] = [];
	if (raw !== ruleId) {
		lines.push(`Finding id: ${raw}`);
		lines.push('');
	}
	renderRule(ruleId, entry, lines);
	process.stdout.write(`${lines.join('\n')}\n`);
	return 0;
}
