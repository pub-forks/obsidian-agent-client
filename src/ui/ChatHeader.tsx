import * as React from "react";
const { useRef, useEffect, useMemo } = React;
import { setIcon, DropdownComponent } from "obsidian";
import { HeaderButton, IconButton } from "./shared/IconButton";
import type { AgentDisplayInfo } from "../services/session-helpers";

/** Stable empty list for the pinned-agent case (no switchable agents). */
const EMPTY_AGENTS: AgentDisplayInfo[] = [];

/**
 * Selector options = enabled agents, plus the active agent appended as an
 * explicit "(disabled)" option when it is not in the enabled enumeration
 * (kept session or pinned block on a disabled agent). Without it the
 * dropdown's setValue silently no-ops and the selector renders blank.
 * Returns `availableAgents` by reference when no append is needed, so the
 * dropdown-rebuild effect doesn't re-run on ordinary agent switches.
 */
function useSelectorAgents(
	availableAgents: AgentDisplayInfo[] | undefined,
	currentAgentId: string | undefined,
	agentLabel: string,
): AgentDisplayInfo[] {
	return useMemo(() => {
		if (!availableAgents) return EMPTY_AGENTS;
		if (
			!currentAgentId ||
			availableAgents.some((agent) => agent.id === currentAgentId)
		) {
			return availableAgents;
		}
		return [
			...availableAgents,
			{ id: currentAgentId, displayName: `${agentLabel} (disabled)` },
		];
	}, [availableAgents, currentAgentId, agentLabel]);
}

/**
 * Shared agent-selector dropdown logic for FloatingHeader / EmbeddedHeader.
 *
 * Builds an Obsidian DropdownComponent inside `dropdownContainerRef` when
 * there is more than one selectable agent, keeps its value in sync with
 * `currentAgentId`, and renders the chevron icon into `chevronRef`.
 * `onAgentChange` is read through a ref so the build effect only depends on
 * `selectorAgents` (which `useSelectorAgents` keeps referentially stable).
 */
function useAgentDropdown({
	selectorAgents,
	currentAgentId,
	onAgentChange,
}: {
	selectorAgents: AgentDisplayInfo[];
	currentAgentId: string | undefined;
	onAgentChange: ((agentId: string) => void) | undefined;
}): {
	dropdownContainerRef: React.RefObject<HTMLDivElement>;
	chevronRef: React.RefObject<HTMLSpanElement>;
} {
	const dropdownContainerRef = useRef<HTMLDivElement>(null);
	const dropdownInstance = useRef<DropdownComponent | null>(null);
	const chevronRef = useRef<HTMLSpanElement>(null);

	// Stable ref for onAgentChange callback
	const onAgentChangeRef = useRef(onAgentChange);
	onAgentChangeRef.current = onAgentChange;

	// Initialize agent dropdown
	useEffect(() => {
		const containerEl = dropdownContainerRef.current;
		if (!containerEl) return;

		// Only show dropdown if there are multiple agents
		if (selectorAgents.length <= 1) {
			if (dropdownInstance.current) {
				containerEl.empty();
				dropdownInstance.current = null;
			}
			return;
		}

		// Create dropdown if not exists
		if (!dropdownInstance.current) {
			const dropdown = new DropdownComponent(containerEl);
			dropdownInstance.current = dropdown;

			// Add options
			for (const agent of selectorAgents) {
				dropdown.addOption(agent.id, agent.displayName);
			}

			// Set initial value
			if (currentAgentId) {
				dropdown.setValue(currentAgentId);
			}

			// Handle change
			dropdown.onChange((value) => {
				onAgentChangeRef.current?.(value);
			});
		}

		// Cleanup on unmount or when the selector options change
		return () => {
			if (dropdownInstance.current) {
				containerEl.empty();
				dropdownInstance.current = null;
			}
		};
		// currentAgentId is intentionally omitted: it is only read when the
		// dropdown is first created; later changes go through the sync effect.
	}, [selectorAgents]);

	// Update dropdown value when currentAgentId changes
	useEffect(() => {
		if (dropdownInstance.current && currentAgentId) {
			dropdownInstance.current.setValue(currentAgentId);
		}
	}, [currentAgentId]);

	// Render the chevron icon whenever the selector (re)appears.
	// The chevron span only mounts/unmounts when `selectorAgents` changes.
	useEffect(() => {
		if (chevronRef.current) {
			setIcon(chevronRef.current, "chevron-down");
		}
	}, [selectorAgents]);

	return { dropdownContainerRef, chevronRef };
}

// ============================================================================
// Props Types
// ============================================================================

/**
 * Props for the sidebar variant of ChatHeader
 */
export interface SidebarHeaderProps {
	variant: "sidebar";
	/** Display name of the active agent */
	agentLabel: string;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Callback to create a new chat session */
	onNewChat: () => void;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to show the header menu at the click position */
	onShowMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
	/** Callback to open session history */
	onOpenHistory?: () => void;
}

/**
 * Props for the floating variant of ChatHeader
 */
export interface FloatingHeaderProps {
	variant: "floating";
	/** Display name of the active agent */
	agentLabel: string;
	/** Available agents for switching */
	availableAgents: AgentDisplayInfo[];
	/** Current agent ID */
	currentAgentId: string;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Callback to switch agent */
	onAgentChange: (agentId: string) => void;
	/** Callback to show the More menu at the click position */
	onShowMenu: (e: React.MouseEvent<HTMLElement>) => void;
	/** Callback to minimize window (floating only) */
	onMinimize?: () => void;
	/** Callback to close and terminate window (floating only) */
	onClose?: () => void;
}

/**
 * Props for the embedded variant of ChatHeader
 * (used in code-block / embedded chat contexts).
 *
 * Unlike FloatingHeaderProps, the agent-selection fields are optional:
 * when the block pins an agent (config.agent set), ChatPanel passes
 * `undefined` so the selector is hidden and switching is disabled.
 */
export interface EmbeddedHeaderProps {
	variant: "embedded";
	/** Display name of the active agent */
	agentLabel: string;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Available agents for switching (omitted when the block pins an agent) */
	availableAgents?: AgentDisplayInfo[];
	/** Current agent ID */
	currentAgentId?: string;
	/** Callback to switch agent (omitted when the block pins an agent) */
	onAgentChange?: (agentId: string) => void;
	/** Callback to show the More menu at the click position */
	onShowMenu: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Union type for ChatHeader props - dispatches based on variant
 */
export type ChatHeaderProps =
	| SidebarHeaderProps
	| FloatingHeaderProps
	| EmbeddedHeaderProps;

// ============================================================================
// Internal Components
// ============================================================================

/**
 * A single action button matching Obsidian's nav-action-button pattern.
 * Thin wrapper around the shared IconButton with the nav-action classes.
 */
function NavActionButton({
	icon,
	label,
	onClick,
}: {
	icon: string;
	label: string;
	onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
	return (
		<IconButton
			iconName={icon}
			label={label}
			className="clickable-icon nav-action-button"
			onClick={onClick}
		/>
	);
}

// ============================================================================
// Sidebar Header
// ============================================================================

/**
 * Header component for the sidebar chat view.
 *
 * Uses Obsidian's native .nav-header + .nav-buttons-container pattern
 * to match the look of File Explorer, Bookmarks, and other sidebar panes.
 */
function SidebarHeader({
	agentLabel,
	isUpdateAvailable,
	onNewChat,
	onExportChat,
	onShowMenu,
	onOpenHistory,
}: SidebarHeaderProps) {
	return (
		<div className="nav-header agent-client-chat-view-header">
			<div className="nav-buttons-container">
				<span className="agent-client-chat-view-header-title">
					{agentLabel}
				</span>
				{isUpdateAvailable && (
					<span className="agent-client-chat-view-header-update">
						Plugin update available!
					</span>
				)}
				<NavActionButton
					icon="plus"
					label="New chat"
					onClick={onNewChat}
				/>
				{onOpenHistory && (
					<NavActionButton
						icon="history"
						label="Session history"
						onClick={onOpenHistory}
					/>
				)}
				<NavActionButton
					icon="save"
					label="Export chat to Markdown"
					onClick={onExportChat}
				/>
				<NavActionButton
					icon="more-vertical"
					label="More"
					onClick={onShowMenu}
				/>
			</div>
		</div>
	);
}

// ============================================================================
// Floating Header
// ============================================================================

/**
 * Inline header component for Floating and CodeBlock chat views.
 *
 * Features:
 * - Agent selector
 * - Update notification (if available)
 * - Action buttons with Lucide icons (new chat, history, export, restart)
 * - Minimize and close buttons (floating variant only)
 */
function FloatingHeader({
	agentLabel,
	availableAgents,
	currentAgentId,
	isUpdateAvailable,
	onAgentChange,
	onShowMenu,
	onMinimize,
	onClose,
}: FloatingHeaderProps) {
	const selectorAgents = useSelectorAgents(
		availableAgents,
		currentAgentId,
		agentLabel,
	);

	const { dropdownContainerRef, chevronRef } = useAgentDropdown({
		selectorAgents,
		currentAgentId,
		onAgentChange,
	});

	return (
		<div
			className={`agent-client-inline-header agent-client-inline-header-floating`}
		>
			<div className="agent-client-inline-header-main">
				{selectorAgents.length > 1 ? (
					<div className="agent-client-agent-selector">
						<div ref={dropdownContainerRef} />
						<span
							className="agent-client-agent-selector-icon"
							ref={chevronRef}
						/>
					</div>
				) : (
					<span className="agent-client-agent-label">
						{agentLabel}
					</span>
				)}
			</div>
			{isUpdateAvailable && (
				<p className="agent-client-chat-view-header-update">
					Plugin update available!
				</p>
			)}
			<div className="agent-client-inline-header-actions">
				<HeaderButton
					iconName="more-vertical"
					tooltip="More"
					onClick={onShowMenu}
				/>
				{onMinimize && (
					<HeaderButton
						iconName="minimize-2"
						tooltip="Minimize"
						onClick={onMinimize}
					/>
				)}
				{onClose && (
					<HeaderButton
						iconName="x"
						tooltip="Close"
						onClick={onClose}
					/>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Embedded Header
// ============================================================================

/**
 * Inline header component for embedded (code-block) chat views.
 *
 * Mirrors FloatingHeader's layout/agent-dropdown logic, but:
 * - has no minimize/close buttons (not a windowed view)
 * - hides the agent selector when no switchable agents are provided
 *   (i.e. the block pins an agent, or only one agent is available)
 */
function EmbeddedHeader({
	agentLabel,
	availableAgents,
	currentAgentId,
	isUpdateAvailable,
	onAgentChange,
	onShowMenu,
}: EmbeddedHeaderProps) {
	const selectorAgents = useSelectorAgents(
		availableAgents,
		currentAgentId,
		agentLabel,
	);

	const { dropdownContainerRef, chevronRef } = useAgentDropdown({
		selectorAgents,
		currentAgentId,
		onAgentChange,
	});

	const hasSelector = selectorAgents.length > 1;

	return (
		<div className="agent-client-inline-header agent-client-inline-header-embedded">
			<div className="agent-client-inline-header-main">
				{hasSelector ? (
					<div className="agent-client-agent-selector">
						<div ref={dropdownContainerRef} />
						<span
							className="agent-client-agent-selector-icon"
							ref={chevronRef}
						/>
					</div>
				) : (
					<span className="agent-client-agent-label">
						{agentLabel}
					</span>
				)}
			</div>
			{isUpdateAvailable && (
				<p className="agent-client-chat-view-header-update">
					Plugin update available!
				</p>
			)}
			<div className="agent-client-inline-header-actions">
				<HeaderButton
					iconName="more-vertical"
					tooltip="More"
					onClick={onShowMenu}
				/>
			</div>
		</div>
	);
}

// ============================================================================
// Exported ChatHeader (Dispatcher)
// ============================================================================

/**
 * ChatHeader component that dispatches to SidebarHeader, FloatingHeader,
 * or EmbeddedHeader based on the `variant` prop.
 */
export function ChatHeader(props: ChatHeaderProps) {
	if (props.variant === "embedded") {
		return <EmbeddedHeader {...props} />;
	}
	if (props.variant === "floating") {
		return <FloatingHeader {...props} />;
	}
	return <SidebarHeader {...props} />;
}
