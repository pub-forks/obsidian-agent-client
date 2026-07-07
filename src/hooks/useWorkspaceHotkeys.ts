import * as React from "react";
const { useRef, useEffect } = React;
import { Notice } from "obsidian";

import type AgentClientPlugin from "../plugin";

export interface UseWorkspaceHotkeysOptions {
	plugin: AgentClientPlugin;
	viewId: string;
	variant: "sidebar" | "floating" | "embedded";
	/** New-chat path for the sidebar variant (persists the agent id on the view). */
	handleNewChatWithPersist: (requestedAgentId?: string) => Promise<void>;
	/** New-chat path for the floating/embedded variants. */
	handleNewChat: (requestedAgentId?: string) => Promise<void>;
	toggleAutoMention: (disabled?: boolean) => void;
	approveActivePermission: () => Promise<boolean>;
	rejectActivePermission: () => Promise<boolean>;
	handleStopGeneration: () => Promise<void>;
	handleExportChat: () => Promise<void>;
}

/**
 * Registers the six `agent-client:*` workspace events (hotkey/command
 * targets) for one chat view. Events carrying a targetViewId are filtered so
 * only the addressed view reacts; events without one reach every view.
 */
export function useWorkspaceHotkeys({
	plugin,
	viewId,
	variant,
	handleNewChatWithPersist,
	handleNewChat,
	toggleAutoMention,
	approveActivePermission,
	rejectActivePermission,
	handleStopGeneration,
	handleExportChat,
}: UseWorkspaceHotkeysOptions): void {
	// Refs for workspace event handlers (avoids re-registering on every render)
	const handleNewChatWithPersistRef = useRef(handleNewChatWithPersist);
	const handleNewChatRef = useRef(handleNewChat);
	const approveActivePermissionRef = useRef(approveActivePermission);
	const rejectActivePermissionRef = useRef(rejectActivePermission);
	const handleStopGenerationRef = useRef(handleStopGeneration);
	const handleExportChatRef = useRef(handleExportChat);
	handleNewChatWithPersistRef.current = handleNewChatWithPersist;
	handleNewChatRef.current = handleNewChat;
	approveActivePermissionRef.current = approveActivePermission;
	rejectActivePermissionRef.current = rejectActivePermission;
	handleStopGenerationRef.current = handleStopGeneration;
	handleExportChatRef.current = handleExportChat;

	useEffect(() => {
		const workspace = plugin.app.workspace;
		const ws = workspace as unknown as {
			on: (
				name: string,
				callback: (...args: never[]) => void,
			) => ReturnType<typeof workspace.on>;
		};

		const refs = [
			// Toggle auto-mention
			ws.on(
				"agent-client:toggle-auto-mention",
				(targetViewId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					toggleAutoMention();
				},
			),

			// New chat requested (from "New chat" or "Switch agent to" commands)
			ws.on(
				"agent-client:new-chat-requested",
				(targetViewId?: string, agentId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					if (variant === "sidebar") {
						void handleNewChatWithPersistRef.current(agentId);
					} else {
						void handleNewChatRef.current(agentId);
					}
				},
			),

			// Approve active permission
			ws.on(
				"agent-client:approve-active-permission",
				(targetViewId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					void (async () => {
						const success =
							await approveActivePermissionRef.current();
						if (!success) {
							new Notice(
								"[Agent Client] No active permission request",
							);
						}
					})();
				},
			),

			// Reject active permission
			ws.on(
				"agent-client:reject-active-permission",
				(targetViewId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					void (async () => {
						const success =
							await rejectActivePermissionRef.current();
						if (!success) {
							new Notice(
								"[Agent Client] No active permission request",
							);
						}
					})();
				},
			),

			// Cancel current message
			ws.on("agent-client:cancel-message", (targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) return;
				void handleStopGenerationRef.current();
			}),

			// Export chat
			ws.on("agent-client:export-chat", (targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) return;
				void handleExportChatRef.current();
			}),
		];

		return () => {
			for (const ref of refs) {
				workspace.offref(ref);
			}
		};
		// Deps kept verbatim from the pre-extraction ChatPanel effect:
		// plugin.lastActiveChatViewId is not referenced in the body, but
		// removing it would change when the listeners re-register.
	}, [
		plugin.app.workspace,
		plugin.lastActiveChatViewId,
		viewId,
		variant,
		toggleAutoMention,
	]);
}
