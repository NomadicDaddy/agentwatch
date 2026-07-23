import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import type { Finding } from '../../src/rules/types.ts';

import { formatHuman, type ScanInventory } from '../../src/report/human.ts';
import { makeSource } from '../helpers.ts';

interface CliResult {
	readonly exitCode: null | number;
	readonly stderr: string;
	readonly stdout: string;
}

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const CLI_ENTRY = resolve(PROJECT_ROOT, 'src', 'cli.ts');
const BAD_ACTOR_FIXTURE = resolve(PROJECT_ROOT, 'test', 'fixtures', 'bad-actor');
const SOURCE = makeSource();
const INVENTORY: ScanInventory = {
	artifactCounts: { claude: { 'connector-config': 1 } },
	sources: [SOURCE],
	totalArtifacts: 1,
};

const EVIDENCE_CASES = [
	{
		masked: 'sk-1234***',
		raw: 'sk-1234567890abcdefgh',
	},
	{
		masked: 'Bearer abcd***',
		raw: 'Bearer abcdefghijk12345',
	},
	{
		masked: 'client_secret="corr***"',
		raw: 'client_secret="correcthorsebattery"',
	},
	{
		masked: '0123***',
		raw: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl',
	},
] as const;

const FIXTURE_SECRETS = [
	'FIXTURE_NOT_REAL_SECRET',
	'FIXTURE_NOT_REAL_TOKEN',
	'FIXTURE_NOT_REAL_REFRESH',
	'FIXTURE_NOT_REAL_KEY',
	'FIXTURE_NOT_REAL_BEARER',
] as const;

function makeFinding(evidence: string, index: number): Finding {
	return {
		confidence: 'high',
		evidence,
		group: 'credential-reachability',
		id: `finding-${index}`,
		recommendation: 'Rotate the credential.',
		ruleId: 'agent.connector-credential-reachability',
		score: 90,
		severity: 'high',
		signals: ['credential-reach'],
		source: SOURCE,
		title: `Credential finding ${index}`,
	};
}

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

describe('human report credential masking', () => {
	test('masks every evidence class at the shared scan and inspect output boundary', () => {
		const findings = EVIDENCE_CASES.map(({ raw }, index) => makeFinding(raw, index));
		const report = formatHuman(findings, INVENTORY, {
			scannedAt: '2026-07-23T00:00:00.000Z',
			showAll: true,
			version: '0.1.0',
		});

		for (const { masked, raw } of EVIDENCE_CASES) {
			expect(report).toContain(`Evidence: ${masked}`);
			expect(report).not.toContain(raw);
		}
	});

	test('masks fixture credentials in shipped scan human output', () => {
		const result = runCli(['scan', '--path', BAD_ACTOR_FIXTURE, '--agent', 'custom', '--all']);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain('Evidence:');
		expect(result.stdout).toContain('FIXT***');
		for (const secret of FIXTURE_SECRETS) {
			expect(result.stdout).not.toContain(secret);
		}
	});
});
