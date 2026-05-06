/**
 * Artifact reader.
 *
 * Walks each `AgentSource` root, picks up files that look like agent artifacts
 * (markdown, json, yaml, toml), classifies each via `classifyArtifact`, and
 * returns the `Artifact[]` consumed by rules.
 *
 * Read-only and non-throwing: unreadable, oversized, or binary files are
 * silently skipped. Symlinks are not followed.
 */

import fastGlob from 'fast-glob';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Artifact } from '../rules/types.ts';
import type { AgentSource } from './targets.ts';

import { classifyArtifact } from './classify.ts';

/** Default cap on file size that the reader will load into memory. */
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

const GLOB_PATTERNS: readonly string[] = [
	'**/*.md',
	'**/*.json',
	'**/*.toml',
	'**/*.yaml',
	'**/*.yml',
	'**/.*rules',
];

const IGNORE_PATTERNS: readonly string[] = [
	'**/node_modules/**',
	'**/.git/**',
	'**/dist/**',
	'**/build/**',
];

const NUL_BYTE = String.fromCharCode(0);

export interface ReadArtifactsOptions {
	/** Maximum file size to read, in bytes. Larger files are skipped. */
	readonly maxFileBytes?: number;
	/** Optional callback invoked after each source root finishes globbing. */
	readonly onSource?: (source: AgentSource, fileCount: number) => void;
}

function looksBinary(content: string): boolean {
	return content.includes(NUL_BYTE);
}

async function readSingleFile(
	absPath: string,
	maxBytes: number
): Promise<{ content: string } | null> {
	let info;
	try {
		info = await stat(absPath);
	} catch {
		return null;
	}
	if (!info.isFile()) return null;
	if (info.size > maxBytes) return null;

	let content: string;
	try {
		content = await readFile(absPath, 'utf8');
	} catch {
		return null;
	}
	if (looksBinary(content)) return null;
	return { content };
}

async function listFilesUnderRoot(root: string): Promise<string[]> {
	let info;
	try {
		info = await stat(root);
	} catch {
		return [];
	}
	if (info.isFile()) return [root];
	if (!info.isDirectory()) return [];

	try {
		return await fastGlob([...GLOB_PATTERNS], {
			absolute: true,
			cwd: root,
			dot: true,
			followSymbolicLinks: false,
			ignore: [...IGNORE_PATTERNS],
			onlyFiles: true,
			suppressErrors: true,
		});
	} catch {
		return [];
	}
}

/**
 * Read all classifiable artifacts under the given agent sources.
 *
 * Files that exceed `maxFileBytes`, look binary, or fail to read are skipped
 * silently. Files that match the glob set but fail classification are also
 * skipped — the classifier returns `null` for unrecognized files and we do
 * not invent a default `ArtifactType`.
 */
export async function readArtifacts(
	sources: readonly AgentSource[],
	options: ReadArtifactsOptions = {}
): Promise<Artifact[]> {
	const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
	const artifacts: Artifact[] = [];
	const seen = new Set<string>();

	for (const source of sources) {
		const files = await listFilesUnderRoot(source.root);
		options.onSource?.(source, files.length);
		for (const file of files) {
			const key = `${source.agent}::${file}`;
			if (seen.has(key)) continue;
			seen.add(key);

			const read = await readSingleFile(file, maxBytes);
			if (!read) continue;

			const type = classifyArtifact({
				content: read.content,
				filename: path.basename(file),
				parentDir: path.dirname(file),
			});
			if (!type) continue;

			artifacts.push({
				content: read.content,
				path: file,
				source,
				type,
			});
		}
	}

	return artifacts;
}
