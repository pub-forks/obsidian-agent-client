import * as React from "react";
const { useState, useEffect } = React;

import type AgentClientPlugin from "../plugin";

export interface UsePendingPromptOptions {
	plugin: AgentClientPlugin;
	viewId: string;
	/** Must be referentially stable (the handler registers once per [plugin, viewId]). */
	setInputValue: (value: string) => void;
	/** Clears staged attachments. Must be referentially stable. */
	clearAttachments: () => void;
	isSessionReady: boolean;
	isSending: boolean;
	/** sessionHistory.loading */
	isRestoringSession: boolean;
	sendMessage: (content: string) => Promise<void>;
}

/**
 * Receives prompts injected by the plugin (agent buttons, commands): registers
 * the pending-prompt handler on mount and drains a queued auto-send once the
 * session is ready.
 */
export function usePendingPrompt({
	plugin,
	viewId,
	setInputValue,
	clearAttachments,
	isSessionReady,
	isSending,
	isRestoringSession,
	sendMessage,
}: UsePendingPromptOptions): void {
	// Pending auto-send queued by the pending-prompt handler (drained when ready)
	const [pendingAutoSend, setPendingAutoSend] = useState<string | null>(null);

	// Deterministic prompt delivery: register a handler the plugin invokes
	// directly (or that drains a queued prompt) instead of a timed workspace
	// broadcast. setInputValue / setPendingAutoSend are stable useState
	// setters, so [plugin, viewId] deps suffice.
	useEffect(() => {
		return plugin.registerPendingPromptHandler(
			viewId,
			(prompt, autoSend) => {
				if (typeof prompt !== "string" || prompt.length === 0) return;
				setInputValue(prompt);
				// Injected prompts are a fresh message — don't carry over any
				// attachments already staged in this panel (#341/#6).
				clearAttachments();
				if (autoSend) setPendingAutoSend(prompt);
			},
		);
	}, [plugin, viewId]);

	// Drain pending auto-send when session becomes ready
	useEffect(() => {
		if (!pendingAutoSend) return;
		if (!isSessionReady) return;
		if (isSending) return;
		if (isRestoringSession) return;

		const prompt = pendingAutoSend;
		setPendingAutoSend(null);
		setInputValue("");
		void sendMessage(prompt);
	}, [
		pendingAutoSend,
		isSessionReady,
		isSending,
		isRestoringSession,
		sendMessage,
	]);
}
