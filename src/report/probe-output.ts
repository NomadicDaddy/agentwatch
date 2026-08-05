import type { ProbeIssue } from '../probe/analyze.ts';
import type { ProbeResult } from '../probe/probe.ts';
import type { Severity } from '../rules/types.ts';

import { maskSecrets } from '../util/mask.ts';
import { PACKAGE_VERSION } from '../version.ts';

const MAX_EVIDENCE_LEN = 240;
const REDACTED_NON_STRING = '[redacted]';
const SENSITIVE_FIELD_NAME =
	/(?:token|secret|password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|auth)/i;

function formatProbeHuman(result: ProbeResult, issues: readonly ProbeIssue[]): string {
	const lines: string[] = [];
	lines.push(`AgentWatch probe (v${PACKAGE_VERSION})`);
	lines.push(`URL:        ${result.url}`);
	lines.push(`Probed at:  ${result.probedAt}`);
	lines.push(
		result.serverInfo
			? `Server:     ${result.serverInfo.name} ${result.serverInfo.version}`
			: 'Server:     (unknown)'
	);
	if (result.protocolVersion) lines.push(`Protocol:   ${result.protocolVersion}`);
	lines.push('');

	if (result.errors.length > 0) {
		lines.push('Errors', '------');
		for (const error of result.errors) lines.push(`  [${error.stage}] ${error.message}`);
		lines.push('');
	}

	lines.push(`Tools (${result.tools.length})`, '-----');
	if (result.tools.length === 0) {
		lines.push('  (none reported)');
	} else {
		for (const tool of result.tools) {
			lines.push(`  - ${tool.name}`);
			if (tool.description) lines.push(`      ${truncate(tool.description, 200)}`);
		}
	}
	lines.push('');

	if (result.prompts.length > 0) {
		lines.push(`Prompts (${result.prompts.length})`, '-------');
		for (const prompt of result.prompts) {
			const description = prompt.description ? ` — ${truncate(prompt.description, 120)}` : '';
			lines.push(`  - ${prompt.name}${description}`);
		}
		lines.push('');
	}

	if (result.resources.length > 0) {
		lines.push(`Resources (${result.resources.length})`, '---------');
		for (const resource of result.resources) {
			const label = resource.name ? ` (${resource.name})` : '';
			lines.push(`  - ${resource.uri}${label}`);
		}
		lines.push('');
	}

	lines.push('Probe Findings', '--------------');
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
	return `${JSON.stringify(
		{ issues, probe: result, probedAt: result.probedAt, version: PACKAGE_VERSION },
		null,
		2
	)}\n`;
}

function maskProbeIssues(issues: readonly ProbeIssue[]): readonly ProbeIssue[] {
	return issues.map((issue) => ({
		...issue,
		evidence: maskSecrets(issue.evidence),
		title: maskSecrets(issue.title),
	}));
}

function maskProbeRecord(
	value: Readonly<Record<string, unknown>>,
	inheritedSensitive: boolean = false
): Readonly<Record<string, unknown>> {
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => {
			const maskedKey = maskSecrets(key);
			return [
				maskedKey,
				maskProbeValue(
					entry,
					inheritedSensitive ||
						SENSITIVE_FIELD_NAME.test(key) ||
						SENSITIVE_FIELD_NAME.test(maskedKey)
				),
			];
		})
	);
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

function maskProbeValue(value: unknown, sensitive: boolean = false): unknown {
	if (typeof value === 'string') {
		if (!sensitive) return maskSecrets(value);
		return maskSecrets(`token=${value}`).slice('token='.length);
	}
	if (Array.isArray(value)) return value.map((entry) => maskProbeValue(entry, sensitive));
	if (value !== null && typeof value === 'object') {
		return maskProbeRecord(value as Readonly<Record<string, unknown>>, sensitive);
	}
	return sensitive ? REDACTED_NON_STRING : value;
}

function padSeverity(severity: Severity): string {
	return severity.toUpperCase().padEnd('CRITICAL'.length, ' ');
}

function truncate(value: string, length: number): string {
	return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

export function renderProbeOutput(
	result: ProbeResult,
	issues: readonly ProbeIssue[],
	json: boolean
): string {
	const maskedResult = maskProbeResult(result);
	const maskedIssues = maskProbeIssues(issues);
	return json
		? formatProbeJson(maskedResult, maskedIssues)
		: formatProbeHuman(maskedResult, maskedIssues);
}
