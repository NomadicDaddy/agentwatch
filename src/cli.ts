#!/usr/bin/env bun
/**
 * AgentWatch CLI entry point.
 *
 * Wires Commander commands to the scanner/reporter modules. The CLI is
 * intentionally thin — it parses arguments, calls library functions, and
 * formats results.
 */

import { Command } from 'commander';

import type { Severity } from './rules/types.ts';

import licenseText from '../LICENSE' with { type: 'text' };
import thirdPartyNoticesText from '../THIRD-PARTY-NOTICES.md' with { type: 'text' };
import { runExplain } from './report/explain.ts';
import { runInspectMcp } from './report/inspect-mcp.ts';
import { runInspectSkill } from './report/inspect-skill.ts';
import { runProbe } from './report/probe.ts';
import { DEFAULT_THRESHOLD, isSeverity, runScan } from './scanner/scan.ts';
import { PACKAGE_VERSION } from './version.ts';

function buildProgram(): Command {
	const program = new Command();
	program
		.name('agentwatch')
		.description('Local, read-only inspection of installed AI-agent capability surfaces.')
		.version(PACKAGE_VERSION)
		.option('--license', 'Print first- and third-party license notices.');

	program.on('option:license', () => {
		process.stdout.write(`${licenseText.trimEnd()}\n\n${thirdPartyNoticesText.trimEnd()}\n`);
		process.exit(0);
	});

	program
		.command('scan')
		.description(
			'Scan known agent surfaces on this workstation.\n' +
				'Exit codes: 0 = no findings at or above threshold, 1 = findings at or above threshold, 2 = runtime error or invalid arguments.'
		)
		.option('--json', 'Emit machine-readable JSON instead of human output.')
		.option('--path <path...>', 'Add a custom root to scan. Repeat or pass multiple values.')
		.option('--agent <name>', 'Restrict the scan to a single agent family.')
		.option(
			'--threshold <severity>',
			`Severity at or above which findings render in detail and the scan exits non-zero (info, low, medium, high, critical). Default: ${DEFAULT_THRESHOLD}.`,
			DEFAULT_THRESHOLD
		)
		.option('--all', 'Show every finding regardless of threshold (human output only).')
		.action(
			async (opts: {
				agent?: string;
				all?: boolean;
				json?: boolean;
				path?: readonly string[];
				threshold?: string;
			}) => {
				const rawThreshold = opts.threshold ?? DEFAULT_THRESHOLD;
				if (!isSeverity(rawThreshold)) {
					process.stderr.write(
						`error: invalid threshold '${rawThreshold}'. Expected one of: info, low, medium, high, critical\n`
					);
					process.exit(2);
				}
				const threshold: Severity = rawThreshold;
				const exitCode = await runScan({
					agent: opts.agent,
					customPaths: opts.path,
					json: opts.json === true,
					showAll: opts.all === true,
					threshold,
				});
				process.exit(exitCode);
			}
		);

	program
		.command('inspect-skill <file>')
		.description('Inspect a single skill file (SKILL.md or equivalent).')
		.option('--json', 'Emit machine-readable JSON instead of human output.')
		.action(async (file: string, opts: { json?: boolean }) => {
			const exitCode = await runInspectSkill(file, { json: opts.json === true });
			process.exit(exitCode);
		});

	program
		.command('inspect-mcp <file>')
		.description('Inspect a single MCP server config file.')
		.option('--json', 'Emit machine-readable JSON instead of human output.')
		.action(async (file: string, opts: { json?: boolean }) => {
			const exitCode = await runInspectMcp(file, { json: opts.json === true });
			process.exit(exitCode);
		});

	program
		.command('probe <url>')
		.description(
			'Probe a remote MCP server (network access required) and report its tool, ' +
				'prompt, and resource surface plus heuristic findings. This subcommand is the ' +
				'only place agentwatch contacts the network; it never invokes a tool, only ' +
				'enumerates what the server advertises.\n' +
				'Exit codes: 0 = no issues at or above medium, 1 = issues at or above medium ' +
				'or all probe stages errored, 2 = invalid arguments.'
		)
		.option('--auth <token>', 'Send "Authorization: Bearer <token>" with each request.')
		.option(
			'--header <header...>',
			'Add a custom request header. Format "Key: value". Repeat or pass multiple.'
		)
		.option('--timeout <ms>', 'Per-request timeout in milliseconds.', '15000')
		.option('--json', 'Emit machine-readable JSON instead of human output.')
		.action(
			async (
				url: string,
				opts: {
					auth?: string;
					header?: readonly string[];
					json?: boolean;
					timeout?: string;
				}
			) => {
				const headers = parseHeaderOption(opts.header);
				if (headers === null) {
					process.exit(2);
				}
				const timeoutMs = parseTimeoutMs(opts.timeout ?? '15000');
				if (timeoutMs === null) {
					process.stderr.write(`error: invalid --timeout '${opts.timeout}'\n`);
					process.exit(2);
				}
				const exitCode = await runProbe(url, {
					json: opts.json === true,
					timeoutMs,
					...(opts.auth !== undefined ? { authToken: opts.auth } : {}),
					...(Object.keys(headers).length > 0 ? { headers } : {}),
				});
				process.exit(exitCode);
			}
		);

	program
		.command('explain <findingId>')
		.description('Print the explanation for a finding or rule id.')
		.action((findingId: string) => {
			const exitCode = runExplain(findingId);
			process.exit(exitCode);
		});

	program.showHelpAfterError('(run `agentwatch --help` for usage)');

	return program;
}

/**
 * Parse a `--timeout` value into a positive safe integer. Rejects non-integer
 * strings (e.g. `10ms`, `1.5`, `abc`) so `Number.parseInt` cannot silently
 * truncate them. Returns `null` for anything that is not a whole positive
 * number within the safe-integer range.
 */
function parseTimeoutMs(raw: string): null | number {
	const trimmed = raw.trim();
	if (!/^[1-9][0-9]*$/.test(trimmed)) return null;
	const value = Number(trimmed);
	if (!Number.isSafeInteger(value) || value <= 0) return null;
	return value;
}

function parseHeaderOption(values: readonly string[] | undefined): null | Record<string, string> {
	const headers: Record<string, string> = {};
	for (const raw of values ?? []) {
		const idx = raw.indexOf(':');
		if (idx <= 0) {
			process.stderr.write("error: invalid --header (expected 'Key: value')\n");
			return null;
		}
		const name = raw.slice(0, idx).trim();
		const value = raw.slice(idx + 1).trim();
		if (!name) {
			process.stderr.write(
				"error: invalid --header (expected 'Key: value' with a non-empty key)\n"
			);
			return null;
		}
		headers[name] = value;
	}
	return headers;
}

const program = buildProgram();
try {
	await program.parseAsync(process.argv);
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(`error: ${message}\n`);
	process.exit(2);
}
