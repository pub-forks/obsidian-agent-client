import * as React from "react";
const { useRef, useEffect, useCallback } = React;

import type { ChatMessage } from "../types/chat";
import { getLogger } from "../utils/logger";

/** Debounce (ms) for re-saving when trailing chunks arrive after a turn ends (#320). */
const TRAILING_SAVE_DEBOUNCE_MS = 800;

export interface UseMessagePersistenceOptions {
	sessionId: string | null;
	messages: ChatMessage[];
	isSending: boolean;
	/** Local message persistence (from useSessionHistory). */
	saveSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;
	enableSystemNotifications: boolean;
	agentLabel: string;
}

export interface UseMessagePersistenceReturn {
	/**
	 * Synchronously flush unsaved trailing-chunk content. Called explicitly
	 * from ChatPanel's unmount cleanup BEFORE auto-export + closeSession, so
	 * the save → export → close order is controlled by the caller instead of
	 * relying on React's effect-cleanup ordering.
	 */
	flushNow: () => void;
}

/**
 * Persists session messages along three paths (#320):
 * (a) the isSending falling edge (turn end) — also emits the out-of-focus
 *     system notification, which lives in the same effect as the save,
 * (b) an 800ms trailing debounce for agents (e.g. OpenCode) that emit
 *     message chunks after end_turn,
 * (c) an explicit close-time flush (`flushNow`).
 *
 * All three are armed only after a real turn ran in THIS session
 * (`sentThisSessionRef`), so messages that were merely loaded/replayed are
 * never re-saved — which would bump updatedAt and corrupt "last used"
 * ordering.
 */
export function useMessagePersistence({
	sessionId,
	messages,
	isSending,
	saveSessionMessages,
	enableSystemNotifications,
	agentLabel,
}: UseMessagePersistenceOptions): UseMessagePersistenceReturn {
	const logger = getLogger();

	// True once the user has actually run a turn in THIS session. The
	// trailing-chunk re-save and close-time flush are armed only after a real
	// turn, so messages that were merely loaded/replayed are never re-saved
	// (which would bump updatedAt and corrupt "last used" ordering). (#320 review)
	const sentThisSessionRef = useRef(false);
	// Reference identity of the messages array last persisted to disk. Used to
	// de-duplicate the turn-end save, the trailing-chunk re-save, and the
	// close-time flush.
	const lastSavedMessagesRef = useRef<ChatMessage[] | null>(null);
	const prevIsSendingRef = useRef<boolean>(false);

	// Refs so flushNow() reads the latest values when invoked from the
	// caller's unmount cleanup (outside this hook's own effects).
	const messagesRef = useRef(messages);
	const sessionIdRef = useRef(sessionId);
	const saveSessionMessagesRef = useRef(saveSessionMessages);
	messagesRef.current = messages;
	sessionIdRef.current = sessionId;
	saveSessionMessagesRef.current = saveSessionMessages;

	// Re-loading/switching sessions disarms the trailing-chunk save & flush, so
	// freshly loaded/replayed messages are never re-saved (which would bump
	// updatedAt and corrupt "last used" ordering). (#320 review)
	useEffect(() => {
		sentThisSessionRef.current = false;
	}, [sessionId]);

	useEffect(() => {
		const wasSending = prevIsSendingRef.current;
		prevIsSendingRef.current = isSending;

		// Save when turn ends (isSending: true -> false) and has messages
		if (wasSending && !isSending && sessionId && messages.length > 0) {
			sentThisSessionRef.current = true;
			lastSavedMessagesRef.current = messages;
			saveSessionMessages(sessionId, messages);
			logger.log(`[ChatPanel] Session messages saved: ${sessionId}`);

			// System notification on response completion
			if (enableSystemNotifications && !activeDocument.hasFocus()) {
				new Notification("Agent Client", {
					body: `${agentLabel} has completed the response.`,
				});
			}
		}
	}, [
		isSending,
		sessionId,
		messages,
		saveSessionMessages,
		enableSystemNotifications,
		agentLabel,
		logger,
	]);

	// Some agents (e.g. OpenCode) emit trailing message chunks *after* end_turn,
	// so the turn-end save above runs before they arrive and the persisted copy
	// is truncated. Re-save when messages change while idle, debounced so rapid
	// trailing updates coalesce into a single write (avoids racing the file). (#320)
	useEffect(() => {
		if (isSending || !sessionId || messages.length === 0) return;
		if (!sentThisSessionRef.current) return;
		if (lastSavedMessagesRef.current === messages) return;
		const timer = window.setTimeout(() => {
			lastSavedMessagesRef.current = messages;
			saveSessionMessages(sessionId, messages);
		}, TRAILING_SAVE_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [isSending, sessionId, messages, saveSessionMessages]);

	const flushNow = useCallback(() => {
		// Flush trailing-chunk content the debounced save may not have
		// persisted yet (view closed within the debounce window). Only when a
		// real turn ran this session and there is unsaved content. (#320 review)
		const latest = messagesRef.current;
		const sid = sessionIdRef.current;
		if (
			sentThisSessionRef.current &&
			sid &&
			latest.length > 0 &&
			lastSavedMessagesRef.current !== latest
		) {
			saveSessionMessagesRef.current(sid, latest);
		}
	}, []);

	return { flushNow };
}
