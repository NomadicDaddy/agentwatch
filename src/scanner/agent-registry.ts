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

/**
 * Build AgentPaths for a simple cross-platform dotfile home whose global root is
 * identical on every platform (e.g. `~/.gemini`). Keeps the registry compact for
 * the common case where darwin/linux/win32 all share one home path.
 */
function dotfile(cwd: string, home: string): AgentPaths {
	return { cwd: [cwd], darwin: [home], linux: [home], win32: [home] };
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
		cwd: ['./.opencode', './.config/opencode'],
		darwin: ['~/.config/opencode', '~/.opencode'],
		linux: ['~/.config/opencode', '~/.opencode'],
		win32: ['~/.config/opencode', '~/.opencode'],
	},
};

const KILO: AgentInfo = {
	displayName: 'Kilo',
	knownFiles: ['config.json'],
	name: 'kilo',
	paths: {
		cwd: ['./.kilo', './.kilocode'],
		darwin: ['~/.config/kilo', '~/.kilocode'],
		linux: ['~/.config/kilo', '~/.kilocode'],
		win32: ['~/.config/kilo', '~/.kilocode'],
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
		cwd: ['./.windsurf', './.codeium/windsurf'],
		darwin: ['~/Library/Application Support/Windsurf', '~/.windsurf', '~/.codeium/windsurf'],
		linux: ['~/.config/Windsurf', '~/.windsurf', '~/.codeium/windsurf'],
		win32: ['%APPDATA%/Windsurf', '~/.windsurf', '~/.codeium/windsurf'],
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
		cwd: ['./.antigravity', './.gemini/antigravity'],
		darwin: [
			'~/Library/Application Support/Antigravity',
			'~/.antigravity',
			'~/.gemini/antigravity',
		],
		linux: ['~/.config/Antigravity', '~/.antigravity', '~/.gemini/antigravity'],
		win32: ['%APPDATA%/Antigravity', '~/.antigravity', '~/.gemini/antigravity'],
	},
};

const GEMINI: AgentInfo = {
	displayName: 'Gemini',
	knownFiles: ['settings.json'],
	name: 'gemini',
	paths: dotfile('./.gemini', '~/.gemini'),
};

const GROK: AgentInfo = {
	displayName: 'Grok',
	knownFiles: ['config.json'],
	name: 'grok',
	paths: dotfile('./.grok', '~/.grok'),
};

const KIRO: AgentInfo = {
	displayName: 'Kiro',
	knownFiles: ['config.json'],
	name: 'kiro',
	paths: dotfile('./.kiro', '~/.kiro'),
};

const COPILOT: AgentInfo = {
	displayName: 'Copilot',
	knownFiles: ['config.json'],
	name: 'copilot',
	paths: dotfile('./.copilot', '~/.copilot'),
};

const ZCODE: AgentInfo = {
	displayName: 'Zcode',
	knownFiles: ['config.json'],
	name: 'zcode',
	paths: dotfile('./.zcode', '~/.zcode'),
};

const AGENTS_HOME: AgentInfo = {
	displayName: 'Generic Agents',
	knownFiles: [],
	name: 'agents',
	paths: dotfile('./.agents', '~/.agents'),
};

const CLINE: AgentInfo = {
	displayName: 'Cline',
	knownFiles: ['config.json'],
	name: 'cline',
	paths: dotfile('./.cline', '~/.cline'),
};

// Devin ships as a VS Code fork, so it carries three distinct roots: `~/.devin` holds the
// editor-shell data (argv.json, extensions), `~/.config/devin` holds the skills home, and the
// platform app-data tree holds userData — `User/settings.json`, the `mcp/` config, and the
// Devin CLI's own `cli/` session store.
const DEVIN: AgentInfo = {
	displayName: 'Devin',
	knownFiles: ['argv.json', 'mcp.json', 'settings.json'],
	name: 'devin',
	paths: {
		cwd: ['./.devin'],
		darwin: ['~/.devin', '~/.config/devin', '~/Library/Application Support/devin'],
		linux: ['~/.devin', '~/.config/devin'],
		win32: ['~/.devin', '~/.config/devin', '%APPDATA%/devin'],
	},
};

const DEVIN_NEXT: AgentInfo = {
	displayName: 'Devin Next',
	knownFiles: ['argv.json', 'settings.json'],
	name: 'devin-next',
	paths: {
		cwd: ['./.devin-next'],
		darwin: ['~/.devin-next', '~/Library/Application Support/Devin - Next'],
		linux: ['~/.devin-next', '~/.config/Devin - Next'],
		win32: ['~/.devin-next', '%APPDATA%/Devin - Next'],
	},
};

// T3 Code splits its footprint in two: `~/.t3` is the server/runtime home on every
// platform (provider settings, caches, live-listener record), while the Electron
// desktop shell keeps its own userData tree under the platform app-data directory.
const T3_CODE: AgentInfo = {
	displayName: 'T3 Code',
	knownFiles: ['t3.json', 'settings.json', 'server-runtime.json'],
	name: 't3code',
	paths: {
		cwd: ['./t3.json'],
		darwin: ['~/.t3', '~/Library/Application Support/t3code'],
		linux: ['~/.t3', '~/.config/t3code'],
		win32: ['~/.t3', '%APPDATA%/t3code'],
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
	KILO,
	CURSOR,
	WINDSURF,
	WINDSURF_NEXT,
	ANTIGRAVITY,
	GEMINI,
	GROK,
	KIRO,
	COPILOT,
	ZCODE,
	AGENTS_HOME,
	CLINE,
	DEVIN,
	DEVIN_NEXT,
	T3_CODE,
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
