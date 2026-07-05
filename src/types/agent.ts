/**
 * Domain Models for Agent Configuration
 *
 * These types represent agent settings and configuration,
 * independent of the plugin infrastructure. They define
 * the core concepts of agent identity, capabilities, and
 * connection parameters.
 */

// ============================================================================
// Environment Configuration
// ============================================================================

/**
 * Environment variable for agent process.
 *
 * Used to pass configuration and credentials to agent processes
 * via environment variables (e.g., API keys, paths, feature flags).
 */
export interface AgentEnvVar {
	/** Environment variable name (e.g., "ANTHROPIC_API_KEY") */
	key: string;

	/** Environment variable value */
	value: string;
}

// ============================================================================
// Agent Configuration
// ============================================================================

/**
 * Base configuration shared by all agent types.
 *
 * Defines the common properties needed to launch and communicate
 * with any ACP-compatible agent, regardless of the specific
 * implementation (Claude Code, Gemini CLI, custom agents, etc.).
 */
export interface BaseAgentSettings {
	/** Unique identifier for this agent (e.g., "claude", "gemini", "custom-1") */
	id: string;

	/** Human-readable display name shown in UI */
	displayName: string;

	/** Command to execute (full path to executable or command name) */
	command: string;

	/** Command-line arguments passed to the agent */
	args: string[];

	/** Environment variables for the agent process */
	env: AgentEnvVar[];

	/**
	 * Whether the agent appears in agent lists and menus (enumeration).
	 * `undefined` means enabled (backward compatibility with stored data).
	 * Disabling never blocks resolution: pinned blocks, restored sessions,
	 * and already-open chats keep working. Check via `isAgentEnabled()`.
	 */
	enabled?: boolean;
}

/**
 * Per-preset user overrides for a preset agent.
 *
 * Stored in `settings.presetAgents[presetId]`. The static side of a preset
 * (default command, API-key env var name, install hints, settings copy) lives
 * in the registry (`services/preset-agents.ts`); this type holds only what
 * the user can change. The API key is stored in Obsidian's secret storage
 * and referenced by ID. Empty string means no API key is configured.
 */
export interface PresetAgentUserSettings extends BaseAgentSettings {
	/** Secret storage ID containing the agent's API key */
	apiKeySecretId: string;
}

/**
 * Configuration for custom ACP-compatible agents.
 *
 * Uses only the base settings, allowing users to configure
 * any agent that implements the Agent Client Protocol.
 */
export type CustomAgentSettings = BaseAgentSettings;
