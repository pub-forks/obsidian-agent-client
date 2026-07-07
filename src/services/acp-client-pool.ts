/**
 * AcpClientPool
 *
 * Owns the per-view AcpClient instances (multi-session support) and their
 * graceful-teardown timers. Moved verbatim from plugin.ts (PR3.3); the plugin
 * keeps thin delegate methods with unchanged signatures
 * (getOrCreateAcpClient / removeAcpClient / acquireAcpClient /
 * releaseAcpClient / updateAllAutoAllow).
 */

import { AcpClient } from "../acp/acp-client";
import type { AcpClientHost } from "../acp/host";
import { getLogger } from "../utils/logger";

export class AcpClientPool {
	/** Map of viewId to AcpClient for multi-session support */
	private _acpClients: Map<string, AcpClient> = new Map();
	/**
	 * Pending graceful AcpClient teardown timers, keyed by viewId. An embedded
	 * block schedules teardown on unmount and cancels it on (re)mount, so
	 * re-processing churn keeps one client while genuine removal reaps it.
	 */
	private _acpTeardownTimers = new Map<string, number>();

	/** Grace window before an embedded AcpClient is actually disconnected. */
	private static readonly ACP_TEARDOWN_GRACE_MS = 250;

	/**
	 * @param hostFactory - Builds the narrow host surface a new AcpClient is
	 * allowed to see (see plugin.createAcpHost). Called once per client.
	 */
	constructor(private hostFactory: () => AcpClientHost) {}

	/**
	 * Get or create an AcpClient for a specific view.
	 * Each ChatView has its own AcpClient for independent sessions.
	 */
	getOrCreate(viewId: string): AcpClient {
		let client = this._acpClients.get(viewId);
		if (!client) {
			client = new AcpClient(this.hostFactory());
			this._acpClients.set(viewId, client);
		}
		return client;
	}

	/**
	 * Update auto-allow permission setting on all live AcpClient instances.
	 * Called when the setting changes at runtime.
	 */
	updateAllAutoAllow(autoAllow: boolean): void {
		for (const client of this._acpClients.values()) {
			client.updateAutoAllow(autoAllow);
		}
	}

	/**
	 * Remove and disconnect the AcpClient for a specific view.
	 * Called when a ChatView is closed.
	 */
	async remove(viewId: string): Promise<void> {
		const client = this._acpClients.get(viewId);
		if (client) {
			try {
				await client.disconnect();
			} catch (error) {
				getLogger().warn(
					`[AgentClient] Failed to disconnect client for view ${viewId}:`,
					error,
				);
			}
			this._acpClients.delete(viewId);
		}
		// Note: lastActiveChatViewId is now managed by viewRegistry
		// Clearing happens automatically when view is unregistered
	}

	/** Cancel a pending graceful teardown for a viewId (called on (re)mount). */
	acquire(viewId: string): void {
		const timer = this._acpTeardownTimers.get(viewId);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			this._acpTeardownTimers.delete(viewId);
		}
	}

	/**
	 * Schedule a graceful teardown of a viewId's AcpClient. A re-acquire within
	 * the grace window cancels it, so a rapid unmount/remount (re-processing)
	 * keeps one client; only genuine removal disconnects the agent process.
	 */
	release(
		viewId: string,
		graceMs: number = AcpClientPool.ACP_TEARDOWN_GRACE_MS,
	): void {
		if (this._acpTeardownTimers.has(viewId)) return;
		const timer = window.setTimeout(() => {
			this._acpTeardownTimers.delete(viewId);
			void this.remove(viewId);
		}, graceMs);
		this._acpTeardownTimers.set(viewId, timer);
	}

	/**
	 * Fire-and-forget disconnect of every client (quit / plugin-unload paths).
	 * Never awaits — quit must not be blocked. `logErrors` preserves the two
	 * historical call-site behaviors: the workspace "quit" handler warn-logs
	 * per view, plugin onunload swallows errors silently.
	 */
	disconnectAll(logErrors: boolean): void {
		for (const [viewId, client] of this._acpClients) {
			client.disconnect().catch((error) => {
				if (logErrors) {
					getLogger().warn(
						`[AgentClient] Quit cleanup error for view ${viewId}:`,
						error,
					);
				}
			});
		}
		this._acpClients.clear();
	}

	/** Cancel all pending graceful teardowns (plugin-unload path). */
	cancelAllTeardowns(): void {
		for (const timer of this._acpTeardownTimers.values()) {
			window.clearTimeout(timer);
		}
		this._acpTeardownTimers.clear();
	}
}
