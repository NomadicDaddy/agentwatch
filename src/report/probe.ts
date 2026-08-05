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

import type { ProbeOptions, ProbeResult, ProbeStage } from '../probe/probe.ts';
import type { Severity } from '../rules/types.ts';

import { analyzeProbe } from '../probe/analyze.ts';
import { probeMcp } from '../probe/probe.ts';
import { renderProbeOutput } from './probe-output.ts';

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
	critical: 4,
	high: 3,
	info: 0,
	low: 1,
	medium: 2,
};
const DEFAULT_THRESHOLD: Severity = 'medium';

export interface RunProbeOptions {
	readonly authToken?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly json: boolean;
	readonly timeoutMs?: number;
}

/**
 * Validate a probe URL by parsing it, not just prefix-matching. A bare
 * `http://` or `https://` with no hostname must be rejected at the argument
 * boundary (exit 2) rather than reaching runtime network handling (exit 1).
 *
 * Returns `true` for an HTTP(S) URL with a non-empty hostname.
 */
export function isValidProbeUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	const protocol = parsed.protocol.toLowerCase();
	return (protocol === 'http:' || protocol === 'https:') && parsed.hostname.length > 0;
}

export async function runProbe(url: string, options: RunProbeOptions): Promise<number> {
	if (!isValidProbeUrl(url)) {
		process.stderr.write(
			'probe: URL must be a valid http:// or https:// address with a hostname\n'
		);
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
	process.stdout.write(renderProbeOutput(result, issues, options.json));

	if (allAttemptedStagesFailed(result)) return 1;
	const minRank = SEVERITY_RANK[DEFAULT_THRESHOLD];
	return issues.some((i) => SEVERITY_RANK[i.severity] >= minRank) ? 1 : 0;
}

/**
 * Determine whether every stage the probe attempted ended in error. This is the
 * "all probe stages errored" condition that forces exit code 1 regardless of
 * heuristic issue severity. A probe that discovered any partial surface — even
 * one with zero tools but a successful prompts/list or resources/list — is not
 * a total failure and falls through to the severity-based exit code.
 *
 * `initialize` is always attempted. When it succeeds (signaled by the presence
 * of `serverInfo`, `protocolVersion`, or `capabilities`), `tools/list` is
 * always attempted too, while `prompts/list` and `resources/list` are attempted
 * only when the server advertised the corresponding capability.
 */
function allAttemptedStagesFailed(result: ProbeResult): boolean {
	const failedStages = new Set(result.errors.map((error) => error.stage));
	const initSucceeded =
		result.serverInfo !== undefined ||
		result.protocolVersion !== undefined ||
		result.capabilities !== undefined;

	// initialize is the only attempted stage when it itself errored.
	if (!initSucceeded) return failedStages.has('initialize');

	// initialize succeeded: reconstruct the set of stages that were attempted so
	// we can check that every one of them appears in the error set.
	const attempted = new Set<ProbeStage>(['tools/list']);
	if (result.capabilities?.prompts) attempted.add('prompts/list');
	if (result.capabilities?.resources) attempted.add('resources/list');

	for (const stage of attempted) {
		if (!failedStages.has(stage)) return false;
	}
	return true;
}
