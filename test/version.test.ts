import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import packageMetadata from '../package.json' with { type: 'json' };
import { runProbe } from '../src/report/probe.ts';
import { PACKAGE_VERSION } from '../src/version.ts';

interface ProcessResult {
	readonly exitCode: null | number;
	readonly stderr: string;
	readonly stdout: string;
}

const PROJECT_ROOT = resolve(import.meta.dir, '..');
const CLI_ENTRY = resolve(PROJECT_ROOT, 'src', 'cli.ts');
const MCP_FIXTURE = resolve(PROJECT_ROOT, 'test', 'fixtures', 'bad-actor', '.mcp.json');
const SKILL_FIXTURE = resolve(
	PROJECT_ROOT,
	'test',
	'fixtures',
	'bad-actor',
	'skills',
	'evil-skill',
	'SKILL.md'
);

let buildRoot: string;
let bundlePath: string;
let executablePath: string;

function runProcess(command: string, args: readonly string[]): ProcessResult {
	const result = spawnSync(command, args, {
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

function requireSuccess(command: string, args: readonly string[]): ProcessResult {
	const result = runProcess(command, args);
	if (result.exitCode !== 0) {
		throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
	}
	return result;
}

function runCli(args: readonly string[]): ProcessResult {
	return runProcess('bun', [CLI_ENTRY, ...args]);
}

function parseVersion(output: string): string {
	return (JSON.parse(output) as { readonly version: string }).version;
}

beforeAll(async () => {
	buildRoot = await mkdtemp(join(tmpdir(), 'agentwatch-version-'));
	bundlePath = join(buildRoot, 'agentwatch.js');
	executablePath = join(
		buildRoot,
		process.platform === 'win32' ? 'agentwatch.exe' : 'agentwatch'
	);

	requireSuccess('bun', ['build', CLI_ENTRY, '--target=bun', '--outfile', bundlePath]);
	requireSuccess('bun', ['build', CLI_ENTRY, '--compile', '--outfile', executablePath]);
}, 120_000);

afterAll(async () => {
	await rm(buildRoot, { force: true, recursive: true });
});

describe('package version authority', () => {
	test('declares and executes only the supported Bun runtime', () => {
		expect(packageMetadata.engines).toEqual({ bun: '>=1.3.14' });

		const cliVersion = runCli(['--version']);
		expect(cliVersion.exitCode).toBe(0);
		expect(cliVersion.stdout.trim()).toBe(packageMetadata.version);
	});

	test('shared runtime version matches package.json', () => {
		expect(PACKAGE_VERSION).toBe(packageMetadata.version);
	});

	test('CLI and report metadata use the package version', () => {
		const cliVersion = runCli(['--version']);
		const scan = runCli(['scan', '--agent', 'custom', '--json']);
		const inspectMcp = runCli(['inspect-mcp', MCP_FIXTURE, '--json']);
		const inspectSkill = runCli(['inspect-skill', SKILL_FIXTURE, '--json']);

		expect(cliVersion.exitCode).toBe(0);
		expect(cliVersion.stdout.trim()).toBe(packageMetadata.version);
		expect(scan.exitCode).toBe(0);
		expect(parseVersion(scan.stdout)).toBe(packageMetadata.version);
		expect(parseVersion(inspectMcp.stdout)).toBe(packageMetadata.version);
		expect(parseVersion(inspectSkill.stdout)).toBe(packageMetadata.version);
	});

	test('probe report and MCP clientInfo use the package version', async () => {
		const requestBodies: string[] = [];
		const responses = [
			new Response(
				JSON.stringify({
					id: 1,
					jsonrpc: '2.0',
					result: {
						capabilities: {},
						protocolVersion: '2025-06-18',
						serverInfo: { name: 'fixture', version: '1.0.0' },
					},
				})
			),
			new Response(null, { status: 204 }),
			new Response(
				JSON.stringify({
					id: 2,
					jsonrpc: '2.0',
					result: { tools: [] },
				})
			),
		];
		const originalFetch = globalThis.fetch;
		Object.assign(globalThis, {
			fetch: (_input: Request | string | URL, init?: RequestInit) => {
				if (typeof init?.body === 'string') requestBodies.push(init.body);
				const response = responses.shift();
				if (!response) return Promise.reject(new Error('Unexpected probe request'));
				return Promise.resolve(response);
			},
		});
		const output: string[] = [];
		const writeSpy = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
			output.push(String(chunk));
			return true;
		});

		try {
			expect(await runProbe('https://example.test/mcp', { json: true })).toBe(0);
		} finally {
			writeSpy.mockRestore();
			Object.assign(globalThis, { fetch: originalFetch });
		}

		const initialize = JSON.parse(requestBodies[0] ?? '{}') as {
			readonly params?: { readonly clientInfo?: { readonly version?: string } };
		};
		expect(parseVersion(output.join(''))).toBe(packageMetadata.version);
		expect(initialize.params?.clientInfo?.version).toBe(packageMetadata.version);
	});

	test('bundled and compiled CLIs retain the package version', () => {
		const bundled = requireSuccess('bun', [bundlePath, '--version']);
		const compiled = requireSuccess(executablePath, ['--version']);

		expect(bundled.stdout.trim()).toBe(packageMetadata.version);
		expect(compiled.stdout.trim()).toBe(packageMetadata.version);
	});
});
