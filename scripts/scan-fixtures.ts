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

import { CRITICAL_CORRELATION_RULE_ID } from '../src/scanner/finding-correlation.ts';

interface JsonFinding {
	readonly file?: string;
	readonly ruleId: string;
	readonly severity: string;
	readonly signals: readonly string[];
	readonly source: {
		readonly agent: string;
		readonly customPath: boolean;
		readonly root: string;
	};
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
const EXPECTED_CRITICAL_FILE = path.join(FIXTURE_DIR, '.mcp.json');
const CLI_ENTRY = path.resolve(import.meta.dir, '..', 'src', 'cli.ts');

const result = spawnSync(
	'bun',
	[CLI_ENTRY, 'scan', '--agent', 'custom', '--path', FIXTURE_DIR, '--all', '--json'],
	{
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	}
);

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
const criticalCorrelations: JsonFinding[] = [];
const unexpectedSources = new Set<string>();
for (const group of report.findings) {
	for (const finding of group.findings) {
		const isFixtureSource =
			finding.source.agent === 'custom' &&
			finding.source.customPath &&
			path.resolve(finding.source.root) === FIXTURE_DIR;
		if (!isFixtureSource) {
			unexpectedSources.add(
				`${finding.source.agent}:${finding.source.customPath}:${finding.source.root}`
			);
			continue;
		}
		if (finding.ruleId === CRITICAL_CORRELATION_RULE_ID) {
			criticalCorrelations.push(finding);
		} else {
			seen.add(finding.ruleId);
		}
		fixtureFindings += 1;
		fixtureSeverityCounts[finding.severity] =
			(fixtureSeverityCounts[finding.severity] ?? 0) + 1;
	}
}

const missing = EXPECTED_RULE_IDS.filter((id) => !seen.has(id));
const unexpected = [...seen].filter((id) => !EXPECTED_RULE_IDS.includes(id));
const expectedCriticalCorrelations = criticalCorrelations.filter(
	(finding) =>
		finding.severity === 'critical' &&
		finding.file !== undefined &&
		path.resolve(finding.file) === EXPECTED_CRITICAL_FILE
);

const lines: string[] = [];
lines.push(`Fixture scan: ${FIXTURE_DIR}`);
lines.push(`Fixture findings: ${fixtureFindings} (${report.summary.totalFindings} total)`);
lines.push('Sources: custom fixture root only');
lines.push(
	`  ${Object.entries(fixtureSeverityCounts)
		.map(([sev, n]) => `${sev}=${n}`)
		.join(' ')}`
);
lines.push('');
lines.push(`Critical correlations: ${criticalCorrelations.length} (${EXPECTED_CRITICAL_FILE})`);
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
if (unexpectedSources.size > 0 || fixtureFindings !== report.summary.totalFindings) {
	lines.push('');
	lines.push('Non-fixture findings detected (fixture scan must be isolated):');
	for (const source of unexpectedSources) lines.push(`  ! ${source}`);
	if (fixtureFindings !== report.summary.totalFindings) {
		lines.push(
			`  ! report total ${report.summary.totalFindings} does not match ${fixtureFindings} fixture findings`
		);
	}
}
if (criticalCorrelations.length !== 1 || expectedCriticalCorrelations.length !== 1) {
	lines.push('');
	lines.push('Critical correlation mismatch:');
	for (const finding of criticalCorrelations) {
		lines.push(`  ! ${finding.severity} ${finding.file ?? '(no file)'}`);
	}
}

process.stdout.write(`${lines.join('\n')}\n`);

if (
	missing.length > 0 ||
	criticalCorrelations.length !== 1 ||
	expectedCriticalCorrelations.length !== 1 ||
	unexpectedSources.size > 0 ||
	fixtureFindings !== report.summary.totalFindings
) {
	process.exit(1);
}
process.exit(0);
