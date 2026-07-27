/**
 * Classify a discovered file into one of the 8 artifact types defined in spec.md.
 *
 * Filename-based checks run first (most precise), then content-based heuristics.
 * Returns `null` when no signal matches — callers should skip unclassified files
 * rather than fall back to a default type.
 */

import path from 'node:path';

import type { ArtifactType } from '../rules/types.ts';

export interface ClassifyInput {
	readonly content: string;
	readonly filename: string;
	readonly parentDir: string;
}

const SKILL_FILES = new Set(['skill.md', 'skill.yaml', 'skill.yml', 'skill.json']);
const MCP_FILES = new Set(['mcp.json', '.mcp.json']);
const AGENT_INSTRUCTION_FILES = new Set([
	'agents.md',
	'claude.md',
	'cursor.md',
	'windsurf.md',
	'copilot-instructions.md',
	'.cursorrules',
	'.windsurfrules',
	'.clinerules',
]);

/** Return true if any path segment of `dir` matches a directory name (case-insensitive). */
function hasSegment(dir: string, names: readonly string[]): boolean {
	const segments = dir.split(/[\\/]/).map((s) => s.toLowerCase());
	return names.some((name) => segments.includes(name));
}

function looksLikeMcpConfig(content: string): boolean {
	if (/"mcpServers"\s*:/.test(content)) return true;
	// TOML: Codex uses `[mcp_servers.<name>]` tables with optional `[mcpServers]` bracket.
	return /\[(?:mcp_servers|mcpServers)\b/.test(content);
}

function looksLikeToolManifest(content: string): boolean {
	if (/"tools"\s*:\s*\[/.test(content)) return true;
	if (/"commands"\s*:\s*\[/.test(content)) return true;
	if (/"plugins"\s*:\s*\[/.test(content)) return true;
	return /"toolSchema"|"commandRegistry"/.test(content);
}

function looksLikeConnectorConfig(content: string): boolean {
	return /"connectors?"\s*:|"oauth"\s*:|\boauth_token\b|\bclient_id\b/i.test(content);
}

function looksLikePermissionConfig(content: string): boolean {
	return /"permissions?"\s*:|"approvals?"\s*:|"allowlist"\s*:|"allowedTools"\s*:|"autoApprove"\s*:/i.test(
		content
	);
}

function looksLikeMemoryConfig(content: string): boolean {
	return /"memory"\s*:|"profile"\s*:|"personalization"\s*:|"preferences"\s*:/i.test(content);
}

function looksLikeProvenance(content: string): boolean {
	const hasUrl = /"sourceUrl"\s*:|"homepage"\s*:|"repository"\s*:/i.test(content);
	const hasMeta = /"publisher"\s*:|"version"\s*:|"checksum"\s*:|"sha\d+"\s*:/i.test(content);
	return hasUrl && hasMeta;
}

export function classifyArtifact(input: ClassifyInput): ArtifactType | null {
	const filename = input.filename.toLowerCase();
	const parent = input.parentDir;
	const ext = path.extname(filename);
	const isMarkdown = ext === '.md';
	const isJson = ext === '.json';
	const isToml = ext === '.toml';

	if (SKILL_FILES.has(filename)) return 'skill';
	if (hasSegment(parent, ['skills', '.skills'])) return 'skill';

	if (MCP_FILES.has(filename)) return 'mcp-config';

	if (AGENT_INSTRUCTION_FILES.has(filename)) return 'agent-instruction';
	if (isMarkdown && hasSegment(parent, ['rules', 'instructions'])) return 'agent-instruction';

	if (isJson) {
		if (looksLikeMcpConfig(input.content)) return 'mcp-config';
		if (looksLikeToolManifest(input.content)) return 'tool-manifest';
		if (looksLikeConnectorConfig(input.content)) return 'connector-config';
		if (looksLikePermissionConfig(input.content)) return 'permission-config';
		if (looksLikeMemoryConfig(input.content)) return 'memory-config';
		if (looksLikeProvenance(input.content)) return 'provenance';
	}

	if (isToml) {
		if (looksLikeMcpConfig(input.content)) return 'mcp-config';
	}

	return null;
}
