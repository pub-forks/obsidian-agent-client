/**
 * Settings normalization and validation utilities.
 *
 * Pure functions for validating and normalizing plugin settings values.
 * Used by plugin.ts (loadSettings) and SettingsTab.ts.
 */

import type { AgentEnvVar, CustomAgentSettings } from "../plugin";
import type {
	BaseAgentSettings,
	PresetAgentUserSettings,
} from "../types/agent";
import type { AgentConfig } from "../acp/acp-client";
import type { PresetAgentDefinition } from "./preset-agents";

// ============================================================================
// Display Settings
// ============================================================================

export const CHAT_FONT_SIZE_MIN = 10;
export const CHAT_FONT_SIZE_MAX = 30;

export const parseChatFontSize = (value: unknown): number | null => {
	if (value === null || value === undefined) {
		return null;
	}

	const numericValue = (() => {
		if (typeof value === "number") {
			return value;
		}

		if (typeof value === "string") {
			const trimmedValue = value.trim();
			if (trimmedValue.length === 0) {
				return Number.NaN;
			}
			if (!/^-?\d+$/.test(trimmedValue)) {
				return Number.NaN;
			}
			return Number.parseInt(trimmedValue, 10);
		}

		return Number.NaN;
	})();

	if (!Number.isFinite(numericValue)) {
		return null;
	}

	return Math.min(
		CHAT_FONT_SIZE_MAX,
		Math.max(CHAT_FONT_SIZE_MIN, Math.round(numericValue)),
	);
};

// ============================================================================
// Settings Utilities
// ============================================================================

export const sanitizeArgs = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value
			.map((item) => (typeof item === "string" ? item.trim() : ""))
			.filter((item) => item.length > 0);
	}
	if (typeof value === "string") {
		return value
			.split(/\r?\n/)
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}
	return [];
};

// Convert stored env structures into a deduplicated list
export const normalizeEnvVars = (value: unknown): AgentEnvVar[] => {
	const pairs: AgentEnvVar[] = [];
	if (!value) {
		return pairs;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			if (entry && typeof entry === "object") {
				// Type guard: check if entry has key and value properties
				const entryObj = entry as Record<string, unknown>;
				const key = "key" in entryObj ? entryObj.key : undefined;
				const val = "value" in entryObj ? entryObj.value : undefined;
				if (typeof key === "string" && key.trim().length > 0) {
					pairs.push({
						key: key.trim(),
						value: typeof val === "string" ? val : "",
					});
				}
			}
		}
	} else if (typeof value === "object") {
		for (const [key, val] of Object.entries(
			value as Record<string, unknown>,
		)) {
			if (typeof key === "string" && key.trim().length > 0) {
				pairs.push({
					key: key.trim(),
					value: typeof val === "string" ? val : "",
				});
			}
		}
	}

	const seen = new Set<string>();
	return pairs.filter((pair) => {
		if (seen.has(pair.key)) {
			return false;
		}
		seen.add(pair.key);
		return true;
	});
};

// Rebuild a custom agent entry with defaults and cleaned values
export const normalizeCustomAgent = (
	agent: Record<string, unknown>,
): CustomAgentSettings => {
	const rawId =
		agent && typeof agent.id === "string" && agent.id.trim().length > 0
			? agent.id.trim()
			: "custom-agent";
	const rawDisplayName =
		agent &&
		typeof agent.displayName === "string" &&
		agent.displayName.trim().length > 0
			? agent.displayName.trim()
			: rawId;
	return {
		id: rawId,
		displayName: rawDisplayName,
		command:
			agent &&
			typeof agent.command === "string" &&
			agent.command.trim().length > 0
				? agent.command.trim()
				: "",
		args: sanitizeArgs(agent?.args),
		env: normalizeEnvVars(agent?.env),
		enabled: bool(agent?.enabled, true),
	};
};

// Ensure custom agent IDs are unique within the collection. `reservedIds`
// (e.g. all preset ids) seed the collision set: a custom colliding with a
// reserved id is suffix-renamed the same way as a custom-custom duplicate.
export const ensureUniqueCustomAgentIds = (
	agents: CustomAgentSettings[],
	reservedIds: readonly string[] = [],
): CustomAgentSettings[] => {
	const seen = new Set<string>(reservedIds);
	return agents.map((agent) => {
		const base =
			agent.id && agent.id.trim().length > 0
				? agent.id.trim()
				: "custom-agent";
		let candidate = base;
		let suffix = 2;
		while (seen.has(candidate)) {
			candidate = `${base}-${suffix}`;
			suffix += 1;
		}
		seen.add(candidate);
		return { ...agent, id: candidate };
	});
};

/**
 * Resolve the stored default agent id from raw data.json contents.
 * Migration: defaultAgentId ← activeAgentId (old name). Ids not present in
 * `availableAgentIds` fall back to the first available id ("" if none).
 */
export const resolveDefaultAgentId = (
	raw: Record<string, unknown>,
	availableAgentIds: readonly string[],
): string => {
	const rawDefaultId =
		str(raw.defaultAgentId, "") || str(raw.activeAgentId, "");
	return rawDefaultId && availableAgentIds.includes(rawDefaultId)
		? rawDefaultId
		: availableAgentIds[0] || "";
};

// ============================================================================
// Preset Agent Normalization
// ============================================================================

/**
 * Callback that resolves the apiKeySecretId for a preset with legacy
 * plaintext-key wiring (`def.apiKey.legacy` is set). The plugin injects an
 * implementation backed by Obsidian's secret storage (side-effecting:
 * secret writes + Notices); tests inject a fake. Called only for presets
 * whose registry entry carries `apiKey.legacy`.
 */
export type ApiKeyMigrator = (args: {
	def: PresetAgentDefinition;
	/** apiKeySecretId currently stored for this preset ("" if unset). */
	current: string;
	/** Legacy plaintext apiKey lingering in data.json ("" if absent). */
	legacyPlain: string;
}) => string;

/** Registry defaults as a fresh user-settings entry (no user overrides). */
export const defaultPresetAgentSettings = (
	def: PresetAgentDefinition,
): PresetAgentUserSettings => ({
	id: def.presetId,
	displayName: def.defaultDisplayName,
	apiKeySecretId: "",
	command: def.defaultCommand,
	args: [...def.defaultArgs],
	env: [],
	enabled: true,
});

/**
 * Normalize the presetAgents record from raw data.json contents.
 *
 * Reproduces the historic per-agent loadSettings behavior verbatim:
 * 1. Source order per preset: `raw.presetAgents[presetId]` → legacy
 *    per-agent sub-object (`raw[legacySettingsKey]`) → registry defaults.
 * 2. `id` is force-synced to presetId — never read from raw.
 * 3. `command` falls back to the legacy top-level command-path key
 *    (claudeCodeAcpCommandPath / geminiCommandPath) before the default.
 * 4. Args that sanitize to empty fall back to the registry defaults
 *    (historic Gemini behavior, generalized — a no-op for presets whose
 *    defaults are empty).
 * 5. `apiKeySecretId` goes through `migrateApiKey` only for presets with
 *    legacy plaintext-key wiring.
 * 6. Unknown presetIds (entries written by a newer plugin version, e.g. via
 *    Obsidian Sync or a BRAT rollback) are preserved with field-level
 *    sanitizing only, so a save round-trip doesn't destroy them. They are
 *    not enumerated anywhere (enumeration is registry-driven).
 *
 * Takes the whole raw data.json object because legacy command-path keys
 * live at the top level.
 */
export const normalizePresetAgents = (
	raw: Record<string, unknown>,
	registry: readonly PresetAgentDefinition[],
	migrateApiKey: ApiKeyMigrator,
): Record<string, PresetAgentUserSettings> => {
	const rawRecord = obj(raw.presetAgents) ?? {};
	const result: Record<string, PresetAgentUserSettings> = {};

	for (const def of registry) {
		const entry =
			obj(rawRecord[def.presetId]) ??
			(def.legacySettingsKey ? obj(raw[def.legacySettingsKey]) : null) ??
			{};

		const storedSecretId = str(entry.apiKeySecretId, "");
		const apiKeySecretId = def.apiKey?.legacy
			? migrateApiKey({
					def,
					current: storedSecretId,
					legacyPlain: str(entry.apiKey, ""),
				})
			: storedSecretId;

		const legacyCommand = def.legacyCommandPathKey
			? str(raw[def.legacyCommandPathKey], "")
			: "";
		const args = sanitizeArgs(entry.args);

		result[def.presetId] = {
			id: def.presetId, // Fixed — never from raw
			displayName: str(entry.displayName, def.defaultDisplayName),
			apiKeySecretId,
			command:
				str(entry.command, "") || legacyCommand || def.defaultCommand,
			args: args.length > 0 ? args : [...def.defaultArgs],
			env: normalizeEnvVars(entry.env),
			enabled: bool(entry.enabled, true),
		};
	}

	// Preserve unknown presetIds (version skew): sanitize known fields,
	// spread-through the rest so fields this version doesn't know survive.
	const knownIds = new Set(registry.map((def) => def.presetId));
	for (const [presetId, value] of Object.entries(rawRecord)) {
		if (knownIds.has(presetId)) continue;
		const entry = obj(value);
		if (!entry) continue;
		result[presetId] = {
			...entry,
			id: presetId,
			displayName: str(entry.displayName, presetId),
			apiKeySecretId: str(entry.apiKeySecretId, ""),
			command: str(entry.command, ""),
			args: sanitizeArgs(entry.args),
			env: normalizeEnvVars(entry.env),
		};
	}

	return result;
};

/**
 * Convert BaseAgentSettings to AgentConfig for process execution.
 *
 * Transforms the storage format (BaseAgentSettings) to the runtime format (AgentConfig)
 * needed by AcpClient.initialize().
 */
export const toAgentConfig = (
	settings: BaseAgentSettings,
	workingDirectory: string,
): AgentConfig => {
	// Convert AgentEnvVar[] to Record<string, string> for process.spawn()
	const env = settings.env.reduce(
		(acc, { key, value }) => {
			acc[key] = value;
			return acc;
		},
		{} as Record<string, string>,
	);

	return {
		id: settings.id,
		displayName: settings.displayName,
		command: settings.command,
		args: settings.args,
		env,
		workingDirectory,
	};
};

// ============================================================================
// Settings Loading Helpers
// ============================================================================

/** Extract a string value, falling back to default if not a string */
export function str(raw: unknown, fallback: string): string {
	return typeof raw === "string" ? raw : fallback;
}

/** Extract a boolean value, falling back to default if not a boolean */
export function bool(raw: unknown, fallback: boolean): boolean {
	return typeof raw === "boolean" ? raw : fallback;
}

/** Extract a number value with optional minimum, falling back to default */
export function num(raw: unknown, fallback: number, min?: number): number {
	if (typeof raw !== "number") return fallback;
	if (min !== undefined && raw < min) return fallback;
	return raw;
}

/** Extract a value that must be one of the valid options */
export function enumVal<T extends string>(
	raw: unknown,
	valid: T[],
	fallback: T,
): T {
	return valid.includes(raw as T) ? (raw as T) : fallback;
}

/** Extract a plain object, or return null */
export function obj(raw: unknown): Record<string, unknown> | null {
	return raw && typeof raw === "object" && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: null;
}

/** Extract a Record<string, string> with validated entries */
export function strRecord(raw: unknown): Record<string, string> {
	const result: Record<string, string> = {};
	const o = obj(raw);
	if (!o) return result;
	for (const [key, value] of Object.entries(o)) {
		if (
			typeof key === "string" &&
			key.length > 0 &&
			typeof value === "string" &&
			value.length > 0
		) {
			result[key] = value;
		}
	}
	return result;
}

/** Normalize a nested string record, e.g. agentId → { optionId → value }. */
export function nestedStrRecord(
	raw: unknown,
): Record<string, Record<string, string>> {
	const result: Record<string, Record<string, string>> = {};
	const o = obj(raw);
	if (!o) return result;
	for (const [key, value] of Object.entries(o)) {
		if (
			typeof key === "string" &&
			key.length > 0 &&
			key !== "__proto__" &&
			key !== "constructor"
		) {
			result[key] = strRecord(value);
		}
	}
	return result;
}

/** Extract an {x, y} point, or return null if invalid */
export function xyPoint(raw: unknown): { x: number; y: number } | null {
	const o = obj(raw);
	if (!o || typeof o.x !== "number" || typeof o.y !== "number") return null;
	return { x: o.x, y: o.y };
}
