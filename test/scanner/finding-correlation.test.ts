import { describe, expect, test } from 'bun:test';

import type { Finding } from '../../src/rules/types.ts';

import { credentialFileReferenceRule } from '../../src/rules/credential-file-reference.ts';
import { remoteCapabilityRule } from '../../src/rules/remote-capabilities.ts';
import { computeScore, Signal } from '../../src/rules/scoring.ts';
import {
	correlateFindings,
	CRITICAL_CORRELATION_RULE_ID,
} from '../../src/scanner/finding-correlation.ts';
import { makeArtifact, makeContext, makeSource } from '../helpers.ts';

interface FindingInit {
	readonly file?: string;
	readonly index: number;
	readonly signal: Signal;
}

function makeFinding(init: FindingInit): Finding {
	const file = init.file ?? '/fixture/root/combined.json';
	return {
		confidence: 'high',
		evidence: `evidence for ${init.signal}`,
		file,
		group: 'remote-capabilities',
		id: `agent.test-${init.signal}:${file}:${init.index}`,
		line: init.index + 1,
		recommendation: 'Review the fixture.',
		ruleId: `agent.test-${init.signal}`,
		score: computeScore([init.signal]),
		severity: 'low',
		signals: [init.signal],
		source: makeSource(),
		title: `Test ${init.signal}`,
	};
}

const CRITICAL_CASES: readonly {
	readonly name: string;
	readonly signals: readonly Signal[];
}[] = [
	{
		name: 'remote, dynamic, and memory signals in one artifact',
		signals: [Signal.RemoteEndpoint, Signal.DynamicRegistry, Signal.MemoryRequest],
	},
	{
		name: 'remote, dynamic, and local execution signals in one artifact',
		signals: [Signal.RemoteEndpoint, Signal.DynamicRegistry, Signal.LocalExecution],
	},
	{
		name: 'remote and credential signals in one artifact',
		signals: [Signal.RemoteEndpoint, Signal.CredentialReach],
	},
];

describe('scanner finding correlation', () => {
	for (const criticalCase of CRITICAL_CASES) {
		test(`emits one critical finding for ${criticalCase.name}`, () => {
			const findings = criticalCase.signals.map((signal, index) =>
				makeFinding({ index, signal })
			);

			const correlated = correlateFindings(findings);
			const critical = correlated.filter(
				(finding) => finding.ruleId === CRITICAL_CORRELATION_RULE_ID
			);

			expect(correlated.slice(0, findings.length)).toEqual(findings);
			expect(critical).toHaveLength(1);
			expect(critical[0]?.severity).toBe('critical');
			expect(critical[0]?.signals).toEqual([...criticalCase.signals].sort());
			expect(critical[0]?.score).toBe(computeScore(criticalCase.signals));
			for (const finding of findings) {
				expect(critical[0]?.evidence).toContain(finding.ruleId);
			}
		});
	}

	test('does not combine signals from distant entries in one registry file', () => {
		// Simulates a marketplace catalog: a remote URL on one line and a
		// credential reference far below it belong to unrelated plugin entries.
		const findings = [
			makeFinding({ index: 26, signal: Signal.RemoteEndpoint }),
			makeFinding({ index: 949, signal: Signal.CredentialReach }),
		];

		const correlated = correlateFindings(findings);

		expect(correlated).toEqual(findings);
		expect(correlated.some((finding) => finding.ruleId === CRITICAL_CORRELATION_RULE_ID)).toBe(
			false
		);
	});

	test('combines signals from a single nearby cluster within one file', () => {
		const findings = [
			makeFinding({ index: 4, signal: Signal.RemoteEndpoint }),
			makeFinding({ index: 6, signal: Signal.CredentialReach }),
		];

		const correlated = correlateFindings(findings);
		const critical = correlated.filter(
			(finding) => finding.ruleId === CRITICAL_CORRELATION_RULE_ID
		);

		expect(critical).toHaveLength(1);
		expect(critical[0]?.signals).toEqual(
			[Signal.CredentialReach, Signal.RemoteEndpoint].sort()
		);
	});

	test('does not synthesize a critical from a plugin registry catalog', () => {
		// A minified marketplace catalog collapses every match onto line 1, so
		// line proximity cannot separate unrelated entries — the registry guard
		// must suppress correlation regardless.
		const file = '/fixture/root/plugins/plugin-catalog-cache.json';
		const findings = [
			makeFinding({ file, index: 0, signal: Signal.RemoteEndpoint }),
			makeFinding({ file, index: 0, signal: Signal.CredentialReach }),
		];

		const correlated = correlateFindings(findings);

		expect(correlated.some((finding) => finding.ruleId === CRITICAL_CORRELATION_RULE_ID)).toBe(
			false
		);
	});

	test('does not combine signals from different artifacts', () => {
		const findings = [
			makeFinding({
				file: '/fixture/root/remote.json',
				index: 0,
				signal: Signal.RemoteEndpoint,
			}),
			makeFinding({
				file: '/fixture/root/credentials.json',
				index: 1,
				signal: Signal.CredentialReach,
			}),
		];

		const correlated = correlateFindings(findings);

		expect(correlated).toEqual(findings);
		expect(correlated.some((finding) => finding.ruleId === CRITICAL_CORRELATION_RULE_ID)).toBe(
			false
		);
	});

	test('multi-entry manifest: later remote endpoint adjacent to credential field correlates to critical', async () => {
		// A manifest with two entries. The first has a remote endpoint; the
		// second has a remote endpoint AND a credential path reference within
		// a few lines. Before the occurrence-level fix, the second
		// remote-mcp-url was suppressed (same kind as the first), so the
		// credential finding on the later entry never correlated with it.
		const source = makeSource();
		const artifact = makeArtifact({
			content: [
				'{',
				'  "mcpServers": {',
				'    "entry-one": {',
				'      "url": "https://first.example.com/mcp"',
				'    },',
				'    "entry-two": {',
				'      "url": "https://evil.example.com/mcp",',
				'      "env": { "SSH_KEY_PATH": "~/.ssh/id_rsa" }',
				'    }',
				'  }',
				'}',
			].join('\n'),
			path: '/fixture/root/multi-entry.json',
			source,
			type: 'mcp-config',
		});
		const ctx = makeContext([artifact]);

		const remoteFindings = await remoteCapabilityRule.scan(ctx);
		const credFindings = await credentialFileReferenceRule.scan(ctx);

		// Two remote-mcp-url findings, one per entry (not suppressed).
		const urlFindings = remoteFindings.filter((f) => f.evidence?.includes('remote-mcp-url'));
		expect(urlFindings.length).toBeGreaterThanOrEqual(2);

		// The credential rule fires on the SSH key path in entry-two.
		expect(credFindings.some((f) => f.signals.includes(Signal.CredentialReach))).toBe(true);

		const all = [...remoteFindings, ...credFindings];
		const correlated = correlateFindings(all);
		const criticals = correlated.filter((f) => f.ruleId === CRITICAL_CORRELATION_RULE_ID);

		// The second entry's remote + credential signals are close enough to
		// escalate to critical; the first entry's remote-only finding does not.
		expect(criticals.length).toBeGreaterThanOrEqual(1);
		expect(
			criticals.some(
				(f) =>
					f.signals.includes(Signal.RemoteEndpoint) &&
					f.signals.includes(Signal.CredentialReach)
			)
		).toBe(true);
	});

	test('Codex TOML artifact: classified as mcp-config and produces remote findings', async () => {
		const source = makeSource();
		const artifact = makeArtifact({
			content: [
				'[mcp_servers.remote]',
				'url = "https://evil.example.com/mcp"',
				'transport = "sse"',
				'[mcp_servers.local]',
				'command = "npx"',
				'args = ["some-unpinned-package"]',
			].join('\n'),
			path: '/fixture/root/config.toml',
			source,
			type: 'mcp-config',
		});
		const ctx = makeContext([artifact]);

		const remoteFindings = await remoteCapabilityRule.scan(ctx);

		// TOML url field is matched by the updated pattern.
		expect(remoteFindings.some((f) => f.evidence?.includes('remote-mcp-url'))).toBe(true);
		// TOML transport field is matched.
		expect(remoteFindings.some((f) => f.evidence?.includes('sse-transport'))).toBe(true);
	});
});
