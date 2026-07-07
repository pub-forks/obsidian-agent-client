/**
 * The narrow surface the ACP layer needs from its host (the plugin).
 *
 * Keeping this interface explicit prevents the acp/ layer from growing an
 * implicit dependency on the whole plugin object (settings, app, manifest).
 * The plugin implements it via a small adapter (see plugin.createAcpHost).
 */
export interface AcpClientHost {
	/** Read live settings relevant to process spawning. Called per operation — do not cache. */
	getSettings(): {
		autoAllowPermissions: boolean;
		nodePath: string;
		windowsWslMode: boolean;
		windowsWslDistribution?: string;
	};
	/** Resolve a secret from Obsidian's secret storage. Returns null when absent. */
	getSecret(secretId: string): string | null;
	/** Plugin version reported to agents via clientInfo. */
	clientVersion: string;
}
