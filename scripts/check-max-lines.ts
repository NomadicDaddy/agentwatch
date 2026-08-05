import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { cwd, exit } from 'node:process';

/** Enforce the hard 300-line contract across maintained production TypeScript. */
const MAX_LINES = 300;
const SCANNED_ROOTS = ['src', 'scripts'];
const SKIPPED_DIRECTORIES = new Set(['build', 'dist', 'node_modules', 'snapshots']);

interface Finding {
	file: string;
	lines: number;
}

function isScannedFile(path: string): boolean {
	return /\.(?:ts|tsx)$/i.test(path) && !path.endsWith('.d.ts');
}

async function collectFiles(path: string): Promise<string[]> {
	const info = await stat(path);
	if (info.isFile()) return isScannedFile(path) ? [path] : [];
	const entries = await readdir(path, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
		const child = join(path, entry.name);
		if (entry.isDirectory()) files.push(...(await collectFiles(child)));
		else if (entry.isFile() && isScannedFile(child)) files.push(child);
	}
	return files;
}

function countLines(text: string): number {
	if (text.length === 0) return 0;
	const withoutTrailingNewline = text.endsWith('\n') ? text.slice(0, -1) : text;
	return withoutTrailingNewline.split(/\r?\n/).length;
}

export async function runCheckMaxLines(projectRoot = cwd()): Promise<number> {
	const findings: Finding[] = [];
	for (const root of SCANNED_ROOTS) {
		const files = await collectFiles(join(projectRoot, root));
		for (const file of files) {
			const lines = countLines(await readFile(file, 'utf8'));
			if (lines > MAX_LINES) {
				findings.push({ file: relative(projectRoot, file).split(sep).join('/'), lines });
			}
		}
	}

	if (findings.length === 0) {
		console.log(`max-lines check passed (no production file exceeds ${MAX_LINES} lines).`);
		return 0;
	}

	findings.sort((left, right) => right.lines - left.lines);
	console.error(`max-lines check failed: ${findings.length} file(s) exceed ${MAX_LINES} lines.`);
	console.error('Split oversized files into cohesive facade and implementation modules.');
	for (const finding of findings) {
		console.error(`- ${finding.file}:${finding.lines} (max ${MAX_LINES})`);
	}
	return 1;
}

if (import.meta.main) exit(await runCheckMaxLines());
