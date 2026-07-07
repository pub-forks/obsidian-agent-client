import * as React from "react";
const { useEffect } = React;

import type { ChatMessage } from "../types/chat";
import type { SessionState } from "../types/session";
import type { ChatViewRegistry } from "../services/view-registry";

export interface UseViewRegistryNotifierOptions {
	viewRegistry: ChatViewRegistry;
	sessionState: SessionState;
	sessionId: string | null;
	isSending: boolean;
	hasActivePermission: boolean;
	/** sessionHistory.loading */
	isRestoringSession: boolean;
	messages: ChatMessage[];
}

/**
 * Notifies the view registry (Session Manager) when this panel's
 * user-visible state changes.
 */
export function useViewRegistryNotifier({
	viewRegistry,
	sessionState,
	sessionId,
	isSending,
	hasActivePermission,
	isRestoringSession,
	messages,
}: UseViewRegistryNotifierOptions): void {
	// `hasMessages` flips false → true on first message and then stays stable
	// for the rest of the conversation. The Session Manager's title and
	// status only depend on this boolean transition, not on per-chunk growth,
	// so we avoid notifying on every streamed token.
	const hasMessages = messages.length > 0;
	useEffect(() => {
		viewRegistry.notifyChange();
	}, [
		viewRegistry,
		sessionState,
		sessionId,
		isSending,
		hasActivePermission,
		isRestoringSession,
		hasMessages,
	]);
}
