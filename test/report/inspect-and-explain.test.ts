import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

interface CliResult {
	readonly exitCode: null | number;
	readonly stderr: string;
	readonly stdout: string;
}

interface JsonFinding {
	readonly ruleId: string;
	readonly severity: string;
	readonly signals: readonly string[];
}

interface JsonFindingGroup {
	readonly findings: readonly JsonFinding[];
}

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
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
const BENIGN_MCP_FIXTURE = resolve(PROJECT_ROOT, 'test', 'fixtures', 'focused', 'benign-mcp.json');
const DISJOINT_FIXTURE = resolve(
	PROJECT_ROOT,
	'test',
	'fixtures',
	'focused',
	'disjoint-clusters.json'
);
const MALFORMED_ENV_FIXTURE = resolve(
	PROJECT_ROOT,
	'test',
	'fixtures',
	'focused',
	'malformed.env.production.json'
);
const AWS_ACCESS_KEY_ID = ['AKIA', '1234567890ABCDEF'].join('');
const GITHUB_TOKEN = ['github', '_pat_', 'focusedInspectionSecret1234567890'].join('');
const CRITICAL_CORRELATION_RULE_ID = 'agent.critical-signal-combination';
const MCP_RULE_IDS: readonly string[] = [
	'agent.dynamic-tool-registry',
	'agent.local-execution-bridge',
	'agent.remote-capability',
	'agent.remote-manifest',
	'agent.unpinned-execution-bridge',
];
const SKILL_RULE_IDS: readonly string[] = [
	'agent.broad-tool-surface',
	'agent.credential-file-reference',
	'agent.memory-context-request',
	'agent.trigger-based-invocation',
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
	test('inspect-skill runs exactly the four focused rule families below medium', () => {
		const result = runCli(['inspect-skill', SKILL_FIXTURE, '--json']);
		const report = JSON.parse(result.stdout) as {
			readonly findings: readonly JsonFindingGroup[];
		};
		const allFindings = report.findings.flatMap((group) => group.findings);
		const ruleIds = [...new Set(allFindings.map((finding) => finding.ruleId))].sort();

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe('');
		expect(ruleIds).toEqual([...SKILL_RULE_IDS]);
		expect(allFindings.every((finding) => finding.severity === 'info')).toBe(true);
	});

	test('inspect-skill returns exit code 2 for an unreadable file', () => {
		const result = runCli(['inspect-skill', '__missing-skill__.md']);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe('');
		expect(result.stderr).toContain('inspect-skill: cannot read');
	});

	test('focused inspection masks sensitive paths in read and parse errors', () => {
		const skillTail = `private-key-${GITHUB_TOKEN}.md`;
		const awsTail = `credentials-${AWS_ACCESS_KEY_ID}.json`;
		const missingSkill = `.ssh/${skillTail}`;
		const missingMcp = ['.aws', awsTail].join('\\');

		const skillReadError = runCli(['inspect-skill', missingSkill]);
		const mcpReadError = runCli(['inspect-mcp', missingMcp]);
		const mcpParseError = runCli(['inspect-mcp', MALFORMED_ENV_FIXTURE]);

		expect(skillReadError.exitCode).toBe(2);
		expect(skillReadError.stdout).toBe('');
		expect(skillReadError.stderr).toContain('inspect-skill: cannot read');
		expect(skillReadError.stderr).toContain('.ssh');
		expect(skillReadError.stderr).toContain('***');
		expect(skillReadError.stderr).not.toContain(skillTail);
		expect(skillReadError.stderr).not.toContain(GITHUB_TOKEN);

		expect(mcpReadError.exitCode).toBe(2);
		expect(mcpReadError.stdout).toBe('');
		expect(mcpReadError.stderr).toContain('inspect-mcp: cannot read');
		expect(mcpReadError.stderr).toContain('.aws');
		expect(mcpReadError.stderr).toContain('***');
		expect(mcpReadError.stderr).not.toContain(awsTail);
		expect(mcpReadError.stderr).not.toContain(AWS_ACCESS_KEY_ID);

		expect(mcpParseError.exitCode).toBe(2);
		expect(mcpParseError.stdout).toBe('');
		expect(mcpParseError.stderr).toContain('is not valid JSON');
		expect(mcpParseError.stderr).toContain('malformed.env.p***');
		expect(mcpParseError.stderr).not.toContain('malformed.env.production.json');
	});

	test('inspect-mcp correlates signals and explain covers the same registered MCP rules', () => {
		const result = runCli(['inspect-mcp', MCP_FIXTURE, '--json']);
		const report = JSON.parse(result.stdout) as {
			readonly findings: readonly JsonFindingGroup[];
		};
		const allFindings = report.findings.flatMap((group) => group.findings);
		const ruleIds = [...new Set(allFindings.map((finding) => finding.ruleId))].sort();
		const critical = allFindings.filter(
			(finding) => finding.ruleId === CRITICAL_CORRELATION_RULE_ID
		);

		// The bad-actor fixture unions remote-endpoint + dynamic-registry +
		// local-execution within one artifact, so focused inspection must
		// synthesize the critical correlation (parity with `scan`) and exit 1.
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe('');
		expect(critical).toHaveLength(1);
		expect(critical[0]?.severity).toBe('critical');
		expect(critical[0]?.signals).toEqual(
			expect.arrayContaining(['dynamic-registry', 'local-execution', 'remote-endpoint'])
		);
		// The five focused rule ids remain present alongside the correlation.
		const focusedRuleIds = ruleIds.filter((id) => id !== CRITICAL_CORRELATION_RULE_ID);
		expect(focusedRuleIds).toEqual([...MCP_RULE_IDS]);

		for (const ruleId of [...focusedRuleIds, CRITICAL_CORRELATION_RULE_ID]) {
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

	test('explain recognizes correlated critical findings from the shipped CLI', () => {
		const result = runCli(['explain', 'agent.critical-signal-combination']);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('Rule:  agent.critical-signal-combination');
		expect(result.stdout).toContain('Review the constituent findings as one capability chain');
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
		const inspectClean = runCli(['inspect-mcp', BENIGN_MCP_FIXTURE, '--json']);
		const inspectCritical = runCli(['inspect-mcp', MCP_FIXTURE, '--json']);
		const inspectReadError = runCli(['inspect-mcp', '__missing-mcp-config__.json']);
		const explainSuccess = runCli(['explain', MCP_RULE_IDS[0] ?? '']);
		const explainUnknown = runCli(['explain', 'agent.unknown-rule']);

		// Benign config: only a sub-medium info finding → exit 0.
		expect(inspectClean.exitCode).toBe(0);
		// Bad-actor config: correlated critical → exit 1 (≥ medium threshold).
		expect(inspectCritical.exitCode).toBe(1);
		expect(inspectReadError.exitCode).toBe(2);
		expect(inspectReadError.stderr).toContain('inspect-mcp: cannot read');
		expect(explainSuccess.exitCode).toBe(0);
		expect(explainUnknown.exitCode).toBe(1);
		expect(explainUnknown.stderr).toContain('explain: no explanation registered');
	});

	test('inspect-mcp does not combine signals from disjoint clusters in one file', () => {
		// The disjoint fixture places a remote endpoint near the top and a
		// dynamic-registry + local-execution cluster ~60 lines below. Each
		// cluster is sub-critical on its own, and the proximity guard must keep
		// them separate so no synthetic critical is synthesized.
		const result = runCli(['inspect-mcp', DISJOINT_FIXTURE, '--json']);
		const report = JSON.parse(result.stdout) as {
			readonly findings: readonly JsonFindingGroup[];
		};
		const allFindings = report.findings.flatMap((group) => group.findings);
		const critical = allFindings.filter(
			(finding) => finding.ruleId === CRITICAL_CORRELATION_RULE_ID
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe('');
		expect(critical).toHaveLength(0);
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
