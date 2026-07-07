/**
 * Update Checker
 *
 * Checks preset agent ACP adapters for:
 * 1. Package migration — deprecated packages that have been renamed
 * 2. Version updates — newer versions available on npm
 *
 * Also checks the plugin itself for newer GitHub releases
 * (checkPluginUpdate — fetch + semver comparison only; the caller owns the
 * user-facing Notice).
 *
 * Pure functions (non-React). Uses Obsidian's requestUrl for network access.
 */

import { requestUrl } from "obsidian";
import * as semver from "semver";
import type { OverlayVariant } from "../types/errors";

// ============================================================================
// Types
// ============================================================================

/**
 * Agent update notification to display in the UI.
 * Compatible with ErrorInfo shape (title/message/suggestion).
 */
export interface AgentUpdateNotification {
	/** Visual variant for the overlay */
	variant: OverlayVariant;
	/** Short notification title */
	title: string;
	/** Detailed notification message */
	message: string;
	/** Actionable suggestion (e.g., npm command) */
	suggestion?: string;
	/** Optional external link rendered as an actionable anchor (e.g. docs). */
	link?: { text: string; url: string };
}

// ============================================================================
// Known Packages
// ============================================================================

/**
 * Maps agentInfo.name → npm package name.
 * Agents may report their name with or without the npm scope prefix,
 * so we handle both forms.
 */
const KNOWN_AGENT_PACKAGES: Readonly<Record<string, string>> = {
	"@agentclientprotocol/claude-agent-acp":
		"@agentclientprotocol/claude-agent-acp",
	"codex-acp": "@zed-industries/codex-acp",
};

/**
 * Deprecated agentInfo.name → replacement npm package name.
 * Used to detect users still running old/renamed packages.
 */
const DEPRECATED_PACKAGES: Readonly<Record<string, string>> = {
	"@zed-industries/claude-code-acp": "@agentclientprotocol/claude-agent-acp",
	"@zed-industries/claude-agent-acp": "@agentclientprotocol/claude-agent-acp",
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if the agent needs a package migration or version update.
 *
 * Priority: migration notification > version update notification.
 * - Migration is checked locally (no network) based on agentInfo.name.
 * - Version update queries the npm registry.
 *
 * @returns AgentUpdateNotification if action needed, null otherwise.
 */
export async function checkAgentUpdate(agentInfo: {
	name: string;
	version?: string;
}): Promise<AgentUpdateNotification | null> {
	// 1. Check for deprecated package (migration takes priority)
	const replacement = DEPRECATED_PACKAGES[agentInfo.name];
	if (replacement) {
		return {
			variant: "info",
			title: "Package Migration Required",
			message: `"${agentInfo.name}" has been renamed to "${replacement}".\nRun the following in your terminal:`,
			suggestion: `npm uninstall -g ${agentInfo.name} && npm install -g ${replacement}`,
		};
	}

	// 2. Check for version update (known packages only)
	const npmPackage = KNOWN_AGENT_PACKAGES[agentInfo.name];
	if (!npmPackage || !agentInfo.version) {
		return null;
	}

	try {
		const latestVersion = await fetchLatestVersion(npmPackage);
		if (
			latestVersion &&
			semver.valid(agentInfo.version) &&
			semver.gt(latestVersion, agentInfo.version)
		) {
			return {
				variant: "info",
				title: "Agent Update Available",
				message: `${npmPackage}: ${agentInfo.version} → ${latestVersion}.\nRun the following in your terminal:`,
				suggestion: `npm install -g ${npmPackage}@latest`,
			};
		}
	} catch {
		// Silently ignore network errors — update check is best-effort
	}

	return null;
}

/**
 * Check for plugin updates against GitHub releases.
 * - Stable version users: compare with latest stable release
 * - Prerelease users: compare with both latest stable and latest prerelease
 *
 * No Notice here — the caller (plugin.checkForUpdates) owns user-facing
 * notification.
 *
 * @param currentVersion - The running plugin version (manifest.version).
 * @returns The newer version string (stable preferred when both are newer),
 * or null when already up to date.
 */
export async function checkPluginUpdate(
	currentVersion: string,
): Promise<string | null> {
	const current = semver.clean(currentVersion) || currentVersion;
	const isCurrentPrerelease = semver.prerelease(current) !== null;

	if (isCurrentPrerelease) {
		// Prerelease user: check both stable and prerelease
		const [latestStable, latestPrerelease] = await Promise.all([
			fetchLatestStable(),
			fetchLatestPrerelease(),
		]);

		const hasNewerStable =
			latestStable && semver.gt(latestStable, current);
		const hasNewerPrerelease =
			latestPrerelease && semver.gt(latestPrerelease, current);

		if (hasNewerStable || hasNewerPrerelease) {
			// Prefer stable version notification if available
			return hasNewerStable ? latestStable : latestPrerelease;
		}
	} else {
		// Stable version user: check stable only
		const latestStable = await fetchLatestStable();
		if (latestStable && semver.gt(latestStable, current)) {
			return latestStable;
		}
	}

	return null;
}

// ============================================================================
// Internal
// ============================================================================

/**
 * Fetch the latest version of an npm package from the registry.
 */
async function fetchLatestVersion(packageName: string): Promise<string | null> {
	const response = await requestUrl({
		url: `https://registry.npmjs.org/${packageName}/latest`,
	});
	const data = response.json as { version?: string };
	return data.version ? (semver.clean(data.version) ?? null) : null;
}

/**
 * Fetch the latest stable release version from GitHub.
 */
async function fetchLatestStable(): Promise<string | null> {
	const response = await requestUrl({
		url: "https://api.github.com/repos/RAIT-09/obsidian-agent-client/releases/latest",
	});
	const data = response.json as { tag_name?: string };
	return data.tag_name ? semver.clean(data.tag_name) : null;
}

/**
 * Fetch the latest prerelease version from GitHub.
 */
async function fetchLatestPrerelease(): Promise<string | null> {
	const response = await requestUrl({
		url: "https://api.github.com/repos/RAIT-09/obsidian-agent-client/releases",
	});
	const releases = response.json as Array<{
		tag_name: string;
		prerelease: boolean;
	}>;

	// Find the first prerelease (releases are sorted by date descending)
	const latestPrerelease = releases.find((r) => r.prerelease);
	return latestPrerelease
		? semver.clean(latestPrerelease.tag_name)
		: null;
}
