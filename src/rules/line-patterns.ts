export interface LinePatternSpec<TKind extends string> {
	readonly kind: TKind;
	readonly pattern: RegExp;
}

export type LinePatternMatch<
	TKind extends string,
	TSpec extends LinePatternSpec<TKind> = LinePatternSpec<TKind>,
> = Readonly<
	Omit<TSpec, 'pattern'> & {
		readonly evidence: string;
		readonly line: number;
	}
>;

/**
 * Match pattern specs against individual lines while retaining rule metadata.
 * A pattern kind can match once per line, including on multiple distinct lines.
 */
export function findLinePatternMatches<TKind extends string, TSpec extends LinePatternSpec<TKind>>(
	content: string,
	patterns: readonly TSpec[]
): LinePatternMatch<TKind, TSpec>[] {
	const matches: LinePatternMatch<TKind, TSpec>[] = [];
	const seen = new Set<string>();
	const lines = content.split(/\r?\n/);

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? '';
		const lineNumber = index + 1;
		for (const spec of patterns) {
			const key = `${spec.kind}:${lineNumber}`;
			if (seen.has(key)) continue;

			const { pattern, ...metadata } = spec;
			if (pattern.test(line)) {
				seen.add(key);
				matches.push({
					...metadata,
					evidence: line.trim().slice(0, 240),
					line: lineNumber,
				});
			}
		}
	}

	return matches;
}
