import * as React from "react";
const { useRef, useCallback, useMemo } = React;

import type { ChatMessage } from "../types/chat";

/**
 * Hook for navigating through previous user messages with ArrowUp/ArrowDown.
 */
export function useInputHistory(
	messages: ChatMessage[],
	onInputChange: (value: string) => void,
): {
	handleHistoryKeyDown: (
		e: React.KeyboardEvent,
		textareaEl: HTMLTextAreaElement | null,
	) => boolean;
	resetHistory: () => void;
} {
	const historyIndexRef = useRef(-1);
	const restoredTextRef = useRef<string | null>(null);

	const userMessages = useMemo(() => {
		return messages
			.filter((m) => m.role === "user")
			.map((m) => {
				const textContent = m.content.find(
					(c) => c.type === "text" || c.type === "text_with_context",
				);
				return textContent && "text" in textContent
					? textContent.text
					: "";
			})
			.filter((text) => text.trim() !== "");
	}, [messages]);

	const handleHistoryKeyDown = useCallback(
		(
			e: React.KeyboardEvent,
			textareaEl: HTMLTextAreaElement | null,
		): boolean => {
			if (!textareaEl) return false;
			if (e.nativeEvent.isComposing) return false;
			if (userMessages.length === 0) return false;

			// Exit history mode if user edited text or moved cursor
			if (historyIndexRef.current !== -1) {
				if (
					e.key === "ArrowLeft" ||
					e.key === "ArrowRight" ||
					(restoredTextRef.current !== null &&
						textareaEl.value !== restoredTextRef.current)
				) {
					historyIndexRef.current = -1;
					restoredTextRef.current = null;
					return false;
				}
			}

			if (e.key === "ArrowUp") {
				if (
					textareaEl.value.trim() !== "" &&
					historyIndexRef.current === -1
				)
					return false;

				e.preventDefault();

				const nextIndex = historyIndexRef.current + 1;
				if (nextIndex >= userMessages.length) {
					return true;
				}

				historyIndexRef.current = nextIndex;
				const messageText =
					userMessages[userMessages.length - 1 - nextIndex];
				restoredTextRef.current = messageText;
				onInputChange(messageText);

				window.setTimeout(() => {
					textareaEl.selectionStart = messageText.length;
					textareaEl.selectionEnd = messageText.length;
				}, 0);

				return true;
			}

			if (e.key === "ArrowDown") {
				const currentIndex = historyIndexRef.current;
				if (currentIndex === -1) return false;

				e.preventDefault();

				const nextIndex = currentIndex - 1;
				historyIndexRef.current = nextIndex;

				if (nextIndex === -1) {
					restoredTextRef.current = null;
					onInputChange("");
				} else {
					const messageText =
						userMessages[userMessages.length - 1 - nextIndex];
					restoredTextRef.current = messageText;
					onInputChange(messageText);

					window.setTimeout(() => {
						textareaEl.selectionStart = messageText.length;
						textareaEl.selectionEnd = messageText.length;
					}, 0);
				}

				return true;
			}

			return false;
		},
		[userMessages, onInputChange],
	);

	const resetHistory = useCallback(() => {
		historyIndexRef.current = -1;
		restoredTextRef.current = null;
	}, []);

	return { handleHistoryKeyDown, resetHistory };
}
