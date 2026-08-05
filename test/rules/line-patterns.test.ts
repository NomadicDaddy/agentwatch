import { describe, expect, test } from 'bun:test';

import { findLinePatternMatches, type LinePatternSpec } from '../../src/rules/line-patterns.ts';
import { Signal } from '../../src/rules/scoring.ts';

type TestKind = 'remote-endpoint';

interface TestPattern extends LinePatternSpec<TestKind> {
	readonly signal: Signal;
	readonly title: string;
}

const PATTERNS: readonly TestPattern[] = [
	{
		kind: 'remote-endpoint',
		pattern: /endpoint/i,
		signal: Signal.RemoteEndpoint,
		title: 'Remote endpoint declared',
	},
	{
		kind: 'remote-endpoint',
		pattern: /https:\/\//i,
		signal: Signal.Gateway,
		title: 'Fallback endpoint pattern',
	},
];

describe('findLinePatternMatches', () => {
	test('retains same-kind matches on distinct lines', () => {
		const matches = findLinePatternMatches(
			'endpoint https://one.example\nendpoint https://two.example',
			PATTERNS
		);

		expect(matches.map(({ line }) => line)).toEqual([1, 2]);
	});

	test('collapses duplicate same-kind matches on one line', () => {
		const matches = findLinePatternMatches('endpoint https://one.example', PATTERNS);

		expect(matches).toHaveLength(1);
		expect(matches[0]?.title).toBe('Remote endpoint declared');
	});

	test('preserves rule-specific metadata and evidence', () => {
		const matches = findLinePatternMatches('  endpoint https://one.example  ', PATTERNS);

		expect(matches[0]).toEqual({
			evidence: 'endpoint https://one.example',
			kind: 'remote-endpoint',
			line: 1,
			signal: Signal.RemoteEndpoint,
			title: 'Remote endpoint declared',
		});
	});
});
