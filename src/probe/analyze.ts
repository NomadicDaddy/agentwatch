/**
 * Heuristic analysis of an MCP probe result.
 *
 * Static config scans cannot detect generic-gateway architectures because
 * the danger is runtime: a server that returns a different `tools/list`
 * to different sessions, or registers new tools after install, looks
 * benign on disk. This pass inspects what the server actually advertised
 * over the wire and flags shapes that suggest a dispatcher rather than a
 * single-purpose tool.
 */

import type { Severity } from '../rules/types.ts';
import type { ProbeResult } from './probe.ts';

type ProbeIssueKind =
	| 'broad-surface-tool'
	| 'gateway-wording-tool'
	| 'generic-dispatch-tool'
	| 'high-tool-count'
	| 'missing-server-info'
	| 'non-https-transport';

export interface ProbeIssue {
	readonly evidence: string;
	readonly kind: ProbeIssueKind;
	readonly severity: Severity;
	readonly title: string;
}

const GENERIC_NAME =
	/^(?:call|invoke|run|execute|exec|dispatch|do|action|handle|proxy|gateway|forward|relay|tool|any[_-]?tool|use[_-]?tool)(?:_(?:tool|command|call|api))?$/i;

const GATEWAY_DESCRIPTION =
	/\b(?:gateway|marketplace|toolbox|proxy|dispatch(?:er)?|forward|relay|register\s+(?:new\s+)?tools?|any\s+(?:tool|command|capability|capabilities)|every\s+tool)\b/i;

const BROAD_DESCRIPTION =
	/\b(?:execute\s+arbitrary|run\s+any|invoke\s+any|all\s+tools|all\s+commands|universal\s+(?:tool|capability))\b/i;

const HIGH_TOOL_COUNT_THRESHOLD = 25;
const MAX_EVIDENCE_LEN = 240;

function truncate(s: string, n: number): string {
	return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function analyzeProbe(result: ProbeResult): readonly ProbeIssue[] {
	const issues: ProbeIssue[] = [];

	if (!result.url.toLowerCase().startsWith('https://')) {
		issues.push({
			evidence: result.url,
			kind: 'non-https-transport',
			severity: 'high',
			title: 'Probe target is not HTTPS',
		});
	}

	if (result.tools.length >= HIGH_TOOL_COUNT_THRESHOLD) {
		issues.push({
			evidence: `${result.tools.length} tools advertised (threshold: ${HIGH_TOOL_COUNT_THRESHOLD})`,
			kind: 'high-tool-count',
			severity: 'medium',
			title: `Server exposes ${result.tools.length} tools`,
		});
	}

	for (const tool of result.tools) {
		if (GENERIC_NAME.test(tool.name)) {
			issues.push({
				evidence: truncate(tool.description ?? tool.name, MAX_EVIDENCE_LEN),
				kind: 'generic-dispatch-tool',
				severity: 'high',
				title: `Generic dispatch tool name: '${tool.name}'`,
			});
		}

		const desc = tool.description ?? '';
		if (GATEWAY_DESCRIPTION.test(desc)) {
			issues.push({
				evidence: truncate(desc, MAX_EVIDENCE_LEN),
				kind: 'gateway-wording-tool',
				severity: 'high',
				title: `Tool '${tool.name}' uses gateway/marketplace wording`,
			});
		}
		if (BROAD_DESCRIPTION.test(desc)) {
			issues.push({
				evidence: truncate(desc, MAX_EVIDENCE_LEN),
				kind: 'broad-surface-tool',
				severity: 'high',
				title: `Tool '${tool.name}' advertises broad/universal capability`,
			});
		}
	}

	if (result.errors.length === 0 && !result.serverInfo) {
		issues.push({
			evidence: result.url,
			kind: 'missing-server-info',
			severity: 'low',
			title: 'Server completed initialize without advertising serverInfo',
		});
	}

	return issues;
}
