/**
 * `agentwatch probe` implementation: probes a remote MCP server for its
 * declared tool / prompt / resource surface and renders the result, plus
 * heuristic findings, in human-readable or JSON form.
 *
 * This is the only place agentwatch contacts the network. The user opts
 * in by running the subcommand and passing the URL explicitly.
 *
 * Exit codes: 0 = no probe issues at or above medium, 1 = issues at or
 * above medium (or all probe stages errored), 2 = invalid argument.
 */

import type { ProbeIssue } from '../probe/analyze.ts';
import type { ProbeOptions, ProbeResult } from '../probe/probe.ts';
import type { Severity } from '../rules/types.ts';

import { analyzeProbe } from '../probe/analyze.ts';
import { probeMcp } from '../probe/probe.ts';
import { maskSecrets } from '../util/mask.ts';
import { PACKAGE_VERSION } from '../version.ts';

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
	critical: 4,
	high: 3,
	info: 0,
	low: 1,
	medium: 2,
};
const DEFAULT_THRESHOLD: Severity = 'medium';
const MAX_EVIDENCE_LEN = 240;
const SENSITIVE_FIELD_NAME =
	/(?:token|secret|password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|auth)/i;

export interface RunProbeOptions {
	readonly authToken?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly json: boolean;
	readonly timeoutMs?: number;
}

export async function runProbe(url: string, options: RunProbeOptions): Promise<number> {
	if (!/^https?:\/\//i.test(url)) {
		process.stderr.write('probe: URL must start with http:// or https://\n');
		return 2;
	}

	const probeOptions: ProbeOptions = {
		url,
		...(options.authToken !== undefined ? { authToken: options.authToken } : {}),
		...(options.headers !== undefined ? { headers: options.headers } : {}),
		...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
	};

	const result = await probeMcp(probeOptions);
	const issues = analyzeProbe(result);
	const maskedResult = maskProbeResult(result);
	const maskedIssues = maskProbeIssues(issues);

	const out = options.json
		? formatProbeJson(maskedResult, maskedIssues)
		: formatProbeHuman(maskedResult, maskedIssues);
	process.stdout.write(out);

	const blocked = result.errors.length > 0 && result.tools.length === 0;
	if (blocked) return 1;
	const minRank = SEVERITY_RANK[DEFAULT_THRESHOLD];
	return issues.some((i) => SEVERITY_RANK[i.severity] >= minRank) ? 1 : 0;
}

function maskProbeIssues(issues: readonly ProbeIssue[]): readonly ProbeIssue[] {
	return issues.map((issue) => ({
		...issue,
		evidence: maskSecrets(issue.evidence),
		title: maskSecrets(issue.title),
	}));
}

function maskProbeResult(result: ProbeResult): ProbeResult {
	return {
		...result,
		errors: result.errors.map((error) => ({ ...error, message: maskSecrets(error.message) })),
		prompts: result.prompts.map((prompt) => ({
			...prompt,
			...(prompt.description !== undefined
				? { description: maskSecrets(prompt.description) }
				: {}),
			name: maskSecrets(prompt.name),
		})),
		resources: result.resources.map((resource) => ({
			...resource,
			...(resource.description !== undefined
				? { description: maskSecrets(resource.description) }
				: {}),
			...(resource.name !== undefined ? { name: maskSecrets(resource.name) } : {}),
			uri: maskSecrets(resource.uri),
		})),
		tools: result.tools.map((tool) => ({
			...tool,
			...(tool.description !== undefined
				? { description: maskSecrets(tool.description) }
				: {}),
			...(tool.inputSchema !== undefined
				? { inputSchema: maskProbeValue(tool.inputSchema) }
				: {}),
			name: maskSecrets(tool.name),
		})),
		url: maskSecrets(result.url),
		...(result.capabilities !== undefined
			? { capabilities: maskProbeRecord(result.capabilities) }
			: {}),
		...(result.protocolVersion !== undefined
			? { protocolVersion: maskSecrets(result.protocolVersion) }
			: {}),
		...(result.serverInfo !== undefined
			? {
					serverInfo: {
						name: maskSecrets(result.serverInfo.name),
						version: maskSecrets(result.serverInfo.version),
					},
				}
			: {}),
	};
}

function maskProbeRecord(
	value: Readonly<Record<string, unknown>>,
	inheritedSensitive: boolean = false
): Readonly<Record<string, unknown>> {
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [
			key,
			maskProbeValue(entry, inheritedSensitive || SENSITIVE_FIELD_NAME.test(key)),
		])
	);
}

function maskProbeValue(value: unknown, sensitive: boolean = false): unknown {
	if (typeof value === 'string') {
		if (!sensitive) return maskSecrets(value);
		return maskSecrets(`token=${value}`).slice('token='.length);
	}
	if (Array.isArray(value)) return value.map((entry) => maskProbeValue(entry, sensitive));
	if (value !== null && typeof value === 'object') {
		return maskProbeRecord(value as Readonly<Record<string, unknown>>, sensitive);
	}
	return value;
}

function truncate(s: string, n: number): string {
	return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function padSeverity(severity: Severity): string {
	return severity.toUpperCase().padEnd('CRITICAL'.length, ' ');
}

function formatProbeHuman(result: ProbeResult, issues: readonly ProbeIssue[]): string {
	const lines: string[] = [];
	lines.push(`AgentWatch probe (v${PACKAGE_VERSION})`);
	lines.push(`URL:        ${result.url}`);
	lines.push(`Probed at:  ${result.probedAt}`);
	if (result.serverInfo) {
		lines.push(`Server:     ${result.serverInfo.name} ${result.serverInfo.version}`);
	} else {
		lines.push('Server:     (unknown)');
	}
	if (result.protocolVersion) lines.push(`Protocol:   ${result.protocolVersion}`);
	lines.push('');

	if (result.errors.length > 0) {
		lines.push('Errors');
		lines.push('------');
		for (const err of result.errors) {
			lines.push(`  [${err.stage}] ${err.message}`);
		}
		lines.push('');
	}

	lines.push(`Tools (${result.tools.length})`);
	lines.push('-----');
	if (result.tools.length === 0) {
		lines.push('  (none reported)');
	} else {
		for (const tool of result.tools) {
			lines.push(`  - ${tool.name}`);
			if (tool.description) {
				lines.push(`      ${truncate(tool.description, 200)}`);
			}
		}
	}
	lines.push('');

	if (result.prompts.length > 0) {
		lines.push(`Prompts (${result.prompts.length})`);
		lines.push('-------');
		for (const p of result.prompts) {
			const desc = p.description ? ` — ${truncate(p.description, 120)}` : '';
			lines.push(`  - ${p.name}${desc}`);
		}
		lines.push('');
	}

	if (result.resources.length > 0) {
		lines.push(`Resources (${result.resources.length})`);
		lines.push('---------');
		for (const r of result.resources) {
			const label = r.name ? ` (${r.name})` : '';
			lines.push(`  - ${r.uri}${label}`);
		}
		lines.push('');
	}

	lines.push('Probe Findings');
	lines.push('--------------');
	if (issues.length === 0) {
		lines.push('  No heuristic issues detected.');
	} else {
		for (const issue of issues) {
			lines.push(`  [${padSeverity(issue.severity)}] ${issue.title}`);
			lines.push(`      ${truncate(issue.evidence, MAX_EVIDENCE_LEN)}`);
		}
	}
	lines.push('');

	return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

function formatProbeJson(result: ProbeResult, issues: readonly ProbeIssue[]): string {
	const payload = {
		issues,
		probe: result,
		probedAt: result.probedAt,
		version: PACKAGE_VERSION,
	};
	return `${JSON.stringify(payload, null, 2)}\n`;
}
