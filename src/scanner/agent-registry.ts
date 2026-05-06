/**
 * Registry of supported AI-agent surfaces.
 *
 * Path templates use literal tokens that the target-discovery layer resolves at scan time:
 *   - `~`         user home directory
 *   - `%APPDATA%` Windows roaming app data (CSIDL_APPDATA)
 *   - `./`        relative to the current working directory
 *
 * Paths are NOT resolved here. This module is a pure data registry.
 */

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
	/**
	 * Specific filenames the scanner should look for inside discovered roots
	 * (e.g. `claude_desktop_config.json`). Empty when discovery is purely
	 * directory-tree based.
	 */
	readonly knownFiles: readonly string[];
	/** Canonical identifier used by `--agent <name>`. */
	readonly name: string;
	/** Platform-specific roots and CWD-relative roots to probe. */
	readonly paths: AgentPaths;
}

const CLAUDE: AgentInfo = {
	displayName: 'Claude',
	knownFiles: ['claude_desktop_config.json', 'CLAUDE.md', 'settings.json'],
	name: 'claude',
	paths: {
		cwd: ['./.claude'],
		darwin: ['~/Library/Application Support/Claude', '~/.claude', '~/.claude.json'],
		linux: ['~/.config/Claude', '~/.claude', '~/.claude.json'],
		win32: ['%APPDATA%/Claude', '~/.claude', '~/.claude.json'],
	},
};

const CODEX: AgentInfo = {
	displayName: 'Codex',
	knownFiles: ['AGENTS.md', 'config.json', 'config.toml'],
	name: 'codex',
	paths: {
		cwd: ['./.codex', './AGENTS.md'],
		darwin: ['~/.codex'],
		linux: ['~/.codex'],
		win32: ['~/.codex'],
	},
};

const OPENCODE: AgentInfo = {
	displayName: 'OpenCode',
	knownFiles: ['config.json', 'opencode.json'],
	name: 'opencode',
	paths: {
		cwd: ['./.opencode'],
		darwin: ['~/.opencode'],
		linux: ['~/.opencode'],
		win32: ['~/.opencode'],
	},
};

const KILOCODE: AgentInfo = {
	displayName: 'KiloCode',
	knownFiles: ['config.json'],
	name: 'kilocode',
	paths: {
		cwd: ['./.kilocode'],
		darwin: ['~/.kilocode'],
		linux: ['~/.kilocode'],
		win32: ['~/.kilocode'],
	},
};

const CURSOR: AgentInfo = {
	displayName: 'Cursor',
	knownFiles: ['mcp.json', 'settings.json', 'rules.json'],
	name: 'cursor',
	paths: {
		cwd: ['./.cursor'],
		darwin: ['~/Library/Application Support/Cursor', '~/.cursor'],
		linux: ['~/.config/Cursor', '~/.cursor'],
		win32: ['%APPDATA%/Cursor', '~/.cursor'],
	},
};

const WINDSURF: AgentInfo = {
	displayName: 'Windsurf',
	knownFiles: ['mcp_config.json', 'settings.json'],
	name: 'windsurf',
	paths: {
		cwd: ['./.windsurf'],
		darwin: ['~/Library/Application Support/Windsurf', '~/.windsurf'],
		linux: ['~/.config/Windsurf', '~/.windsurf'],
		win32: ['%APPDATA%/Windsurf', '~/.windsurf'],
	},
};

const WINDSURF_NEXT: AgentInfo = {
	displayName: 'Windsurf Next',
	knownFiles: ['mcp_config.json', 'settings.json'],
	name: 'windsurf-next',
	paths: {
		cwd: ['./.windsurf-next'],
		darwin: ['~/Library/Application Support/Windsurf-Next', '~/.windsurf-next'],
		linux: ['~/.config/Windsurf-Next', '~/.windsurf-next'],
		win32: ['%APPDATA%/Windsurf-Next', '~/.windsurf-next'],
	},
};

const ANTIGRAVITY: AgentInfo = {
	displayName: 'Antigravity',
	knownFiles: ['config.json'],
	name: 'antigravity',
	paths: {
		cwd: ['./.antigravity'],
		darwin: ['~/Library/Application Support/Antigravity', '~/.antigravity'],
		linux: ['~/.config/Antigravity', '~/.antigravity'],
		win32: ['%APPDATA%/Antigravity', '~/.antigravity'],
	},
};

const PI: AgentInfo = {
	displayName: 'Pi',
	knownFiles: ['config.json'],
	name: 'pi',
	paths: {
		cwd: ['./.pi'],
		darwin: ['~/Library/Application Support/Pi', '~/.pi'],
		linux: ['~/.config/Pi', '~/.pi'],
		win32: ['%APPDATA%/Pi', '~/.pi'],
	},
};

const MCP: AgentInfo = {
	displayName: 'Global MCP',
	knownFiles: ['.mcp.json', 'mcp.json'],
	name: 'mcp',
	paths: {
		cwd: ['./.mcp.json'],
		darwin: ['~/.mcp.json'],
		linux: ['~/.mcp.json'],
		win32: ['~/.mcp.json'],
	},
};

const SKILLS: AgentInfo = {
	displayName: 'Global Skills',
	knownFiles: ['SKILL.md'],
	name: 'skills',
	paths: {
		cwd: ['./skills'],
		darwin: ['~/skills'],
		linux: ['~/skills'],
		win32: ['~/skills'],
	},
};

const CUSTOM: AgentInfo = {
	displayName: 'Custom',
	knownFiles: [],
	name: 'custom',
	paths: { cwd: [], darwin: [], linux: [], win32: [] },
};

const AGENTS: readonly AgentInfo[] = [
	CLAUDE,
	CODEX,
	OPENCODE,
	KILOCODE,
	CURSOR,
	WINDSURF,
	WINDSURF_NEXT,
	ANTIGRAVITY,
	PI,
	MCP,
	SKILLS,
	CUSTOM,
];

const AGENT_INDEX: ReadonlyMap<string, AgentInfo> = new Map(AGENTS.map((a) => [a.name, a]));

/** All registered agents, in stable display order. */
export function getAllAgents(): readonly AgentInfo[] {
	return AGENTS;
}

/** Lookup an agent by its canonical `--agent` name. Case-insensitive; returns undefined if unknown. */
export function getAgentByName(name: string): AgentInfo | undefined {
	return AGENT_INDEX.get(name.toLowerCase());
}

/** True if `name` is a recognized `--agent` value. Case-insensitive. */
export function isSupportedAgent(name: string): boolean {
	return AGENT_INDEX.has(name.toLowerCase());
}

/** All supported `--agent` values, useful for CLI validation and help text. */
export function getSupportedAgentNames(): readonly string[] {
	return AGENTS.map((a) => a.name);
}
