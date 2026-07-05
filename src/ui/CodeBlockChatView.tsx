import * as React from "react";
const { useEffect, useMemo } = React;
import { createRoot, type Root } from "react-dom/client";

import type AgentClientPlugin from "../plugin";
import { ChatContextProvider } from "./ChatContext";
import { ChatPanel, type ChatPanelCallbacks } from "./ChatPanel";
import { VaultService } from "../services/vault-service";
import type { AgentChatBlockConfig } from "../utils/agent-block-parser";
import type {
	IChatViewContainer,
	ChatViewType,
	SessionStatus,
} from "../services/view-registry";
import type { ChatInputState } from "../types/chat";

export interface CodeBlockMountContext {
	sourcePath: string;
	blockId: string;
	lineStart: number;
}

interface CodeBlockChatProps {
	plugin: AgentClientPlugin;
	viewId: string;
	config: AgentChatBlockConfig;
	mountCtx: CodeBlockMountContext;
	onRegisterCallbacks?: (callbacks: ChatPanelCallbacks) => void;
}

function CodeBlockChatComponent({
	plugin,
	viewId,
	config,
	mountCtx,
	onRegisterCallbacks,
}: CodeBlockChatProps) {
	const acpClient = useMemo(
		() => plugin.getOrCreateAcpClient(viewId),
		[plugin, viewId],
	);

	const vaultService = useMemo(() => new VaultService(plugin), [plugin]);

	// Cleanup VaultService when the component unmounts. Mirrors
	// FloatingChatComponent: the AcpClient is intentionally NOT removed here so
	// that a re-render of the same code block (same viewId) reuses the existing
	// session. The container schedules a graceful AcpClient teardown on unmount
	// (cancelled by a remount within the grace window); any survivors are
	// reaped at plugin unload via _acpClients disconnect/clear.
	useEffect(() => {
		return () => {
			vaultService.destroy();
		};
	}, [vaultService]);

	const contextValue = useMemo(
		() => ({
			plugin,
			acpClient,
			vaultService,
			settingsService: plugin.settingsService,
		}),
		[plugin, acpClient, vaultService],
	);

	const heightStyle = config.height
		? ({ "--ac-embedded-max-height": config.height } as React.CSSProperties)
		: undefined;

	// Memoize the ChatPanel props so React.memo(ChatPanel) can bail out across
	// re-renders. Shapes MUST match ChatPanelProps (config / embeddedConfig);
	// height is consumed locally (heightStyle), not passed.
	const memoizedConfig = useMemo(
		() => ({ agent: config.agent, model: config.model }),
		[config.agent, config.model],
	);
	const memoizedEmbeddedConfig = useMemo(
		() => ({
			persist: config.persist,
			noteContext: config.noteContext,
			sourcePath: mountCtx.sourcePath,
			id: config.id,
		}),
		[config.persist, config.noteContext, mountCtx.sourcePath, config.id],
	);

	return (
		<div className="agent-client-code-block-chat" style={heightStyle}>
			<ChatContextProvider value={contextValue}>
				<ChatPanel
					variant="embedded"
					viewId={viewId}
					onRegisterCallbacks={onRegisterCallbacks}
					initialAgentId={config.agent}
					config={memoizedConfig}
					embeddedConfig={memoizedEmbeddedConfig}
				/>
			</ChatContextProvider>
		</div>
	);
}

// ============================================================
// EmbeddedChatViewContainer Class
// ============================================================

/**
 * Wrapper that implements IChatViewContainer for embedded (code-block) chat
 * views. Mirrors FloatingViewContainer: this container owns the React root and
 * registry registration, while CodeBlockChatComponent owns service lifecycle.
 */
export class EmbeddedChatViewContainer implements IChatViewContainer {
	readonly viewType: ChatViewType = "embedded";
	readonly viewId: string;
	/** Host note path (used by findNearestEmbeddedChat). */
	readonly sourcePath: string;
	/** Section start line of this block (used by findNearestEmbeddedChat). */
	readonly lineStart: number;

	private plugin: AgentClientPlugin;
	private containerEl: HTMLElement;
	private root: Root | null = null;
	private callbacks: ChatPanelCallbacks | null = null;

	constructor(
		plugin: AgentClientPlugin,
		viewId: string,
		containerEl: HTMLElement,
		mountCtx: CodeBlockMountContext,
	) {
		this.plugin = plugin;
		this.viewId = viewId;
		this.containerEl = containerEl;
		this.sourcePath = mountCtx.sourcePath;
		this.lineStart = mountCtx.lineStart;
	}

	mount(config: AgentChatBlockConfig, mountCtx: CodeBlockMountContext): void {
		// Cancel any pending graceful teardown so re-processing churn reuses the
		// existing AcpClient instead of racing its disconnect.
		this.plugin.acquireAcpClient(this.viewId);
		this.root = createRoot(this.containerEl);
		this.root.render(
			<CodeBlockChatComponent
				plugin={this.plugin}
				viewId={this.viewId}
				config={config}
				mountCtx={mountCtx}
				onRegisterCallbacks={(cbs) => {
					this.callbacks = cbs;
				}}
			/>,
		);
		this.plugin.viewRegistry.register(this);
	}

	unmount(): void {
		this.plugin.viewRegistry.unregister(this.viewId);
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
		// Schedule a graceful teardown of the AcpClient; a remount within the
		// grace window cancels it (re-processing churn), so only genuine removal
		// disconnects the agent process.
		this.plugin.releaseAcpClient(this.viewId);
	}

	// ============================================================
	// IChatViewContainer Implementation
	// ============================================================

	getDisplayName(): string {
		return this.callbacks?.getDisplayName() ?? "Chat";
	}

	getSessionStatus(): SessionStatus {
		return this.callbacks?.getSessionStatus() ?? "disconnected";
	}

	getSessionTitle(): string {
		return this.callbacks?.getSessionTitle() ?? "New session";
	}

	getSessionId(): string | null {
		return this.callbacks?.getSessionId() ?? null;
	}

	onActivate(): void {
		this.containerEl.classList.add("is-focused");
	}

	onDeactivate(): void {
		this.containerEl.classList.remove("is-focused");
	}

	focus(): void {
		this.containerEl.scrollIntoView({ block: "nearest" });
		window.requestAnimationFrame(() => {
			const textarea = this.containerEl.querySelector(
				"textarea.agent-client-chat-input-textarea",
			);
			if (textarea instanceof HTMLTextAreaElement) {
				textarea.focus();
			}
		});
	}

	hasFocus(): boolean {
		return this.containerEl.contains(activeDocument.activeElement);
	}

	// Embedded blocks have no collapsed state.
	expand(): void {}

	collapse(): void {}

	// Owned by the host note's code block (MarkdownRenderChild); cannot be
	// closed from the session list.
	closeContainer(): void {}

	getInputState(): ChatInputState | null {
		return this.callbacks?.getInputState() ?? null;
	}

	setInputState(state: ChatInputState): void {
		this.callbacks?.setInputState(state);
	}

	canSend(): boolean {
		return this.callbacks?.canSend() ?? false;
	}

	async sendMessage(): Promise<boolean> {
		return (await this.callbacks?.sendMessage()) ?? false;
	}

	async cancelOperation(): Promise<void> {
		await this.callbacks?.cancelOperation();
	}

	getContainerEl(): HTMLElement {
		return this.containerEl;
	}
}

export function mountCodeBlockChat(
	plugin: AgentClientPlugin,
	el: HTMLElement,
	config: AgentChatBlockConfig,
	mountCtx: CodeBlockMountContext,
): EmbeddedChatViewContainer {
	const container = el.createDiv({ cls: "agent-client-code-block-host" });
	const viewId = `code-block:${mountCtx.blockId}`;
	const viewContainer = new EmbeddedChatViewContainer(
		plugin,
		viewId,
		container,
		mountCtx,
	);
	viewContainer.mount(config, mountCtx);
	return viewContainer;
}
