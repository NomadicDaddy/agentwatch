import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

interface CliResult {
	readonly exitCode: null | number;
	readonly stderr: string;
	readonly stdout: string;
}

interface JsonFindingGroup {
	readonly findings: readonly { readonly ruleId: string }[];
}

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const CLI_ENTRY = resolve(PROJECT_ROOT, 'src', 'cli.ts');
const MCP_FIXTURE = resolve(PROJECT_ROOT, 'test', 'fixtures', 'bad-actor', '.mcp.json');
const MCP_RULE_IDS: readonly string[] = [
	'agent.dynamic-tool-registry',
	'agent.local-execution-bridge',
	'agent.remote-capability',
	'agent.remote-manifest',
	'agent.unpinned-execution-bridge',
];

function runCli(args: readonly string[]): CliResult {
	const result = spawnSync('bun', [CLI_ENTRY, ...args], {
		cwd: PROJECT_ROOT,
		encoding: 'utf8',
	});
	if (result.error) throw result.error;
	return {
		exitCode: result.status,
		stderr: result.stderr ?? '',
		stdout: result.stdout ?? '',
	};
}

describe('focused inspection and explanations', () => {
	test('inspect-mcp and explain cover the same registered MCP rules', () => {
		const result = runCli(['inspect-mcp', MCP_FIXTURE, '--json']);
		const report = JSON.parse(result.stdout) as {
			readonly findings: readonly JsonFindingGroup[];
		};
		const ruleIds = [
			...new Set(
				report.findings.flatMap((group) => group.findings.map((finding) => finding.ruleId))
			),
		].sort();

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe('');
		expect(ruleIds).toEqual([...MCP_RULE_IDS]);

		for (const ruleId of ruleIds) {
			const explanation = runCli(['explain', ruleId]);
			expect(explanation.exitCode).toBe(0);
			expect(explanation.stderr).toBe('');
			expect(explanation.stdout).toContain(`Rule:  ${ruleId}`);
		}
	});

	test('explain recognizes the unpinned execution rule from the shipped CLI', () => {
		const result = runCli(['explain', 'agent.unpinned-execution-bridge']);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('Rule:  agent.unpinned-execution-bridge');
		expect(result.stdout).toContain('unpinned-execution (+20)');
		expect(result.stdout).toContain('Pin launcher targets to an exact version');
	});

	test('CLI explanation lists all five shipped commands', () => {
		const result = runCli(['explain', 'cli']);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain(
			'five commands: scan, inspect-skill, inspect-mcp, probe, and explain'
		);
	});

	test('focused CLI commands return their documented boundary exit codes', () => {
		const inspectSuccess = runCli(['inspect-mcp', MCP_FIXTURE, '--json']);
		const inspectReadError = runCli(['inspect-mcp', '__missing-mcp-config__.json']);
		const explainSuccess = runCli(['explain', MCP_RULE_IDS[0] ?? '']);
		const explainUnknown = runCli(['explain', 'agent.unknown-rule']);

		expect(inspectSuccess.exitCode).toBe(0);
		expect(inspectReadError.exitCode).toBe(2);
		expect(inspectReadError.stderr).toContain('inspect-mcp: cannot read');
		expect(explainSuccess.exitCode).toBe(0);
		expect(explainUnknown.exitCode).toBe(1);
		expect(explainUnknown.stderr).toContain('explain: no explanation registered');
	});

	test('global license option emits first- and third-party notices', () => {
		const result = runCli(['--license']);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('Copyright (c) 2026 NomadicDaddy');
		expect(result.stdout).toContain('# Third-Party Notices');
		expect(result.stdout).toContain('## commander@15.0.0');
		expect(result.stdout).toContain('## zod@4.4.3');
	});
});
