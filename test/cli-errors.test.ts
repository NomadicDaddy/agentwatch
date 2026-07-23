import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

interface CliResult {
	readonly exitCode: null | number;
	readonly stderr: string;
	readonly stdout: string;
}

const PROJECT_ROOT = resolve(import.meta.dir, '..');
const CLI_ENTRY = resolve(PROJECT_ROOT, 'src', 'cli.ts');

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

describe('CLI validation error secret retention', () => {
	test('invalid probe URL does not echo its query token', () => {
		const token = 'dummy-query-token-for-regression';
		const invalidUrl = `ftp://example.test/mcp?token=${token}`;
		const result = runCli(['probe', invalidUrl]);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe('probe: URL must start with http:// or https://\n');
		expect(result.stderr).not.toContain(invalidUrl);
		expect(result.stderr).not.toContain(token);
	});

	test.each([
		['Authorization', 'Authorization Bearer dummy-authorization-token'],
		['API key', 'X-API-Key dummy-api-key-value'],
	])('malformed %s header does not echo its supplied value', (_label, malformedHeader) => {
		const result = runCli(['probe', 'https://example.test/mcp', '--header', malformedHeader]);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe("error: invalid --header (expected 'Key: value')\n");
		expect(result.stderr).not.toContain(malformedHeader);
		expect(result.stderr).not.toContain(malformedHeader.split(' ').at(-1) ?? malformedHeader);
	});
});
