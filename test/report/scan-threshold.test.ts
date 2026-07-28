import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

interface CliResult {
	readonly exitCode: null | number;
	readonly stderr: string;
	readonly stdout: string;
}

interface JsonReport {
	readonly findings: readonly {
		readonly findings: readonly {
			readonly ruleId: string;
			readonly severity: string;
		}[];
	}[];
	readonly summary: {
		readonly totalFindings: number;
	};
}

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const CLI_ENTRY = resolve(PROJECT_ROOT, 'src', 'cli.ts');
const CREDENTIAL_FORMAT_FIXTURE = resolve(PROJECT_ROOT, 'test', 'fixtures', 'credential-formats');
const FINDING_RULE_ID = 'agent.connector-credential-reachability';

function runCli(args: readonly string[]): CliResult {
	const result = spawnSync('bun', [CLI_ENTRY, ...args], {
		cwd: PROJECT_ROOT,
		encoding: 'utf8',
		windowsHide: true,
	});
	if (result.error) throw result.error;
	return {
		exitCode: result.status,
		stderr: result.stderr ?? '',
		stdout: result.stdout ?? '',
	};
}

function scanArgs(...extra: readonly string[]): readonly string[] {
	return ['scan', '--path', CREDENTIAL_FORMAT_FIXTURE, '--agent', 'custom', ...extra];
}

function parseReport(result: CliResult): JsonReport {
	return JSON.parse(result.stdout) as JsonReport;
}

describe('scan threshold and --all CLI contract', () => {
	test('default medium threshold hides an info finding and exits zero', () => {
		const result = runCli(scanArgs());

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("No findings at or above threshold 'medium'.");
		expect(result.stdout).toContain(
			"(1 finding below threshold 'medium' hidden: 1 info. Re-run with --all to show.)"
		);
		expect(result.stdout).not.toContain(FINDING_RULE_ID);
	});

	test('explicit info threshold reveals the finding and exits one', () => {
		const result = runCli(scanArgs('--threshold', 'info'));

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain(FINDING_RULE_ID);
		expect(result.stdout).not.toContain('below threshold');
	});

	test('--all reveals hidden human findings without changing the exit threshold', () => {
		const result = runCli(scanArgs('--all'));

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(FINDING_RULE_ID);
		expect(result.stdout).not.toContain('below threshold');
	});

	test('JSON always retains all findings while threshold and --all control exit/display only', () => {
		const defaultResult = runCli(scanArgs('--json'));
		const infoResult = runCli(scanArgs('--threshold', 'info', '--json'));
		const allResult = runCli(scanArgs('--all', '--json'));

		expect(defaultResult.exitCode).toBe(0);
		expect(infoResult.exitCode).toBe(1);
		expect(allResult.exitCode).toBe(0);

		for (const result of [defaultResult, infoResult, allResult]) {
			const report = parseReport(result);
			const findings = report.findings.flatMap((group) => group.findings);

			expect(result.stderr).toBe('');
			expect(result.stdout).not.toContain('below threshold');
			expect(report.summary.totalFindings).toBe(1);
			expect(findings.map(({ ruleId, severity }) => ({ ruleId, severity }))).toEqual([
				{ ruleId: FINDING_RULE_ID, severity: 'info' },
			]);
		}
	});
});
