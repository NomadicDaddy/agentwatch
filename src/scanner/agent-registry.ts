/**
 * Registry facade for supported AI-agent surfaces.
 *
 * Path templates use literal tokens resolved by target discovery: `~` for the user home,
 * `%APPDATA%` for Windows roaming app data, and `./` for the working directory.
 */

import { AGENTS } from './agent-registry-data.ts';

export type AgentPlatform = 'darwin' | 'linux' | 'win32';

export interface AgentPaths {
	cwd: readonly string[];
	darwin: readonly string[];
	linux: readonly string[];
	win32: readonly string[];
}

export interface AgentInfo {
	/** Human-readable name for reports. */
	readonly displayName: string;
	/** Specific filenames to inspect inside discovered roots. */
	readonly knownFiles: readonly string[];
	/** Canonical identifier used by `--agent <name>`. */
	readonly name: string;
	/** Platform-specific roots and CWD-relative roots to probe. */
	readonly paths: AgentPaths;
}

const AGENT_INDEX: ReadonlyMap<string, AgentInfo> = new Map(
	AGENTS.map((agent) => [agent.name, agent])
);

/** All registered agents, in stable display order. */
export function getAllAgents(): readonly AgentInfo[] {
	return AGENTS;
}

/** Lookup by canonical `--agent` name. Case-insensitive; undefined when unknown. */
export function getAgentByName(name: string): AgentInfo | undefined {
	return AGENT_INDEX.get(name.toLowerCase());
}

/** All supported `--agent` values, useful for CLI validation and help text. */
export function getSupportedAgentNames(): readonly string[] {
	return AGENTS.map((agent) => agent.name);
}

/** True when `name` is a recognized `--agent` value. */
export function isSupportedAgent(name: string): boolean {
	return AGENT_INDEX.has(name.toLowerCase());
}
