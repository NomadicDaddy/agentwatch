import { describe, expect, test } from 'bun:test';

import {
	computeScore,
	computeSeverity,
	explainScore,
	shouldEscalateToCritical,
	Signal,
} from '../../src/rules/scoring.ts';
import { severityFromScore } from '../../src/rules/types.ts';

describe('composite scoring engine', () => {
	test('sums signal contributions', () => {
		expect(computeScore([Signal.RemoteEndpoint])).toBe(35);
		expect(computeScore([Signal.RemoteEndpoint, Signal.DynamicRegistry])).toBe(65);
		expect(computeScore([Signal.UrlShortener, Signal.AdMarketing])).toBe(30);
	});

	test('unknown signals contribute zero without throwing', () => {
		expect(computeScore(['not-a-real-signal', Signal.Gateway])).toBe(30);
	});

	test('explainScore returns per-signal breakdown', () => {
		const breakdown = explainScore([Signal.RemoteEndpoint, Signal.CredentialReach]);
		expect(breakdown).toEqual([
			{ signal: 'remote-endpoint', score: 35 },
			{ signal: 'credential-reach', score: 20 },
		]);
	});

	test('severityFromScore matches spec.md boundaries', () => {
		expect(severityFromScore(0)).toBe('info');
		expect(severityFromScore(29)).toBe('info');
		expect(severityFromScore(30)).toBe('low');
		expect(severityFromScore(59)).toBe('low');
		expect(severityFromScore(60)).toBe('medium');
		expect(severityFromScore(89)).toBe('medium');
		expect(severityFromScore(90)).toBe('high');
		expect(severityFromScore(119)).toBe('high');
		expect(severityFromScore(120)).toBe('critical');
		expect(severityFromScore(-5)).toBe('info');
	});

	test('escalates to critical: remote-endpoint + credential-reach', () => {
		const signals = [Signal.RemoteEndpoint, Signal.CredentialReach];
		expect(shouldEscalateToCritical(signals)).toBe(true);
		expect(computeSeverity(signals)).toBe('critical');
	});

	test('escalates to critical: remote + dynamic + memory', () => {
		const signals = [Signal.RemoteEndpoint, Signal.DynamicRegistry, Signal.MemoryRequest];
		expect(computeSeverity(signals)).toBe('critical');
	});

	test('escalates to critical: remote + dynamic + local-execution', () => {
		const signals = [Signal.RemoteEndpoint, Signal.DynamicRegistry, Signal.LocalExecution];
		expect(computeSeverity(signals)).toBe('critical');
	});

	test('numeric severity used when no escalation triggers', () => {
		expect(computeSeverity([Signal.RemoteEndpoint])).toBe('low');
		expect(computeSeverity([Signal.RemoteEndpoint, Signal.Gateway])).toBe('medium');
	});
});
