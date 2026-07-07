/**
 * Plugin command registration
 *
 * Every `addCommand` block moved verbatim from plugin.ts (PR3.3). Command ids,
 * names, and checkCallback semantics are a FROZEN interface — user hotkey
 * bindings reference the ids — so change nothing here without a migration.
 * plugin.onload calls registerAllCommands(this) at the same point the inline
 * blocks used to run, preserving registration order.
 */

import { Notice } from "obsidian";
import type AgentClientPlugin from "../plugin";
import {
	getAllAgentsFromSettings,
	findAgentSettings,
	isAgentEnabled,
} from "../services/session-helpers";

/** Register every palette command (basic, agent, permission, broadcast, floating). */
export function registerAllCommands(plugin: AgentClientPlugin): void {
	plugin.addCommand({
		id: "open-chat-view",
		name: "Open chat view",
		callback: () => {
			void plugin.activateView();
		},
	});

	plugin.addCommand({
		id: "focus-next-chat-view",
		name: "Focus next chat view",
		callback: () => {
			plugin.focusChatView("next");
		},
	});

	plugin.addCommand({
		id: "focus-previous-chat-view",
		name: "Focus previous chat view",
		callback: () => {
			plugin.focusChatView("previous");
		},
	});

	plugin.addCommand({
		id: "open-new-chat-view",
		name: "Open new chat view",
		callback: () => {
			void plugin.openNewChatViewWithAgent(
				plugin.settings.defaultAgentId,
			);
		},
	});

	plugin.addCommand({
		id: "open-session-manager",
		name: "Open session manager",
		callback: () => {
			void plugin.activateSessionManager();
		},
	});

	// Register agent-specific commands
	registerAgentCommands(plugin);
	registerPermissionCommands(plugin);
	registerBroadcastCommands(plugin);

	// Floating chat window commands
	plugin.addCommand({
		id: "open-floating-chat-view",
		name: "Open floating chat view",
		checkCallback: (checking) => {
			if (!plugin.settings.enableFloatingChat) return false;
			if (checking) return true;
			const instances = plugin.getFloatingChatInstances();
			if (instances.length === 0) {
				plugin.openNewFloatingChat(true);
			} else if (instances.length === 1) {
				plugin.expandFloatingChat(instances[0]);
			} else {
				const focused = plugin.viewRegistry.getFocused();
				if (focused && focused.viewType === "floating") {
					focused.expand();
				} else {
					plugin.expandFloatingChat(
						instances[instances.length - 1],
					);
				}
			}
		},
	});

	plugin.addCommand({
		id: "open-new-floating-chat-view",
		name: "Open new floating chat view",
		checkCallback: (checking) => {
			if (!plugin.settings.enableFloatingChat) return false;
			if (checking) return true;
			plugin.openNewFloatingChat(true);
		},
	});

	plugin.addCommand({
		id: "minimize-floating-chat-view",
		name: "Minimize floating chat view",
		checkCallback: (checking) => {
			if (!plugin.settings.enableFloatingChat) return false;
			const focused = plugin.viewRegistry.getFocused();
			if (!(focused && focused.viewType === "floating")) return false;
			if (checking) return true;
			focused.collapse();
		},
	});

	plugin.addCommand({
		id: "close-floating-chat-view",
		name: "Close floating chat view",
		checkCallback: (checking) => {
			if (!plugin.settings.enableFloatingChat) return false;
			const focused = plugin.viewRegistry.getFocused();
			if (!(focused && focused.viewType === "floating")) return false;
			if (checking) return true;
			plugin.closeFloatingChat(focused.viewId);
		},
	});
}

/**
 * Register commands for each configured agent.
 *
 * All presets register unconditionally; a checkCallback hides the command
 * while its agent is disabled, so the palette follows the Enabled toggles
 * without re-registration. Custom agents remain a load-time snapshot
 * (a newly added custom gets its command after a reload — existing
 * limitation), but their enabled state is also checked live.
 */
function registerAgentCommands(plugin: AgentClientPlugin): void {
	for (const agent of getAllAgentsFromSettings(plugin.settings)) {
		plugin.addCommand({
			id: `switch-agent-to-${agent.id}`,
			name: `Switch agent to ${agent.displayName}`,
			checkCallback: (checking) => {
				const found = findAgentSettings(plugin.settings, agent.id);
				if (!found || !isAgentEnabled(found)) return false;
				if (checking) return true;
				plugin.app.workspace.trigger(
					"agent-client:new-chat-requested",
					plugin.lastActiveChatViewId,
					agent.id,
				);
			},
		});
	}
}

function registerPermissionCommands(plugin: AgentClientPlugin): void {
	plugin.addCommand({
		id: "approve-active-permission",
		name: "Approve active permission",
		callback: () => {
			plugin.app.workspace.trigger(
				"agent-client:approve-active-permission",
				plugin.lastActiveChatViewId,
			);
		},
	});

	plugin.addCommand({
		id: "reject-active-permission",
		name: "Reject active permission",
		callback: () => {
			plugin.app.workspace.trigger(
				"agent-client:reject-active-permission",
				plugin.lastActiveChatViewId,
			);
		},
	});

	plugin.addCommand({
		id: "toggle-auto-mention",
		name: "Toggle auto-mention",
		callback: () => {
			plugin.app.workspace.trigger(
				"agent-client:toggle-auto-mention",
				plugin.lastActiveChatViewId,
			);
		},
	});

	plugin.addCommand({
		id: "new-chat",
		name: "New chat",
		callback: () => {
			plugin.app.workspace.trigger(
				"agent-client:new-chat-requested",
				plugin.lastActiveChatViewId,
			);
		},
	});

	plugin.addCommand({
		id: "cancel-current-message",
		name: "Cancel current message",
		callback: () => {
			plugin.app.workspace.trigger(
				"agent-client:cancel-message",
				plugin.lastActiveChatViewId,
			);
		},
	});

	plugin.addCommand({
		id: "export-chat",
		name: "Export chat",
		callback: () => {
			plugin.app.workspace.trigger(
				"agent-client:export-chat",
				plugin.lastActiveChatViewId,
			);
		},
	});
}

/**
 * Register broadcast commands for multi-view operations
 */
function registerBroadcastCommands(plugin: AgentClientPlugin): void {
	// Broadcast prompt: Copy prompt from active view to all other views
	plugin.addCommand({
		id: "broadcast-prompt",
		name: "Broadcast prompt",
		callback: () => {
			broadcastPrompt(plugin);
		},
	});

	// Broadcast send: Send message in all views that can send
	plugin.addCommand({
		id: "broadcast-send",
		name: "Broadcast send",
		callback: () => {
			void broadcastSend(plugin);
		},
	});

	// Broadcast cancel: Cancel operation in all views
	plugin.addCommand({
		id: "broadcast-cancel",
		name: "Broadcast cancel",
		callback: () => {
			void broadcastCancel(plugin);
		},
	});
}

/**
 * Copy prompt from active view to all other views
 */
function broadcastPrompt(plugin: AgentClientPlugin): void {
	const allViews = plugin.viewRegistry.getAll();
	if (allViews.length === 0) {
		new Notice("[Agent Client] No chat views open");
		return;
	}

	const inputState = plugin.viewRegistry.toFocused((v) =>
		v.getInputState(),
	);
	if (
		!inputState ||
		(inputState.text.trim() === "" && inputState.files.length === 0)
	) {
		new Notice("[Agent Client] No prompt to broadcast");
		return;
	}

	const focusedId = plugin.viewRegistry.getFocusedId();
	const targetViews = allViews.filter((v) => v.viewId !== focusedId);
	if (targetViews.length === 0) {
		new Notice("[Agent Client] No other chat views to broadcast to");
		return;
	}

	for (const view of targetViews) {
		view.setInputState(inputState);
	}
}

/**
 * Send message in all views that can send
 */
async function broadcastSend(plugin: AgentClientPlugin): Promise<void> {
	const allViews = plugin.viewRegistry.getAll();
	if (allViews.length === 0) {
		new Notice("[Agent Client] No chat views open");
		return;
	}

	const sendableViews = allViews.filter((v) => v.canSend());
	if (sendableViews.length === 0) {
		new Notice("[Agent Client] No views ready to send");
		return;
	}

	await Promise.allSettled(sendableViews.map((v) => v.sendMessage()));
}

/**
 * Cancel operation in all views
 */
async function broadcastCancel(plugin: AgentClientPlugin): Promise<void> {
	const allViews = plugin.viewRegistry.getAll();
	if (allViews.length === 0) {
		new Notice("[Agent Client] No chat views open");
		return;
	}

	await Promise.allSettled(allViews.map((v) => v.cancelOperation()));
	new Notice("[Agent Client] Cancel broadcast to all views");
}
