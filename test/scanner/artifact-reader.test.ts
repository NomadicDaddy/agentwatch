import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { AgentSource } from '../../src/scanner/targets.ts';

import { DEFAULT_MAX_FILE_BYTES, readArtifacts } from '../../src/scanner/artifact-reader.ts';

let fixtureRoot: string;

function source(root: string): AgentSource {
	return { agent: 'custom', customPath: true, root };
}

beforeEach(async () => {
	fixtureRoot = await mkdtemp(join(tmpdir(), 'agentwatch-artifact-reader-'));
});

afterEach(async () => {
	await rm(fixtureRoot, { force: true, recursive: true });
});

describe('artifact reader boundaries', () => {
	test('enforces configured and default artifact size limits', async () => {
		const smallFile = join(fixtureRoot, 'AGENTS.md');
		const oversizedFile = join(fixtureRoot, 'CLAUDE.md');
		await writeFile(smallFile, '# Small\n');
		await writeFile(oversizedFile, 'x'.repeat(64));

		const constrained = await readArtifacts([source(fixtureRoot)], { maxFileBytes: 32 });
		expect(constrained.map((artifact) => basename(artifact.path))).toEqual(['AGENTS.md']);

		const defaultSizedFile = join(fixtureRoot, 'default-limit.json');
		await writeFile(defaultSizedFile, 'x'.repeat(DEFAULT_MAX_FILE_BYTES + 1));
		const defaults = await readArtifacts([source(defaultSizedFile)]);
		expect(defaults).toEqual([]);
	});

	test('skips binary and text artifacts containing NUL bytes', async () => {
		await writeFile(join(fixtureRoot, 'AGENTS.md'), Buffer.from([0, 1, 2, 3]));
		await writeFile(join(fixtureRoot, 'CLAUDE.md'), '# Instructions\u0000hidden');
		await writeFile(join(fixtureRoot, 'safe.json'), '{"mcpServers": {}}');

		const artifacts = await readArtifacts([source(fixtureRoot)]);

		expect(artifacts.map((artifact) => basename(artifact.path))).toEqual(['safe.json']);
	});

	test('excludes artifacts under every ignored directory', async () => {
		for (const ignored of ['node_modules', '.git', 'dist', 'build']) {
			const ignoredRoot = join(fixtureRoot, ignored, 'nested');
			await mkdir(ignoredRoot, { recursive: true });
			await writeFile(join(ignoredRoot, 'AGENTS.md'), '# Ignored\n');
		}
		await writeFile(join(fixtureRoot, 'AGENTS.md'), '# Included\n');

		const artifacts = await readArtifacts([source(fixtureRoot)]);

		expect(artifacts.map((artifact) => basename(artifact.path))).toEqual(['AGENTS.md']);
	});

	test('rejects direct and descendant symbolic-link boundaries', async () => {
		const scanRoot = join(fixtureRoot, 'scan');
		const outsideRoot = join(fixtureRoot, 'outside');
		const outsideFile = join(outsideRoot, 'AGENTS.md');
		await mkdir(scanRoot);
		await mkdir(outsideRoot);
		await writeFile(join(scanRoot, 'CLAUDE.md'), '# Included\n');
		await writeFile(outsideFile, '# Outside\n');

		const directFileLink = join(fixtureRoot, 'direct-file.md');
		const directDirectoryLink = join(fixtureRoot, 'direct-directory');
		await symlink(outsideFile, directFileLink, 'file');
		await symlink(outsideRoot, directDirectoryLink, 'dir');
		await symlink(outsideFile, join(scanRoot, 'linked-file.md'), 'file');
		await symlink(outsideRoot, join(scanRoot, 'linked-directory'), 'dir');

		const artifacts = await readArtifacts([
			source(directFileLink),
			source(directDirectoryLink),
			source(scanRoot),
		]);

		expect(artifacts.map((artifact) => basename(artifact.path))).toEqual(['CLAUDE.md']);
	});

	test('skips missing roots and files removed after discovery without throwing', async () => {
		const disappearingFile = join(fixtureRoot, 'AGENTS.md');
		await writeFile(disappearingFile, '# Disappearing\n');

		const artifacts = await readArtifacts(
			[source(fixtureRoot), source(join(fixtureRoot, 'missing'))],
			{
				onSource: (scannedSource) => {
					if (scannedSource.root === fixtureRoot) rmSync(disappearingFile);
				},
			}
		);

		expect(artifacts).toEqual([]);
	});
});
