import { buildWslEnv } from "../utils/platform";

/**
 * Options for assembling the environment for an agent process spawn.
 * Extracted from AcpClient.initialize() so the assembly order (INV-17/#312)
 * can be tested without spawning a process.
 */
export interface SpawnEnvOptions {
	/** Typically process.env. */
	baseEnv: NodeJS.ProcessEnv;
	/** AgentConfig.env — the agent's configured env vars. */
	configEnv?: Record<string, string>;
	isWin: boolean;
	wslMode: boolean;
	/** From resolveNodeDirectory(settings.nodePath); undefined when not an absolute path. */
	nodeDir?: string;
	/** Resolved secret. null/empty means "do not inject" (empty breaks OAuth logins). */
	apiKey?: { envVarName: string; secretValue: string | null };
	/** Injection seam for getEnhancedWindowsEnv (registry I/O). Identity in tests. */
	enhanceWindowsEnv?: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
}

/**
 * Assemble the spawn environment for an agent process.
 *
 * Order matters (INV-17):
 * 1. baseEnv + configEnv
 * 2. Windows (non-WSL): registry PATH repair via enhanceWindowsEnv
 * 3. nodeDir prepended to PATH
 * 4. API key injected only when the secret value is non-empty
 * 5. WSL mode: WSLENV forwarding — must run AFTER the secret injection (#312)
 */
export function buildSpawnEnv(opts: SpawnEnvOptions): NodeJS.ProcessEnv {
	const { isWin, wslMode, nodeDir, apiKey, configEnv } = opts;

	// Prepare environment variables
	let baseEnv: NodeJS.ProcessEnv = {
		...opts.baseEnv,
		...(configEnv || {}),
	};

	// On Windows, enhance PATH with full system/user PATH from registry.
	// Electron apps launched from shortcuts don't inherit the full PATH,
	// which causes executables like python, node, etc. to not be found.
	if (isWin && !wslMode && opts.enhanceWindowsEnv) {
		baseEnv = opts.enhanceWindowsEnv(baseEnv);
	}

	// Add Node.js directory to PATH only when nodePath is an explicit absolute path.
	// When nodePath is empty or a bare command name, the login shell handles it.
	if (nodeDir) {
		const separator = isWin ? ";" : ":";
		baseEnv.PATH = baseEnv.PATH
			? `${nodeDir}${separator}${baseEnv.PATH}`
			: nodeDir;
	}

	// Resolve API key secret just before spawn so the latest value is used.
	// Custom agents don't set config.apiKey and inject keys via env directly.
	// Skip empty values (e.g. the secret was deleted from the Keychain):
	// exporting ANTHROPIC_API_KEY="" etc. can break account-based logins.
	if (apiKey) {
		if (apiKey.secretValue) {
			baseEnv[apiKey.envVarName] = apiKey.secretValue;
		}
	}

	// In WSL mode, forward the configured env var NAMES into WSL via WSLENV
	// (Windows env vars are otherwise invisible to the Linux agent process,
	// so the plugin's API key field would have no effect in WSL). Preset
	// agents resolve the API key into baseEnv above — not into config.env —
	// so its var name must be added explicitly, or the key would never cross
	// into WSL. Must run AFTER the secret is injected into baseEnv. (#312)
	if (isWin && wslMode) {
		const wslEnvNames = Object.keys(configEnv || {});
		if (apiKey?.envVarName) {
			wslEnvNames.push(apiKey.envVarName);
		}
		baseEnv = buildWslEnv(baseEnv, wslEnvNames);
	}

	return baseEnv;
}
