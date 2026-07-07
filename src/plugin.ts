import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import { ChatView, VIEW_TYPE_CHAT } from "./ui/ChatView";
import { EmbeddedChatViewContainer } from "./ui/CodeBlockChatView";
import {
	SessionManagerView,
	VIEW_TYPE_SESSION_MANAGER,
} from "./ui/SessionManagerView";
import {
	createFloatingChat,
	FloatingViewContainer,
} from "./ui/FloatingChatView";
import { FloatingButtonContainer } from "./ui/FloatingButton";
import { ChatViewRegistry } from "./services/view-registry";
import {
	createSettingsService,
	type SettingsService,
} from "./services/settings-service";
import { AgentClientSettingTab } from "./ui/SettingsTab";
import { registerAllCommands } from "./ui/plugin-commands";
import { renderAgentBlock } from "./ui/agent-block-renderer";
import type { AcpClient } from "./acp/acp-client";
import type { AcpClientHost } from "./acp/host";
import { AcpClientPool } from "./services/acp-client-pool";
import { PromptRouter } from "./services/prompt-router";
import { EmbedIdInjector } from "./services/embed-id-injector";
import { checkPluginUpdate } from "./services/update-checker";
import {
	normalizeCustomAgent,
	ensureUniqueCustomAgentIds,
	normalizePresetAgents,
	defaultPresetAgentSettings,
	resolveDefaultAgentId,
	type ApiKeyMigrator,
	parseChatFontSize,
	str,
	bool,
	num,
	enumVal,
	obj,
	strRecord,
	nestedStrRecord,
	xyPoint,
} from "./services/settings-normalizer";
import { PRESET_AGENTS } from "./services/preset-agents";
import {
	getAvailableAgentsFromSettings,
	firstEnabledAgentId,
	repairNoEnabledAgents,
} from "./services/session-helpers";
import {
	AgentEnvVar,
	PresetAgentUserSettings,
	CustomAgentSettings,
} from "./types/agent";
import type { SavedSessionInfo } from "./types/session";
import { initializeLogger, getLogger } from "./utils/logger";

// Re-export for backward compatibility
export type { AgentEnvVar, PresetAgentUserSettings, CustomAgentSettings };

/**
 * Send message shortcut configuration.
 * - 'enter': Enter to send, Shift+Enter for newline (default)
 * - 'cmd-enter': Cmd/Ctrl+Enter to send, Enter for newline
 */
export type SendMessageShortcut = "enter" | "cmd-enter";

/**
 * Chat view location configuration.
 * - 'right-tab': Open in right pane as tabs (default)
 * - 'right-split': Open in right pane with vertical split
 * - 'editor-tab': Open in editor area as tabs
 * - 'editor-split': Open in editor area with right split
 */
export type ChatViewLocation =
	| "right-tab"
	| "right-split"
	| "editor-tab"
	| "editor-split";

export interface AgentClientPluginSettings {
	/**
	 * Per-preset user overrides, keyed by presetId (see
	 * services/preset-agents.ts for the static registry). Normalization
	 * guarantees an entry for every registry preset; unknown keys written by
	 * a newer plugin version are preserved but never enumerated.
	 */
	presetAgents: Record<string, PresetAgentUserSettings>;
	customAgents: CustomAgentSettings[];
	/** Default agent ID for new views (renamed from activeAgentId for multi-session) */
	defaultAgentId: string;
	autoAllowPermissions: boolean;
	autoMentionActiveNote: boolean;
	/** Surface `[[wikilinks]]` inside note content as resolved metadata so the agent can decide which links to follow */
	expandWikilinkContext: boolean;
	/** Show OS system notifications on response completion and permission requests */
	enableSystemNotifications: boolean;
	/** Prompt injection settings for Obsidian-flavored Markdown guidance */
	promptInjection: {
		/** Master toggle for prompt injection */
		enabled: boolean;
		/** Inject LaTeX math formatting instructions ($...$ and $$...$$) */
		latex: boolean;
		/** Instruct agents to use [[Note Name]] wikilink syntax */
		wikiLinks: boolean;
		/** Instruct agents to leave a blank line before Markdown tables */
		tables: boolean;
	};
	debugMode: boolean;
	nodePath: string;
	exportSettings: {
		defaultFolder: string;
		filenameTemplate: string;
		autoExportOnNewChat: boolean;
		autoExportOnCloseChat: boolean;
		openFileAfterExport: boolean;
		includeImages: boolean;
		imageLocation: "obsidian" | "custom" | "base64";
		imageCustomFolder: string;
		frontmatterTag: string;
	};
	// WSL settings (Windows only)
	windowsWslMode: boolean;
	windowsWslDistribution?: string;
	// Input behavior
	sendMessageShortcut: SendMessageShortcut;
	// View settings
	chatViewLocation: ChatViewLocation;
	// Display settings
	displaySettings: {
		autoCollapseDiffs: boolean;
		diffCollapseThreshold: number;
		maxNoteLength: number;
		maxSelectionLength: number;
		showEmojis: boolean;
		fontSize: number | null;
	};
	// Locally saved session metadata (for agents without session/list support)
	savedSessions: SavedSessionInfo[];
	// Last used model per agent (agentId → modelId)
	lastUsedModels: Record<string, string>;
	// Last used mode per agent (agentId → modeId)
	lastUsedModes: Record<string, string>;
	// Last used non-model/mode config options per agent (agentId → {optionId → value})
	lastUsedConfigOptions: Record<string, Record<string, string>>;
	// Floating chat settings
	enableFloatingChat: boolean;
	floatingButtonImage: string;
	floatingWindowSize: { width: number; height: number };
	floatingWindowPosition: { x: number; y: number } | null;
	floatingButtonPosition: { x: number; y: number } | null;
}

const DEFAULT_SETTINGS: AgentClientPluginSettings = {
	presetAgents: Object.fromEntries(
		PRESET_AGENTS.map((def) => [
			def.presetId,
			defaultPresetAgentSettings(def),
		]),
	),
	customAgents: [],
	defaultAgentId: PRESET_AGENTS[0].presetId,
	autoAllowPermissions: false,
	autoMentionActiveNote: true,
	expandWikilinkContext: true,
	enableSystemNotifications: true,
	promptInjection: {
		enabled: true,
		latex: true,
		wikiLinks: true,
		tables: true,
	},
	debugMode: false,
	nodePath: "",
	exportSettings: {
		defaultFolder: "Agent Client",
		filenameTemplate: "agent_client_{date}_{time}",
		autoExportOnNewChat: false,
		autoExportOnCloseChat: false,
		openFileAfterExport: true,
		includeImages: true,
		imageLocation: "obsidian",
		imageCustomFolder: "Agent Client",
		frontmatterTag: "agent-client",
	},
	windowsWslMode: false,
	windowsWslDistribution: undefined,
	sendMessageShortcut: "enter",
	chatViewLocation: "right-tab",
	displaySettings: {
		autoCollapseDiffs: false,
		diffCollapseThreshold: 10,
		maxNoteLength: 10000,
		maxSelectionLength: 10000,
		showEmojis: true,
		fontSize: null,
	},
	savedSessions: [],
	lastUsedModels: {},
	lastUsedModes: {},
	lastUsedConfigOptions: {},
	enableFloatingChat: false,
	floatingButtonImage: "",
	floatingWindowSize: { width: 400, height: 500 },
	floatingWindowPosition: null,
	floatingButtonPosition: null,
};

export default class AgentClientPlugin extends Plugin {
	settings: AgentClientPluginSettings;
	settingsService!: SettingsService;

	/** Registry for all chat view containers (sidebar + floating) */
	viewRegistry = new ChatViewRegistry();

	/**
	 * Pool of per-view AcpClient instances (multi-session support).
	 * Public methods below (getOrCreateAcpClient etc.) delegate here.
	 */
	readonly acpPool = new AcpClientPool(() => this.createAcpHost());
	/**
	 * Routes prompts into chat views (pending-prompt handshake + queue).
	 * Public methods below (runPromptInChat etc.) delegate here.
	 */
	readonly promptRouter = new PromptRouter(this);
	/**
	 * Injects stable ids into persist embedded-chat fences
	 * (services/embed-id-injector.ts).
	 */
	readonly embedIdInjector = new EmbedIdInjector(this.app.vault);
	/** Floating button container (independent from chat view instances) */
	private floatingButton: FloatingButtonContainer | null = null;
	/**
	 * Counter for generating unique floating chat instance IDs.
	 * Internal state — public only so PromptRouter can compute the viewId of
	 * the floating chat it is about to open. Do not write from outside.
	 */
	floatingChatCounter = 0;

	async onload() {
		await this.loadSettings();

		initializeLogger(this.settings);

		// Initialize settings store
		this.settingsService = createSettingsService(this.settings, this);

		// Detach stale leaves from a previous plugin instance to prevent
		// "Attempting to register an existing view type" when Obsidian's
		// hot-reload races onunload/onload (e.g. rapid toggle or npm run dev).
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);

		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

		this.app.workspace.detachLeavesOfType(VIEW_TYPE_SESSION_MANAGER);
		this.registerView(
			VIEW_TYPE_SESSION_MANAGER,
			(leaf) => new SessionManagerView(leaf, this),
		);

		const ribbonIconEl = this.addRibbonIcon(
			"bot-message-square",
			"Open agent client",
			(_evt: MouseEvent) => {
				void this.activateView();
			},
		);
		ribbonIconEl.addClass("agent-client-ribbon-icon");

		// All palette commands (ids are a frozen interface — see
		// ui/plugin-commands.ts).
		registerAllCommands(this);

		this.addSettingTab(new AgentClientSettingTab(this.app, this));

		this.registerMarkdownCodeBlockProcessor(
			"agent-client",
			(source, el, ctx) => renderAgentBlock(this, source, el, ctx),
		);
		this.registerMarkdownCodeBlockProcessor("agent", (source, el, ctx) =>
			renderAgentBlock(this, source, el, ctx),
		);

		// Mount floating button (always present; visibility controlled by settings inside component)
		this.floatingButton = new FloatingButtonContainer(this);
		this.floatingButton.mount();

		// Mount initial floating chat instance only if enabled
		if (this.settings.enableFloatingChat) {
			this.openNewFloatingChat();
		}

		// Clean up all ACP sessions when Obsidian quits
		// Note: We don't wait for disconnect to complete to avoid blocking quit
		this.registerEvent(
			this.app.workspace.on("quit", () => {
				// Fire and forget - don't block Obsidian from quitting
				this.acpPool.disconnectAll(true);
			}),
		);

		// Keep the focused chat view in sync when the active leaf changes
		// (e.g. clicking a chat tab in the tab bar). ChatPanel's DOM
		// focus/click listeners only fire on interaction inside the view, so a
		// tab-bar switch would otherwise leave the Session Manager highlight on
		// the previous view until the user clicks into the new one.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof ChatView) {
					this.setLastActiveChatViewId(leaf.view.viewId);
				}
			}),
		);
	}

	onunload() {
		// Unmount floating button
		this.floatingButton?.unmount();
		this.floatingButton = null;

		// Unmount all floating chat instances via registry
		for (const container of this.viewRegistry.getByType("floating")) {
			if (container instanceof FloatingViewContainer) {
				container.unmount();
			}
		}

		// Unmount all embedded chat instances via registry. Their host
		// MarkdownRenderChild is owned by the workspace (not the plugin), so the
		// React roots are not torn down by plugin unload unless we do it here.
		for (const container of this.viewRegistry.getByType("embedded")) {
			if (container instanceof EmbeddedChatViewContainer) {
				container.unmount();
			}
		}

		// Clear registry (sidebar views are managed by Obsidian workspace)
		this.viewRegistry.clear();

		// Disconnect all ACP clients (kill agent processes)
		this.acpPool.disconnectAll(false);

		// Drop any undelivered pending-prompt handlers and queued prompts.
		this.promptRouter.clear();

		// Cancel any pending graceful AcpClient teardowns.
		this.acpPool.cancelAllTeardowns();
	}

	/**
	 * Build the narrow host surface the ACP layer is allowed to see.
	 * getSettings() reads live settings on every call — do not cache.
	 */
	private createAcpHost(): AcpClientHost {
		return {
			getSettings: () => ({
				autoAllowPermissions: this.settings.autoAllowPermissions,
				nodePath: this.settings.nodePath,
				windowsWslMode: this.settings.windowsWslMode,
				windowsWslDistribution: this.settings.windowsWslDistribution,
			}),
			getSecret: (id) => this.app.secretStorage.getSecret(id),
			clientVersion: this.manifest.version,
		};
	}

	/**
	 * Get or create an AcpClient for a specific view.
	 * Each ChatView has its own AcpClient for independent sessions.
	 * Delegates to AcpClientPool (services/acp-client-pool.ts).
	 */
	getOrCreateAcpClient(viewId: string): AcpClient {
		return this.acpPool.getOrCreate(viewId);
	}

	/**
	 * Update auto-allow permission setting on all live AcpClient instances.
	 * Called when the setting changes at runtime.
	 */
	updateAllAutoAllow(autoAllow: boolean): void {
		this.acpPool.updateAllAutoAllow(autoAllow);
	}

	/**
	 * Remove and disconnect the AcpClient for a specific view.
	 * Called when a ChatView is closed.
	 */
	async removeAcpClient(viewId: string): Promise<void> {
		await this.acpPool.remove(viewId);
	}

	/** Cancel a pending graceful teardown for a viewId (called on (re)mount). */
	acquireAcpClient(viewId: string): void {
		this.acpPool.acquire(viewId);
	}

	/**
	 * Schedule a graceful teardown of a viewId's AcpClient. A re-acquire within
	 * the grace window cancels it, so a rapid unmount/remount (re-processing)
	 * keeps one client; only genuine removal disconnects the agent process.
	 */
	releaseAcpClient(viewId: string): void {
		this.acpPool.release(viewId);
	}

	/**
	 * Get the last active ChatView ID for keybind targeting.
	 */
	get lastActiveChatViewId(): string | null {
		return this.viewRegistry.getFocusedId();
	}

	/**
	 * Set the last active ChatView ID.
	 * Called when a ChatView receives focus or interaction.
	 */
	setLastActiveChatViewId(viewId: string | null): void {
		if (viewId) {
			this.viewRegistry.setFocused(viewId);
		}
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

		if (leaves.length > 0) {
			// Find the leaf matching lastActiveChatViewId, or fall back to first leaf
			const focusedId = this.lastActiveChatViewId;
			if (focusedId) {
				leaf =
					leaves.find(
						(l) => (l.view as ChatView)?.viewId === focusedId,
					) || leaves[0];
			} else {
				leaf = leaves[0];
			}
		} else {
			leaf = this.createNewChatLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_CHAT,
					active: true,
				});
			}
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
			this.focusTextarea(leaf);
		}
	}

	async activateSessionManager(): Promise<void> {
		const { workspace } = this.app;

		const leaves = workspace.getLeavesOfType(VIEW_TYPE_SESSION_MANAGER);
		if (leaves.length > 0) {
			await workspace.revealLeaf(leaves[0]);
			return;
		}

		const leaf = workspace.getLeftLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_SESSION_MANAGER,
				active: true,
			});
			await workspace.revealLeaf(leaf);
		}
	}

	/**
	 * Close a specific chat view (sidebar or floating).
	 * Dispatch is via IChatViewContainer.closeContainer(); plugin does not
	 * need to know the concrete container class.
	 */
	closeView(viewId: string): void {
		this.viewRegistry.get(viewId)?.closeContainer();
	}

	/**
	 * Focus the textarea in a ChatView leaf.
	 */
	private focusTextarea(leaf: WorkspaceLeaf): void {
		const viewContainerEl = leaf.view?.containerEl;
		if (viewContainerEl) {
			window.setTimeout(() => {
				const textarea = viewContainerEl.querySelector(
					"textarea.agent-client-chat-input-textarea",
				);
				if (textarea instanceof HTMLTextAreaElement) {
					textarea.focus();
				}
			}, 50);
		}
	}

	/**
	 * Focus the next or previous ChatView in the list.
	 * Uses ChatViewRegistry which includes both sidebar and floating views.
	 * Public because the focus-next/previous palette commands
	 * (ui/plugin-commands.ts) call it.
	 */
	focusChatView(direction: "next" | "previous"): void {
		if (direction === "next") {
			this.viewRegistry.focusNext();
		} else {
			this.viewRegistry.focusPrevious();
		}
	}

	/**
	 * Create a new leaf for ChatView based on the configured location setting.
	 * @param isAdditional - true when opening additional views (e.g., Open New View)
	 */
	private createNewChatLeaf(isAdditional: boolean): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const location = this.settings.chatViewLocation;

		switch (location) {
			case "right-tab":
				if (isAdditional) {
					return this.createSidebarTab("right");
				}
				return workspace.getRightLeaf(false);
			case "right-split":
				return workspace.getRightLeaf(isAdditional);
			case "editor-tab":
				return workspace.getLeaf("tab");
			case "editor-split":
				return workspace.getLeaf("split");
			default:
				return workspace.getRightLeaf(false);
		}
	}

	/**
	 * Create a new tab within an existing sidebar tab group.
	 * Uses the parent of an existing chat leaf to add a sibling tab,
	 * avoiding the vertical split caused by getRightLeaf(true).
	 */
	private createSidebarTab(side: "right" | "left"): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const split =
			side === "right" ? workspace.rightSplit : workspace.leftSplit;

		// Find an existing chat leaf in this sidebar to get its tab group
		const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		const sidebarLeaf = existingLeaves.find(
			(leaf) => leaf.getRoot() === split,
		);

		if (sidebarLeaf) {
			const tabGroup = sidebarLeaf.parent;
			// Index is clamped by Obsidian, so a large value appends to the end
			return workspace.createLeafInParent(
				tabGroup,
				Number.MAX_SAFE_INTEGER,
			);
		}

		// Fallback: no existing chat leaf in sidebar, create first one
		return side === "right"
			? workspace.getRightLeaf(false)
			: workspace.getLeftLeaf(false);
	}

	/**
	 * Open a new chat view with a specific agent.
	 * Always creates a new view (doesn't reuse existing).
	 */
	async openNewChatViewWithAgent(
		agentId: string,
		locationOverride?: "right-pane",
	): Promise<string | null> {
		const leaf =
			locationOverride === "right-pane"
				? this.createSidebarTab("right")
				: this.createNewChatLeaf(true);
		if (!leaf) {
			getLogger().warn("[AgentClient] Failed to create new leaf");
			return null;
		}

		await leaf.setViewState({
			type: VIEW_TYPE_CHAT,
			active: true,
			state: { initialAgentId: agentId },
		});

		await this.app.workspace.revealLeaf(leaf);
		const view = leaf.view as ChatView | null;
		const viewId = view?.viewId ?? null;

		// Focus textarea after revealing the leaf
		const viewContainerEl = leaf.view?.containerEl;
		if (viewContainerEl) {
			window.setTimeout(() => {
				const textarea = viewContainerEl.querySelector(
					"textarea.agent-client-chat-input-textarea",
				);
				if (textarea instanceof HTMLTextAreaElement) {
					textarea.focus();
				}
			}, 0);
		}
		return viewId;
	}

	/**
	 * Open a new floating chat window.
	 * Each window is independent with its own session.
	 */
	openNewFloatingChat(
		initialExpanded = false,
		initialPosition?: { x: number; y: number },
	): void {
		// instanceId is just the counter (e.g., "0", "1", "2")
		// FloatingViewContainer will create viewId as "floating-chat-{instanceId}"
		const instanceId = String(this.floatingChatCounter++);
		createFloatingChat(this, instanceId, initialExpanded, initialPosition);
	}

	/**
	 * Find the embedded chat nearest to a source line in a note.
	 * Delegates to PromptRouter (services/prompt-router.ts).
	 */
	findNearestEmbeddedChat(
		sourcePath: string,
		lineStart: number,
	): string | null {
		return this.promptRouter.findNearestEmbeddedChat(
			sourcePath,
			lineStart,
		);
	}

	/**
	 * Close a specific floating chat window.
	 * @param viewId - The viewId in "floating-chat-{id}" format (from getFloatingChatInstances())
	 */
	closeFloatingChat(viewId: string): void {
		const container = this.viewRegistry.get(viewId);
		if (container && container instanceof FloatingViewContainer) {
			container.unmount();
		}
	}

	/**
	 * Get all floating chat instance viewIds.
	 * @returns Array of viewIds in "floating-chat-{id}" format
	 */
	getFloatingChatInstances(): string[] {
		return this.viewRegistry.getByType("floating").map((v) => v.viewId);
	}

	/**
	 * Expand a specific floating chat window by triggering a custom event.
	 * @param viewId - The viewId in "floating-chat-{id}" format (from getFloatingChatInstances())
	 */
	expandFloatingChat(viewId: string): void {
		const view = this.viewRegistry.get(viewId);
		if (view) {
			view.expand();
		}
	}

	/**
	 * Open a chat view and inject a prompt into it. Used by quick-action
	 * buttons (embedded code blocks, command palette entries, etc.).
	 * Delegates to PromptRouter (services/prompt-router.ts).
	 */
	async runPromptInChat(options: {
		agentId: string;
		prompt: string;
		autoSend: boolean;
		viewType: "right-pane" | "floating" | "editor-tab" | "embedded";
		sourcePath?: string;
		lineStart?: number;
	}): Promise<void> {
		await this.promptRouter.runPromptInChat(options);
	}

	/**
	 * Register a ChatPanel's pending-prompt handler (called on mount). If a
	 * prompt was queued before the panel mounted (runPromptInChat ran first),
	 * it is delivered synchronously here. Returns an unregister function.
	 * Delegates to PromptRouter (services/prompt-router.ts).
	 */
	registerPendingPromptHandler(
		viewId: string,
		handler: (prompt: string, autoSend: boolean) => void,
	): () => void {
		return this.promptRouter.registerPendingPromptHandler(viewId, handler);
	}

	/**
	 * Get all available agents (preset + custom). Delegates to the single
	 * enumeration implementation in session-helpers.
	 */
	getAvailableAgents(): Array<{ id: string; displayName: string }> {
		return getAvailableAgentsFromSettings(this.settings);
	}

	async loadSettings() {
		const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		const D = DEFAULT_SETTINGS;
		let migratedSecrets = false;

		// Extract settings sub-objects
		const re = obj(raw.exportSettings) ?? {};
		const rd = obj(raw.displaySettings) ?? {};

		// Normalize custom agents. Preset ids are reserved: a custom that
		// collides with one has always been dead weight (preset-first
		// resolution), so suffix-renaming it changes no session behavior.
		const customAgents = Array.isArray(raw.customAgents)
			? ensureUniqueCustomAgentIds(
					raw.customAgents.map((a: unknown) =>
						normalizeCustomAgent(obj(a) ?? {}),
					),
					PRESET_AGENTS.map((def) => def.presetId),
				)
			: [];

		// Migration: defaultAgentId ← activeAgentId (old name)
		const availableAgentIds = [
			...PRESET_AGENTS.map((def) => def.presetId),
			...customAgents.map((a) => a.id),
		];
		const defaultAgentId =
			resolveDefaultAgentId(raw, availableAgentIds) ||
			PRESET_AGENTS[0].presetId;

		// Secret-storage side effects (writes + Notices) are injected into the
		// pure normalizer; called only for presets with apiKey.legacy wiring.
		const migrateApiKey: ApiKeyMigrator = ({
			def,
			current,
			legacyPlain,
		}) => {
			const legacy = def.apiKey?.legacy;
			if (!legacy) {
				return current;
			}
			return this.migrateLegacyApiKey(
				legacy.defaultSecretId,
				legacy.fallbackSecretId,
				current,
				legacyPlain,
				legacy.noticeLabel,
				() => {
					migratedSecrets = true;
				},
			);
		};

		this.settings = {
			presetAgents: normalizePresetAgents(
				raw,
				PRESET_AGENTS,
				migrateApiKey,
			),
			customAgents,
			defaultAgentId,
			autoAllowPermissions: bool(
				raw.autoAllowPermissions,
				D.autoAllowPermissions,
			),
			autoMentionActiveNote: bool(
				raw.autoMentionActiveNote,
				D.autoMentionActiveNote,
			),
			expandWikilinkContext: bool(
				raw.expandWikilinkContext,
				D.expandWikilinkContext,
			),
			enableSystemNotifications: bool(
				raw.enableSystemNotifications,
				D.enableSystemNotifications,
			),
			promptInjection: (() => {
				const rp = obj(raw.promptInjection) ?? {};
				return {
					enabled: bool(rp.enabled, D.promptInjection.enabled),
					latex: bool(rp.latex, D.promptInjection.latex),
					wikiLinks: bool(rp.wikiLinks, D.promptInjection.wikiLinks),
					tables: bool(rp.tables, D.promptInjection.tables),
				};
			})(),
			debugMode: bool(raw.debugMode, D.debugMode),
			nodePath: str(raw.nodePath, D.nodePath),
			exportSettings: {
				defaultFolder: str(
					re.defaultFolder,
					D.exportSettings.defaultFolder,
				),
				filenameTemplate: str(
					re.filenameTemplate,
					D.exportSettings.filenameTemplate,
				),
				autoExportOnNewChat: bool(
					re.autoExportOnNewChat,
					D.exportSettings.autoExportOnNewChat,
				),
				autoExportOnCloseChat: bool(
					re.autoExportOnCloseChat,
					D.exportSettings.autoExportOnCloseChat,
				),
				openFileAfterExport: bool(
					re.openFileAfterExport,
					D.exportSettings.openFileAfterExport,
				),
				includeImages: bool(
					re.includeImages,
					D.exportSettings.includeImages,
				),
				imageLocation: enumVal(
					re.imageLocation,
					["obsidian", "custom", "base64"],
					D.exportSettings.imageLocation,
				),
				imageCustomFolder: str(
					re.imageCustomFolder,
					D.exportSettings.imageCustomFolder,
				),
				frontmatterTag: str(
					re.frontmatterTag,
					D.exportSettings.frontmatterTag,
				),
			},
			windowsWslMode: bool(raw.windowsWslMode, D.windowsWslMode),
			windowsWslDistribution: str(
				raw.windowsWslDistribution,
				D.windowsWslDistribution as string,
			),
			sendMessageShortcut: enumVal(
				raw.sendMessageShortcut,
				["enter", "cmd-enter"],
				D.sendMessageShortcut,
			),
			chatViewLocation: enumVal(
				raw.chatViewLocation,
				["right-tab", "right-split", "editor-tab", "editor-split"],
				D.chatViewLocation,
			),
			displaySettings: {
				autoCollapseDiffs: bool(
					rd.autoCollapseDiffs,
					D.displaySettings.autoCollapseDiffs,
				),
				diffCollapseThreshold: num(
					rd.diffCollapseThreshold,
					D.displaySettings.diffCollapseThreshold,
					1,
				),
				maxNoteLength: num(
					rd.maxNoteLength,
					D.displaySettings.maxNoteLength,
					1,
				),
				maxSelectionLength: num(
					rd.maxSelectionLength,
					D.displaySettings.maxSelectionLength,
					1,
				),
				showEmojis: bool(rd.showEmojis, D.displaySettings.showEmojis),
				fontSize: parseChatFontSize(rd.fontSize),
			},
			savedSessions: Array.isArray(raw.savedSessions)
				? (raw.savedSessions as SavedSessionInfo[])
				: D.savedSessions,
			lastUsedModels: strRecord(raw.lastUsedModels),
			lastUsedModes: strRecord(raw.lastUsedModes),
			lastUsedConfigOptions: nestedStrRecord(raw.lastUsedConfigOptions),
			// Migration: enableFloatingChat ← showFloatingButton (old name)
			enableFloatingChat: bool(
				raw.enableFloatingChat,
				bool(raw.showFloatingButton, D.enableFloatingChat),
			),
			floatingButtonImage: str(
				raw.floatingButtonImage,
				D.floatingButtonImage,
			),
			floatingWindowSize: (() => {
				const s = obj(raw.floatingWindowSize);
				return s &&
					typeof s.width === "number" &&
					typeof s.height === "number"
					? { width: s.width, height: s.height }
					: D.floatingWindowSize;
			})(),
			floatingWindowPosition: xyPoint(raw.floatingWindowPosition),
			floatingButtonPosition: xyPoint(raw.floatingButtonPosition),
		};

		this.ensureAtLeastOneEnabled();
		this.ensureDefaultAgentId();

		if (migratedSecrets) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async saveSettingsAndNotify(nextSettings: AgentClientPluginSettings) {
		await this.settingsService.updateSettings(nextSettings);
	}

	/**
	 * Migrate legacy plaintext apiKey (v0.10.x) to secretStorage.
	 *
	 * Returns the secretId to use for this agent.
	 *
	 * Behavior:
	 * - If apiKeySecretId is already set, return it as-is. If a legacy
	 *   plaintext apiKey still lingers in data.json (orphaned from prior
	 *   experimental state), trigger onMigrate to schedule a save that
	 *   cleans it up.
	 * - If legacy apiKey is empty, return empty string (no migration needed).
	 * - Otherwise, migrate to secretStorage:
	 *   - Use defaultSecretId (e.g. "claude-api-key") for cross-plugin sharing.
	 *   - On collision (defaultSecretId exists with a different value, e.g.
	 *     from another plugin), fall back to fallbackSecretId
	 *     (e.g. "agent-client-claude-api-key") to preserve the user's key
	 *     and notify them.
	 *
	 * This method is for upgrading from v0.10.x or experimental builds and
	 * can be removed in a future major version once we're confident no
	 * users have legacy plaintext apiKey fields in data.json.
	 */
	private migrateLegacyApiKey(
		defaultSecretId: string,
		fallbackSecretId: string,
		currentSecretId: string,
		legacyApiKey: string,
		agentLabel: string,
		onMigrate: () => void,
	): string {
		const trimmed = legacyApiKey.trim();

		// Already migrated
		if (currentSecretId.length > 0) {
			// Clean up orphaned plaintext apiKey if still in data.json
			if (trimmed.length > 0) {
				onMigrate();
			}
			return currentSecretId;
		}

		if (trimmed.length === 0) {
			return "";
		}

		const existing = this.app.secretStorage.getSecret(defaultSecretId);

		if (existing === null) {
			// No collision — create the secret with the preferred ID
			this.app.secretStorage.setSecret(defaultSecretId, trimmed);
			new Notice(
				`[Agent Client] Your ${agentLabel} API key has been migrated to Obsidian's Keychain as "${defaultSecretId}".`,
			);
			onMigrate();
			return defaultSecretId;
		}

		if (existing === trimmed) {
			// Idempotent re-migration (same value already stored)
			onMigrate();
			return defaultSecretId;
		}

		// Collision: defaultSecretId exists with a different value (likely
		// another plugin). Fall back to a plugin-prefixed ID to preserve
		// the user's key without overwriting other plugins' secrets.
		this.app.secretStorage.setSecret(fallbackSecretId, trimmed);
		new Notice(
			`[Agent Client] "${defaultSecretId}" was already in use. Your ${agentLabel} API key was migrated to "${fallbackSecretId}". You can rename it in Obsidian's Keychain settings.`,
		);
		onMigrate();
		return fallbackSecretId;
	}

	/**
	 * Check for plugin updates.
	 * - Stable version users: compare with latest stable release
	 * - Prerelease users: compare with both latest stable and latest prerelease
	 * Delegates the fetch + semver comparison to checkPluginUpdate
	 * (services/update-checker.ts); this wrapper owns the user-facing Notice.
	 */
	async checkForUpdates(): Promise<boolean> {
		const newVersion = await checkPluginUpdate(this.manifest.version);
		if (newVersion) {
			new Notice(`[Agent Client] Update available: v${newVersion}`);
		}
		return newVersion !== null;
	}

	ensureDefaultAgentId(): void {
		const availableIds = this.collectAvailableAgentIds();
		if (!availableIds.includes(this.settings.defaultAgentId)) {
			this.settings.defaultAgentId = firstEnabledAgentId(this.settings);
		}
	}

	/**
	 * Repair the "everything disabled" state by re-enabling the first preset.
	 * The settings UI refuses to disable the last enabled agent, so this is a
	 * backstop for load-time data and indirect paths (custom deletion).
	 */
	ensureAtLeastOneEnabled(): void {
		const repaired = repairNoEnabledAgents(this.settings);
		if (repaired) {
			this.settings.presetAgents = repaired;
		}
	}

	private collectAvailableAgentIds(): string[] {
		const ids = new Set<string>();
		for (const agent of this.getAvailableAgents()) {
			if (agent.id && agent.id.length > 0) {
				ids.add(agent.id);
			}
		}
		return Array.from(ids);
	}
}
