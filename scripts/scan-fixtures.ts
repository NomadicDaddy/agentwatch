#!/usr/bin/env bun
/**
 * Run agentwatch against the synthetic bad-actor fixture tree and assert that
 * every registered rule pack fires at least one finding. The fixtures are pure
 * data — agentwatch is read-only, so nothing here is ever executed.
 *
 * Usage: `bun run scan:fixtures`
 *
 * Exit codes:
 *   0 — every expected ruleId appeared in the scan output
 *   1 — one or more rules did not fire (output the missing list)
 *   2 — the scan command itself failed
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

interface JsonFinding {
	readonly ruleId: string;
	readonly severity: string;
	readonly source: { readonly customPath: boolean };
}

interface JsonReport {
	readonly findings: readonly { readonly findings: readonly JsonFinding[] }[];
	readonly summary: {
		readonly bySeverity: Record<string, number>;
		readonly totalFindings: number;
	};
}

const EXPECTED_RULE_IDS: readonly string[] = [
	'agent.broad-tool-surface',
	'agent.connector-credential-reachability',
	'agent.credential-file-reference',
	'agent.dynamic-tool-registry',
	'agent.local-execution-bridge',
	'agent.memory-context-request',
	'agent.remote-capability',
	'agent.remote-generic-mcp-gateway',
	'agent.remote-manifest',
	'agent.trigger-based-invocation',
	'agent.unpinned-execution-bridge',
	'agent.untrusted-install-source',
];

const FIXTURE_DIR = path.resolve(import.meta.dir, '..', 'test', 'fixtures', 'bad-actor');
const CLI_ENTRY = path.resolve(import.meta.dir, '..', 'src', 'cli.ts');

const result = spawnSync('bun', [CLI_ENTRY, 'scan', '--path', FIXTURE_DIR, '--all', '--json'], {
	encoding: 'utf8',
	maxBuffer: 64 * 1024 * 1024,
});

if (result.error) {
	process.stderr.write(`fixture scan failed to spawn: ${result.error.message}\n`);
	process.exit(2);
}

const stdout = result.stdout ?? '';
let report: JsonReport;
try {
	report = JSON.parse(stdout) as JsonReport;
} catch (err) {
	process.stderr.write(`fixture scan output was not valid JSON: ${(err as Error).message}\n`);
	process.stderr.write(`stdout (first 500 chars): ${stdout.slice(0, 500)}\n`);
	process.exit(2);
}

const seen = new Set<string>();
let fixtureFindings = 0;
const fixtureSeverityCounts: Record<string, number> = {};
for (const group of report.findings) {
	for (const finding of group.findings) {
		if (!finding.source.customPath) continue;
		seen.add(finding.ruleId);
		fixtureFindings += 1;
		fixtureSeverityCounts[finding.severity] =
			(fixtureSeverityCounts[finding.severity] ?? 0) + 1;
	}
}

const missing = EXPECTED_RULE_IDS.filter((id) => !seen.has(id));
const unexpected = [...seen].filter((id) => !EXPECTED_RULE_IDS.includes(id));

const lines: string[] = [];
lines.push(`Fixture scan: ${FIXTURE_DIR}`);
lines.push(
	`Fixture findings: ${fixtureFindings} (filtered from ${report.summary.totalFindings} total)`
);
lines.push(
	'  ' +
		Object.entries(fixtureSeverityCounts)
			.map(([sev, n]) => `${sev}=${n}`)
			.join(' ')
);
lines.push('');
lines.push('Rules fired:');
for (const id of [...seen].sort()) lines.push(`  + ${id}`);
if (missing.length > 0) {
	lines.push('');
	lines.push('Missing rules (expected but not fired):');
	for (const id of missing) lines.push(`  - ${id}`);
}
if (unexpected.length > 0) {
	lines.push('');
	lines.push('Unexpected rule ids (drift — update EXPECTED_RULE_IDS or fixtures):');
	for (const id of unexpected) lines.push(`  ? ${id}`);
}

process.stdout.write(`${lines.join('\n')}\n`);

if (missing.length > 0) process.exit(1);
process.exit(0);
