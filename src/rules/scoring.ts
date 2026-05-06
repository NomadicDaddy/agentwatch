/**
 * Composite scoring engine.
 *
 * Rules emit a list of `Signal` labels. Each signal carries a deterministic
 * point contribution; the sum maps to a `Severity` bucket via
 * {@link severityFromScore}. Certain signal combinations escalate the result
 * to `critical` regardless of numeric score (see {@link computeSeverity}).
 *
 * Per spec.md "Scoring":
 *   +35 remote endpoint, +30 gateway/dynamic, +25 memory/trigger/execution,
 *   +20 shortener/unpinned/credential, +15 vendor/broad, +10 ad.
 */

import { severityFromScore, type Severity } from './types.ts';

/** Stable signal labels recorded on findings. */
export const Signal = {
	AdMarketing: 'ad-marketing',
	BroadWording: 'broad-wording',
	CredentialReach: 'credential-reach',
	DynamicRegistry: 'dynamic-registry',
	Gateway: 'gateway',
	LocalExecution: 'local-execution',
	MemoryRequest: 'memory-request',
	RemoteEndpoint: 'remote-endpoint',
	TriggerInvocation: 'trigger-invocation',
	UnpinnedExecution: 'unpinned-execution',
	UrlShortener: 'url-shortener',
	VendorHosted: 'vendor-hosted',
} as const;

export type Signal = (typeof Signal)[keyof typeof Signal];

/** Per-signal score contribution. Unknown signals contribute 0. */
export const SIGNAL_SCORES: Readonly<Record<Signal, number>> = Object.freeze({
	[Signal.AdMarketing]: 10,
	[Signal.BroadWording]: 15,
	[Signal.CredentialReach]: 20,
	[Signal.DynamicRegistry]: 30,
	[Signal.Gateway]: 30,
	[Signal.LocalExecution]: 25,
	[Signal.MemoryRequest]: 25,
	[Signal.RemoteEndpoint]: 35,
	[Signal.TriggerInvocation]: 25,
	[Signal.UnpinnedExecution]: 20,
	[Signal.UrlShortener]: 20,
	[Signal.VendorHosted]: 15,
});

/** Individual signal contribution returned by {@link explainScore}. */
export interface SignalContribution {
	readonly score: number;
	readonly signal: string;
}

/**
 * Sum the score contributions of the given signals.
 *
 * Duplicate signals each count once — callers should pass a distinct set.
 * Unknown signal labels contribute 0 (no throw, no warning); rules are the
 * authoritative source of label vocabulary.
 */
export function computeScore(signals: readonly string[]): number {
	let total = 0;
	for (const signal of signals) {
		total += SIGNAL_SCORES[signal as Signal] ?? 0;
	}
	return total;
}

/**
 * Return per-signal contributions in the order the caller supplied them.
 * Useful for explainable findings ("which signals drove this score").
 */
export function explainScore(signals: readonly string[]): SignalContribution[] {
	return signals.map((signal) => ({
		score: SIGNAL_SCORES[signal as Signal] ?? 0,
		signal,
	}));
}

/**
 * Critical-escalation combinations. A finding hits `critical` regardless of
 * numeric score when any of these signal sets are all present.
 *
 * Per spec / feature.json:
 *   - remote endpoint + dynamic registry + memory request
 *   - remote endpoint + dynamic registry + local execution
 *   - remote endpoint + credential reach
 */
const CRITICAL_ESCALATIONS: readonly (readonly Signal[])[] = [
	[Signal.RemoteEndpoint, Signal.DynamicRegistry, Signal.MemoryRequest],
	[Signal.RemoteEndpoint, Signal.DynamicRegistry, Signal.LocalExecution],
	[Signal.RemoteEndpoint, Signal.CredentialReach],
];

function hasAll(present: ReadonlySet<string>, required: readonly Signal[]): boolean {
	for (const signal of required) {
		if (!present.has(signal)) return false;
	}
	return true;
}

/** True when the signals trigger any auto-critical combination. */
export function shouldEscalateToCritical(signals: readonly string[]): boolean {
	const present = new Set<string>(signals);
	return CRITICAL_ESCALATIONS.some((combo) => hasAll(present, combo));
}

/**
 * Resolve final severity for a finding: numeric mapping plus escalation.
 *
 * Always prefers `critical` when an escalation combination is present, even
 * if the numeric total would otherwise fall in a lower bucket.
 */
export function computeSeverity(signals: readonly string[]): Severity {
	if (shouldEscalateToCritical(signals)) return 'critical';
	return severityFromScore(computeScore(signals));
}
