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
	test('inspect-mcp reports unpinned execution bridges from the shipped CLI', () => {
		const result = runCli(['inspect-mcp', MCP_FIXTURE, '--json']);
		const report = JSON.parse(result.stdout) as {
			readonly findings: readonly JsonFindingGroup[];
		};
		const findings = report.findings.flatMap((group) => group.findings);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe('');
		expect(
			findings.some((finding) => finding.ruleId === 'agent.unpinned-execution-bridge')
		).toBe(true);
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
});
