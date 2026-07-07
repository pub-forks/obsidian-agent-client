import * as React from "react";
const { useRef, useState, useEffect, useCallback } = React;
import { setIcon } from "obsidian";

import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import type { NoteMetadata } from "../services/vault-service";
import type {
	SlashCommand,
	SessionModeState,
	SessionUsage,
	SessionConfigOption,
} from "../types/session";
import type { AttachedFile, ChatMessage } from "../types/chat";
import type { UseSuggestionsReturn } from "../hooks/useSuggestions";
import { useInputHistory } from "../hooks/useInputHistory";
import { useAttachments } from "../hooks/useAttachments";
import { SuggestionPopup } from "./SuggestionPopup";
import { ErrorBanner } from "./ErrorBanner";
import { AttachmentStrip } from "./shared/AttachmentStrip";
import { InputToolbar } from "./InputToolbar";
import { getLogger } from "../utils/logger";
import type { ErrorInfo } from "../types/errors";
import type { AgentUpdateNotification } from "../services/update-checker";
import { useSettings } from "../hooks/useSettings";
import { getObsidianSpellcheck } from "../services/obsidian-internals";

/**
 * Highest-priority overlay notice resolved by ChatPanel
 * (error > agent update > Gemini notice).
 *
 * Lower-priority notices are hidden, not cleared — their state stays with
 * each owner, so they reappear when the higher-priority one clears.
 */
export interface ActiveNotice {
	/** Notice payload (ErrorInfo has no `variant`; AgentUpdateNotification does) */
	info: ErrorInfo | AgentUpdateNotification;
	/** Callback to dismiss this notice */
	onClear: () => void;
}

/**
 * Props for InputArea component
 */
// ============================================================================
// InputArea Component
// ============================================================================

export interface InputAreaProps {
	/** Whether a message is currently being sent */
	isSending: boolean;
	/** Whether the session is ready for user input */
	isSessionReady: boolean;
	/** Whether a session is being restored (load/resume/fork) */
	isRestoringSession: boolean;
	/** Display name of the active agent */
	agentLabel: string;
	/** Available slash commands */
	availableCommands: SlashCommand[];
	/** Whether auto-mention setting is enabled */
	autoMentionEnabled: boolean;
	/** Message to restore (e.g., after cancellation) */
	restoredMessage: string | null;
	/** Input suggestions (mentions + slash commands) */
	suggestions: UseSuggestionsReturn;
	/** Plugin instance */
	plugin: AgentClientPlugin;
	/** View instance for event registration */
	view: IChatViewHost;
	/** Callback to send a message with optional attachments */
	onSendMessage: (
		content: string,
		attachments?: AttachedFile[],
	) => Promise<void>;
	/** Callback to stop the current generation */
	onStopGeneration: () => Promise<void>;
	/** Callback when restored message has been consumed */
	onRestoredMessageConsumed: () => void;
	/** Session mode state (available modes and current mode) */
	modes?: SessionModeState;
	/** Callback when mode is changed */
	onModeChange?: (modeId: string) => void;
	/** Session config options (supersedes modes/models when present) */
	configOptions?: SessionConfigOption[];
	/** Callback when a config option is changed */
	onConfigOptionChange?: (configId: string, value: string) => void;
	/** Context window usage (shown as percentage indicator) */
	usage?: SessionUsage;
	/** Whether the agent supports image attachments */
	supportsImages?: boolean;
	/** Current agent ID (used to clear images on agent switch) */
	agentId: string;
	// Controlled component props (for broadcast commands)
	/** Current input text value */
	inputValue: string;
	/** Callback when input text changes */
	onInputChange: (value: string) => void;
	/** Currently attached files (images and non-image files) */
	attachedFiles: AttachedFile[];
	/** Callback when attached files change */
	onAttachedFilesChange: (files: AttachedFile[]) => void;
	/** Highest-priority notice to display as overlay (null = no overlay) */
	activeNotice: ActiveNotice | null;
	/** Messages array for input history navigation */
	messages: ChatMessage[];
}

/**
 * Input component for the chat view.
 *
 * Handles:
 * - Text input with auto-resize
 * - Mention dropdown (@-mentions)
 * - Slash command dropdown (/-commands)
 * - Auto-mention badge
 * - Hint overlay for slash commands
 * - Send/stop button
 * - Keyboard navigation
 */
export function InputArea({
	isSending,
	isSessionReady,
	isRestoringSession,
	agentLabel,
	availableCommands,
	autoMentionEnabled,
	restoredMessage,
	suggestions,
	plugin,
	view,
	onSendMessage,
	onStopGeneration,
	onRestoredMessageConsumed,
	modes,
	onModeChange,
	configOptions,
	onConfigOptionChange,
	usage,
	supportsImages = false,
	agentId,
	// Controlled component props
	inputValue,
	onInputChange,
	attachedFiles,
	onAttachedFilesChange,
	// Notice overlay (priority resolved by ChatPanel)
	activeNotice,
	// Input history
	messages,
}: InputAreaProps) {
	const { mentions, commands: slashCommands } = suggestions;
	const logger = getLogger();
	const settings = useSettings(plugin);
	const showEmojis = plugin.settings.displaySettings.showEmojis;

	// Unofficial Obsidian API (see src/services/obsidian-internals.ts)
	const obsidianSpellcheck = getObsidianSpellcheck(plugin.app);

	// Local state (hint and command are still local - not needed for broadcast)
	const [hintText, setHintText] = useState<string | null>(null);
	const [commandText, setCommandText] = useState<string>("");

	const { handleHistoryKeyDown, resetHistory } = useInputHistory(
		messages,
		onInputChange,
	);

	// Attachment handling (paste + drag & drop); state stays in the parent
	const { isDraggingOver, handlePaste, dragHandlers } = useAttachments({
		attachedFiles,
		onAttachedFilesChange,
		supportsImages,
	});

	// Refs
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Clear attached files when agent changes
	useEffect(() => {
		onAttachedFilesChange([]);
	}, [agentId, onAttachedFilesChange]);

	/**
	 * Remove a file from the attached files list.
	 */
	const removeFile = useCallback(
		(id: string) => {
			onAttachedFilesChange(attachedFiles.filter((f) => f.id !== id));
			textareaRef.current?.focus();
		},
		[attachedFiles, onAttachedFilesChange],
	);

	/**
	 * Common logic for setting cursor position after text replacement.
	 */
	const setTextAndFocus = useCallback(
		(newText: string) => {
			onInputChange(newText);

			// Set cursor position to end of text
			window.setTimeout(() => {
				const textarea = textareaRef.current;
				if (textarea) {
					const cursorPos = newText.length;
					textarea.selectionStart = cursorPos;
					textarea.selectionEnd = cursorPos;
					textarea.focus();
				}
			}, 0);
		},
		[onInputChange],
	);

	/**
	 * Handle mention selection from dropdown.
	 */
	const selectMention = useCallback(
		(suggestion: NoteMetadata) => {
			const newText = mentions.selectSuggestion(inputValue, suggestion);
			setTextAndFocus(newText);
		},
		[mentions, inputValue, setTextAndFocus],
	);

	/**
	 * Handle slash command selection from dropdown.
	 */
	const handleSelectSlashCommand = useCallback(
		(command: SlashCommand) => {
			const newText = slashCommands.selectSuggestion(inputValue, command);
			onInputChange(newText);

			// Setup hint overlay if command has hint
			if (command.hint) {
				const cmdText = `/${command.name} `;
				setCommandText(cmdText);
				setHintText(command.hint);
			} else {
				// No hint - clear hint state
				setHintText(null);
				setCommandText("");
			}

			// Place cursor right after command name (before hint text)
			window.setTimeout(() => {
				const textarea = textareaRef.current;
				if (textarea) {
					const cursorPos = command.hint
						? `/${command.name} `.length
						: newText.length;
					textarea.selectionStart = cursorPos;
					textarea.selectionEnd = cursorPos;
					textarea.focus();
				}
			}, 0);
		},
		[slashCommands, inputValue, onInputChange],
	);

	/**
	 * Adjust textarea height based on content.
	 */
	const adjustTextareaHeight = useCallback(() => {
		const textarea = textareaRef.current;
		if (textarea) {
			// Remove previous dynamic height classes
			textarea.classList.remove(
				"agent-client-textarea-auto-height",
				"agent-client-textarea-expanded",
			);

			// Temporarily use auto to measure
			textarea.classList.add("agent-client-textarea-auto-height");
			const scrollHeight = textarea.scrollHeight;
			const minHeight = 80;
			const maxHeight = 300;

			// Calculate height
			const calculatedHeight = Math.max(
				minHeight,
				Math.min(scrollHeight, maxHeight),
			);

			// Apply expanded class if needed
			if (calculatedHeight > minHeight) {
				textarea.classList.add("agent-client-textarea-expanded");
				// Set CSS variable for dynamic height
				textarea.style.setProperty(
					"--textarea-height",
					`${calculatedHeight}px`,
				);
			} else {
				textarea.style.removeProperty("--textarea-height");
			}

			textarea.classList.remove("agent-client-textarea-auto-height");
		}
	}, []);

	/**
	 * Handle sending or stopping based on current state.
	 */
	const handleSendOrStop = useCallback(async () => {
		if (isSending) {
			await onStopGeneration();
			return;
		}

		// Allow sending if there's text OR attachments
		if (!inputValue.trim() && attachedFiles.length === 0) return;

		// Save input value and files before clearing
		const messageToSend = inputValue.trim();
		const filesToSend =
			attachedFiles.length > 0 ? [...attachedFiles] : undefined;

		// Clear input, files, and hint state immediately
		onInputChange("");
		onAttachedFilesChange([]);
		setHintText(null);
		setCommandText("");
		resetHistory();

		await onSendMessage(messageToSend, filesToSend);
	}, [
		isSending,
		inputValue,
		attachedFiles,
		onSendMessage,
		onStopGeneration,
		onInputChange,
		onAttachedFilesChange,
		resetHistory,
	]);

	/**
	 * Handle dropdown keyboard navigation.
	 */
	const handleDropdownKeyPress = useCallback(
		(e: React.KeyboardEvent): boolean => {
			const isSlashCommandActive = slashCommands.isOpen;
			const isMentionActive = mentions.isOpen;

			if (!isSlashCommandActive && !isMentionActive) {
				return false;
			}

			// Arrow navigation
			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (isSlashCommandActive) {
					slashCommands.navigate("down");
				} else {
					mentions.navigate("down");
				}
				return true;
			}

			if (e.key === "ArrowUp") {
				e.preventDefault();
				if (isSlashCommandActive) {
					slashCommands.navigate("up");
				} else {
					mentions.navigate("up");
				}
				return true;
			}

			// Select item (Enter or Tab)
			if (e.key === "Enter" || e.key === "Tab") {
				// Skip Enter during IME composition (allow Tab to still work)
				if (e.key === "Enter" && e.nativeEvent.isComposing) {
					return false;
				}
				e.preventDefault();
				if (isSlashCommandActive) {
					const selectedCommand =
						slashCommands.suggestions[slashCommands.selectedIndex];
					if (selectedCommand) {
						handleSelectSlashCommand(selectedCommand);
					}
				} else {
					const selectedSuggestion =
						mentions.suggestions[mentions.selectedIndex];
					if (selectedSuggestion) {
						selectMention(selectedSuggestion);
					}
				}
				return true;
			}

			// Close dropdown (Escape)
			if (e.key === "Escape") {
				e.preventDefault();
				if (isSlashCommandActive) {
					slashCommands.close();
				} else {
					mentions.close();
				}
				return true;
			}

			return false;
		},
		[slashCommands, mentions, handleSelectSlashCommand, selectMention],
	);

	// Button disabled state - also allow sending if files are attached
	const isButtonDisabled =
		!isSending &&
		((inputValue.trim() === "" && attachedFiles.length === 0) ||
			!isSessionReady ||
			isRestoringSession);

	/**
	 * Handle keyboard events in the textarea.
	 */
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			// Handle dropdown navigation first
			if (handleDropdownKeyPress(e)) {
				return;
			}

			// Handle input history navigation (ArrowUp/ArrowDown)
			if (handleHistoryKeyDown(e, textareaRef.current)) {
				return;
			}

			// Normal input handling - check if should send based on shortcut setting
			const hasCmdCtrl = e.metaKey || e.ctrlKey;
			if (
				e.key === "Enter" &&
				(!e.nativeEvent.isComposing || hasCmdCtrl)
			) {
				const shouldSend =
					settings.sendMessageShortcut === "enter"
						? !e.shiftKey // Enter mode: send unless Shift is pressed
						: hasCmdCtrl; // Cmd+Enter mode: send only with Cmd/Ctrl

				if (shouldSend) {
					e.preventDefault();
					if (!isButtonDisabled && !isSending) {
						void handleSendOrStop();
					}
				}
				// If not shouldSend, allow default behavior (newline)
			}
		},
		[
			handleDropdownKeyPress,
			handleHistoryKeyDown,
			isSending,
			isButtonDisabled,
			handleSendOrStop,
			settings.sendMessageShortcut,
		],
	);

	/**
	 * Handle input changes in the textarea.
	 */
	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const newValue = e.target.value;
			const cursorPosition = e.target.selectionStart || 0;

			onInputChange(newValue);

			// Hide hint overlay when user modifies the input
			if (hintText) {
				const expectedText = commandText + hintText;
				if (newValue !== expectedText) {
					setHintText(null);
					setCommandText("");
				}
			}

			// Update mention suggestions
			void mentions.updateSuggestions(newValue, cursorPosition);

			// Update slash command suggestions
			slashCommands.updateSuggestions(newValue, cursorPosition);
		},
		[logger, hintText, commandText, mentions, slashCommands, onInputChange],
	);

	// Adjust textarea height when input changes
	useEffect(() => {
		adjustTextareaHeight();
	}, [inputValue, adjustTextareaHeight]);

	// Auto-focus textarea on mount
	useEffect(() => {
		window.setTimeout(() => {
			if (textareaRef.current) {
				textareaRef.current.focus();
			}
		}, 0);
	}, []);

	// Restore message when provided (e.g., after cancellation)
	// Only restore if input is empty to avoid overwriting user's new input
	useEffect(() => {
		if (restoredMessage) {
			if (!inputValue.trim()) {
				onInputChange(restoredMessage);
				// Focus and place cursor at end
				window.setTimeout(() => {
					if (textareaRef.current) {
						textareaRef.current.focus();
						textareaRef.current.selectionStart =
							restoredMessage.length;
						textareaRef.current.selectionEnd =
							restoredMessage.length;
					}
				}, 0);
			}
			onRestoredMessageConsumed();
		}
	}, [restoredMessage, onRestoredMessageConsumed, inputValue, onInputChange]);

	// Placeholder text
	const placeholder = `Message ${agentLabel} - @ to mention notes${availableCommands.length > 0 ? ", / for commands" : ""}`;

	return (
		<div className="agent-client-chat-input-container">
			{/* Notice Overlay - displayed above input (priority resolved by ChatPanel) */}
			{activeNotice && (
				<ErrorBanner
					errorInfo={activeNotice.info}
					onClose={activeNotice.onClear}
					showEmojis={showEmojis}
					view={view}
					variant={
						"variant" in activeNotice.info
							? activeNotice.info.variant
							: "error"
					}
				/>
			)}

			{/* Mention Dropdown */}
			{mentions.isOpen && (
				<SuggestionPopup
					type="mention"
					items={mentions.suggestions}
					selectedIndex={mentions.selectedIndex}
					onSelect={selectMention}
					onClose={mentions.close}
				/>
			)}

			{/* Slash Command Dropdown */}
			{slashCommands.isOpen && (
				<SuggestionPopup
					type="slash-command"
					items={slashCommands.suggestions}
					selectedIndex={slashCommands.selectedIndex}
					onSelect={handleSelectSlashCommand}
					onClose={slashCommands.close}
				/>
			)}

			{/* Input Box - flexbox container with border */}
			<div
				className={`agent-client-chat-input-box ${isDraggingOver ? "agent-client-dragging-over" : ""}`}
				{...dragHandlers}
			>
				{/* Auto-mention Badge */}
				{mentions.activeNote && (
					<button
						className="agent-client-auto-mention-inline"
						onClick={() =>
							mentions.toggleAutoMention(
								!mentions.isAutoMentionDisabled,
							)
						}
						title={
							mentions.isAutoMentionDisabled
								? "Enable auto-mention"
								: "Temporarily disable auto-mention"
						}
					>
						<span
							className={`agent-client-mention-badge ${mentions.isAutoMentionDisabled ? "agent-client-disabled" : ""}`}
						>
							@{mentions.activeNote.name}
							{mentions.activeNote.selection && (
								<span className="agent-client-selection-indicator">
									{":"}
									{mentions.activeNote.selection.from.line +
										1}
									-{mentions.activeNote.selection.to.line + 1}
								</span>
							)}
						</span>
						<span
							className="agent-client-auto-mention-toggle-icon"
							ref={(el) => {
								if (el) {
									const iconName =
										mentions.isAutoMentionDisabled
											? "plus"
											: "x";
									setIcon(el, iconName);
								}
							}}
						/>
					</button>
				)}

				{/* Textarea with Hint Overlay */}
				<div className="agent-client-textarea-wrapper">
					<textarea
						ref={textareaRef}
						value={inputValue}
						onChange={handleInputChange}
						onKeyDown={handleKeyDown}
						onPaste={handlePaste}
						placeholder={placeholder}
						className={`agent-client-chat-input-textarea ${mentions.activeNote ? "has-auto-mention" : ""}`}
						rows={1}
						spellCheck={obsidianSpellcheck}
					/>
					{hintText && (
						<div
							className="agent-client-hint-overlay"
							aria-hidden="true"
						>
							<span className="agent-client-invisible">
								{commandText}
							</span>
							<span className="agent-client-hint-text">
								{hintText}
							</span>
						</div>
					)}
				</div>

				{/* Attachment Preview Strip (images + file references) */}
				<AttachmentStrip files={attachedFiles} onRemove={removeFile} />

				{/* Input Actions (Config Options / Mode Selector / Model Selector + Send Button) */}
				<InputToolbar
					isSending={isSending}
					isButtonDisabled={isButtonDisabled}
					hasContent={
						inputValue.trim() !== "" || attachedFiles.length > 0
					}
					onSendOrStop={() => void handleSendOrStop()}
					modes={modes}
					onModeChange={onModeChange}
					configOptions={configOptions}
					onConfigOptionChange={onConfigOptionChange}
					usage={usage}
					isSessionReady={isSessionReady}
				/>
			</div>
		</div>
	);
}
