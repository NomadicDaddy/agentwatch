import { describe, expect, test } from 'bun:test';

import type { Finding } from '../../src/rules/types.ts';

import { computeScore, Signal } from '../../src/rules/scoring.ts';
import {
	correlateFindings,
	CRITICAL_CORRELATION_RULE_ID,
} from '../../src/scanner/finding-correlation.ts';
import { makeSource } from '../helpers.ts';

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
});
