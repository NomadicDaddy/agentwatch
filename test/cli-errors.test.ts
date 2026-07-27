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
		expect(result.stderr).toBe(
			'probe: URL must be a valid http:// or https:// address with a hostname\n'
		);
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

describe('probe URL validation rejects malformed addresses at the argument boundary', () => {
	test.each([
		['bare http prefix with no hostname', 'http://'],
		['bare https prefix with no hostname', 'https://'],
		['non-http protocol', 'ftp://example.test/mcp'],
		['schemeless string', 'example.test/mcp'],
	])('rejects %s with invalid-argument exit code 2', (_label, malformedUrl) => {
		const result = runCli(['probe', malformedUrl]);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe(
			'probe: URL must be a valid http:// or https:// address with a hostname\n'
		);
	});
});

describe('probe --timeout strict integer validation', () => {
	test.each([
		['10ms', 'suffixed value should not be truncated'],
		['1.5', 'decimal is not a whole number'],
		['0', 'zero is not positive'],
		['abc', 'non-numeric'],
	])('rejects invalid timeout %s with exit code 2', (invalidTimeout, _reason) => {
		const result = runCli(['probe', 'https://example.test/mcp', '--timeout', invalidTimeout]);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe(`error: invalid --timeout '${invalidTimeout}'\n`);
	});
});
