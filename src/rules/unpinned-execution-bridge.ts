/**
 * Rule: agent.unpinned-execution-bridge
 *
 * Flags MCP configs and tool manifests that launch packages via npx/bunx/uvx/
 * pipx without pinning a version. Unpinned launchers resolve to whatever the
 * registry returns at run time — if the package is hijacked, typo-squatted,
 * or republished by a new maintainer, the agent picks up the new code on the
 * next launch with no review.
 *
 * Scope: mcp-config and tool-manifest artifacts.
 *
 * Score: each finding contributes the `unpinned-execution` signal (+20).
 * Combined upstream with `remote-endpoint` and `dynamic-registry` it pushes
 * the finding into the medium/high band.
 *
 * Detection strategy:
 *   1. Try to parse the artifact as JSON. For any object with both a
 *      `command` field naming a known launcher (npx/bunx/uvx/pipx) and an
 *      `args` array, inspect the first non-flag arg. If it lacks `@<version>`
 *      pinning (and is not the `-y` / `--yes` style flag), flag it.
 *   2. If the artifact does not parse as JSON, fall back to line-level
 *      regex detection for `npx <pkg>` / `bunx <pkg>` / `uvx <pkg>` /
 *      `pipx run <pkg>` patterns where `<pkg>` lacks version pinning.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';

import { computeScore, computeSeverity, Signal } from './scoring.ts';

type Launcher = 'bunx' | 'npx' | 'pipx' | 'uvx';

const LAUNCHERS: ReadonlySet<string> = new Set<Launcher>(['npx', 'bunx', 'uvx', 'pipx']);

const LAUNCHER_FLAGS: ReadonlySet<string> = new Set([
	'-y',
	'--yes',
	'-q',
	'--quiet',
	'-p',
	'--package',
	'--no-install',
	'-c',
	'--call',
	'run',
	'--from',
	'--with',
	'--python',
	'--spec',
]);

const RECOMMENDATION =
	'Pin the launcher target to a specific version (e.g. `npx pkg@1.2.3` or ' +
	'`uvx pkg==1.2.3`). Unpinned launchers resolve to the latest registry ' +
	'release at run time, so a hijack, typo-squat, or new maintainer can ship ' +
	'code into the agent with no review. Pinning gives you a known-good ' +
	'reference you can audit and update deliberately.';

const IN_SCOPE: ReadonlySet<Artifact['type']> = new Set(['mcp-config', 'tool-manifest']);

interface Match {
	readonly evidence: string;
	readonly launcher: Launcher;
	readonly line: number;
	readonly target: string;
}

function getLauncher(value: unknown): Launcher | null {
	if (typeof value !== 'string') return null;
	const base = value.replace(/\.(?:cmd|exe)$/i, '');
	const tail = base.split(/[\\/]/).pop() ?? '';
	return LAUNCHERS.has(tail) ? (tail as Launcher) : null;
}

function isFlag(arg: string): boolean {
	if (arg.startsWith('-')) return true;
	return LAUNCHER_FLAGS.has(arg);
}

/**
 * A package reference is pinned if it carries `@version` after the package
 * name (npm style: `pkg@1.2.3`, scoped: `@scope/pkg@1.2.3`) or `==version`
 * (Python / pipx style: `pkg==1.2.3`). `pkg@latest` is treated as UNPINNED —
 * spec line 3.
 */
function isPinned(target: string): boolean {
	const eq = target.match(/==([^=\s]+)$/);
	if (eq && eq[1] && eq[1].toLowerCase() !== 'latest') return true;

	let body = target;
	if (body.startsWith('@')) {
		const slash = body.indexOf('/');
		if (slash === -1) return false;
		body = body.slice(slash + 1);
	}
	const at = body.indexOf('@');
	if (at === -1) return false;
	const version = body.slice(at + 1);
	if (version.length === 0) return false;
	return version.toLowerCase() !== 'latest';
}

function lineForJsonPath(content: string, jsonPathToken: string): number {
	const idx = content.indexOf(jsonPathToken);
	if (idx === -1) return 1;
	let line = 1;
	for (let i = 0; i < idx; i++) {
		if (content.charCodeAt(i) === 0x0a) line++;
	}
	return line;
}

interface JsonHost {
	readonly args: unknown;
	readonly command: unknown;
}

function* walkJson(value: unknown): IterableIterator<JsonHost> {
	if (Array.isArray(value)) {
		for (const item of value) yield* walkJson(item);
		return;
	}
	if (value === null || typeof value !== 'object') return;
	const obj = value as Record<string, unknown>;
	if ('command' in obj && 'args' in obj) {
		yield { args: obj.args, command: obj.command };
	}
	for (const child of Object.values(obj)) yield* walkJson(child);
}

function findFirstPackageArg(args: readonly unknown[]): null | string {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (typeof arg !== 'string') continue;
		if (isFlag(arg)) continue;
		return arg;
	}
	return null;
}

function findJsonMatches(content: string): Match[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return [];
	}
	const matches: Match[] = [];
	for (const host of walkJson(parsed)) {
		const launcher = getLauncher(host.command);
		if (launcher === null) continue;
		if (!Array.isArray(host.args)) continue;
		const target = findFirstPackageArg(host.args);
		if (target === null) continue;
		if (isPinned(target)) continue;
		const line = lineForJsonPath(content, JSON.stringify(target));
		matches.push({
			evidence: `${launcher} ${target}`,
			launcher,
			line,
			target,
		});
	}
	return matches;
}

const INLINE_PATTERN =
	/\b(npx|bunx|uvx|pipx)(?:\s+run)?\s+(?:(?:-[A-Za-z]\S*|--[A-Za-z][\w-]*(?:=\S+)?)\s+)*((?:@[\w.-]+\/)?[\w.-]+(?:@[\w.+~-]+)?(?:==[\w.+~-]+)?)/g;

function findInlineMatches(content: string): Match[] {
	const matches: Match[] = [];
	const lines = content.split(/\r?\n/);
	const seen = new Set<string>();
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		INLINE_PATTERN.lastIndex = 0;
		let m: null | RegExpExecArray;
		while ((m = INLINE_PATTERN.exec(line)) !== null) {
			const launcher = m[1] as Launcher;
			const target = m[2] ?? '';
			if (target.length === 0) continue;
			if (LAUNCHER_FLAGS.has(target)) continue;
			if (isPinned(target)) continue;
			const key = `${launcher}::${target}::${i + 1}`;
			if (seen.has(key)) continue;
			seen.add(key);
			matches.push({
				evidence: line.trim().slice(0, 240),
				launcher,
				line: i + 1,
				target,
			});
		}
	}
	return matches;
}

const TOML_COMMAND_PATTERN = /\bcommand\s*=\s*"([^"]+)"/i;
const TOML_ARGS_PATTERN = /\bargs\s*=\s*\[([^\]]*)\]/i;

/**
 * TOML configs (e.g. Codex `config.toml`) put `command` and `args` on separate
 * lines under an `[mcp_servers.<name>]` table. JSON parsing fails and inline
 * matching sees only the command without the args. This matcher pairs a
 * `command = "npx"` line with the nearest `args = [...]` line within the same
 * TOML table block.
 */
function findTomlMatches(content: string): Match[] {
	const matches: Match[] = [];
	const lines = content.split(/\r?\n/);
	const seen = new Set<string>();
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const cmdMatch = TOML_COMMAND_PATTERN.exec(line);
		if (cmdMatch === null) continue;
		const launcher = getLauncher(cmdMatch[1] ?? '');
		if (launcher === null) continue;
		// Search the next few lines for the args array within the same table.
		for (let j = i; j < Math.min(i + 10, lines.length); j++) {
			const candidate = lines[j] ?? '';
			if (j > i && /^\[/.test(candidate.trim())) break; // next table starts
			const argsMatch = TOML_ARGS_PATTERN.exec(candidate);
			if (argsMatch === null) continue;
			const rawArgs = argsMatch[1] ?? '';
			const args = rawArgs.split(',').map((a) => a.trim().replace(/^["']|["']$/g, ''));
			const target = findFirstPackageArg(args);
			if (target === null) break;
			if (isPinned(target)) break;
			const key = `${launcher}::${target}::${j + 1}`;
			if (seen.has(key)) break;
			seen.add(key);
			matches.push({
				evidence: candidate.trim().slice(0, 240),
				launcher,
				line: j + 1,
				target,
			});
			break;
		}
	}
	return matches;
}

function findMatches(content: string): Match[] {
	const json = findJsonMatches(content);
	if (json.length > 0) return json;
	const toml = findTomlMatches(content);
	if (toml.length > 0) return toml;
	return findInlineMatches(content);
}

function buildFinding(artifact: Artifact, match: Match): Finding {
	const signals: readonly string[] = [Signal.UnpinnedExecution];
	return {
		confidence: 'medium',
		evidence: `[${match.launcher}] ${match.evidence}`,
		file: artifact.path,
		group: 'local-execution-bridges',
		id: `agent.unpinned-execution-bridge:${artifact.path}:${match.launcher}:${match.target}:${match.line}`,
		line: match.line,
		recommendation: RECOMMENDATION,
		ruleId: 'agent.unpinned-execution-bridge',
		score: computeScore(signals),
		severity: computeSeverity(signals),
		signals,
		source: artifact.source,
		title: `Unpinned ${match.launcher} launcher for "${match.target}"`,
	};
}

export const unpinnedExecutionBridgeRule: Rule = {
	description:
		'Flags MCP configs and tool manifests that launch packages via npx, ' +
		'bunx, uvx, or pipx without pinning a specific version. Unpinned ' +
		'launchers resolve to the latest registry release at run time, so a ' +
		'hijacked or republished package can introduce new code with no review.',
	group: 'local-execution-bridges',
	id: 'agent.unpinned-execution-bridge',
	async scan(ctx: RuleContext): Promise<Finding[]> {
		const findings: Finding[] = [];
		for (const artifact of ctx.artifacts) {
			if (!IN_SCOPE.has(artifact.type)) continue;
			for (const match of findMatches(artifact.content)) {
				findings.push(buildFinding(artifact, match));
			}
		}
		return findings;
	},
	title: 'Unpinned execution bridge',
};
