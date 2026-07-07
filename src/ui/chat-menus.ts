import { Menu, type MenuItem } from "obsidian";

import type AgentClientPlugin from "../plugin";
import type { AgentDisplayInfo } from "../services/session-helpers";
import { ChangeDirectoryModal } from "./ChangeDirectoryModal";
import { addRenameSessionMenuItem } from "./EditTitleModal";

// ============================================================================
// Chat header menus (sidebar / floating+embedded)
// ============================================================================
// Pure builders: construct and return an Obsidian Menu from a deps bundle.
// ChatPanel owns the bundles (useMemo-stabilized — they feed useCallback deps,
// see INV-13) and shows the menu at the mouse event.

/** Dependencies shared by both chat header menus. */
interface ChatMenuBaseDeps {
	plugin: AgentClientPlugin;
	/** Current session id (rename target; may be stale by design — see ChatPanel). */
	sessionId: string | null;
	agentCwd: string;
	handleRestartAgent: () => Promise<void>;
	handleNewChatInDirectory: (directory: string) => Promise<void>;
	handleOpenSettings: () => void;
}

export interface SidebarMenuDeps extends ChatMenuBaseDeps {
	availableAgents: AgentDisplayInfo[];
	currentAgentId: string;
	handleNewChatWithPersist: (requestedAgentId?: string) => Promise<void>;
}

export interface FloatingMenuDeps extends ChatMenuBaseDeps {
	handleNewChat: (requestedAgentId?: string) => Promise<void>;
	handleOpenHistory: () => void;
	handleExportChat: () => Promise<void>;
	onOpenNewWindow?: () => void;
}

/** Header menu for the sidebar variant (agent switcher + actions). */
export function buildSidebarMenu(deps: SidebarMenuDeps): Menu {
	const {
		plugin,
		sessionId,
		agentCwd,
		handleRestartAgent,
		handleNewChatInDirectory,
		handleOpenSettings,
		availableAgents,
		currentAgentId,
		handleNewChatWithPersist,
	} = deps;

	const menu = new Menu();

	// -- Switch agent section --
	menu.addItem((item: MenuItem) => {
		item.setTitle("Switch agent").setIsLabel(true);
	});

	for (const agent of availableAgents) {
		menu.addItem((item: MenuItem) => {
			item.setTitle(agent.displayName)
				.setChecked(agent.id === (currentAgentId || ""))
				.onClick(() => {
					void handleNewChatWithPersist(agent.id);
				});
		});
	}

	menu.addSeparator();

	// -- Actions section --
	addRenameSessionMenuItem(
		menu,
		plugin,
		sessionId,
		plugin.settingsService
			.getSavedSessions()
			.find((s) => s.sessionId === sessionId)?.title ?? "New session",
	);

	menu.addItem((item: MenuItem) => {
		item.setTitle("Open new view")
			.setIcon("copy-plus")
			.onClick(() => {
				void plugin.openNewChatViewWithAgent(
					plugin.settings.defaultAgentId,
				);
			});
	});

	menu.addItem((item: MenuItem) => {
		item.setTitle("Restart agent")
			.setIcon("refresh-cw")
			.onClick(() => {
				void handleRestartAgent();
			});
	});

	menu.addItem((item: MenuItem) => {
		item.setTitle("New chat in directory...")
			.setIcon("folder-open")
			.onClick(() => {
				const modal = new ChangeDirectoryModal(
					plugin.app,
					agentCwd,
					(directory) => {
						void handleNewChatInDirectory(directory);
					},
				);
				modal.open();
			});
	});

	menu.addItem((item: MenuItem) => {
		item.setTitle("Open session manager")
			.setIcon("layout-list")
			.onClick(() => {
				void plugin.activateSessionManager();
			});
	});

	menu.addSeparator();

	menu.addItem((item: MenuItem) => {
		item.setTitle("Plugin settings")
			.setIcon("settings")
			.onClick(() => {
				handleOpenSettings();
			});
	});

	return menu;
}

/** Header menu for the floating and embedded variants. */
export function buildFloatingMenu(deps: FloatingMenuDeps): Menu {
	const {
		plugin,
		sessionId,
		agentCwd,
		handleRestartAgent,
		handleNewChatInDirectory,
		handleOpenSettings,
		handleNewChat,
		handleOpenHistory,
		handleExportChat,
		onOpenNewWindow,
	} = deps;

	const menu = new Menu();

	menu.addItem((item: MenuItem) => {
		item.setTitle("New chat")
			.setIcon("plus")
			.onClick(() => {
				void handleNewChat();
			});
	});

	menu.addItem((item: MenuItem) => {
		item.setTitle("Session history")
			.setIcon("history")
			.onClick(() => {
				void handleOpenHistory();
			});
	});

	menu.addItem((item: MenuItem) => {
		item.setTitle("Export chat to Markdown")
			.setIcon("save")
			.onClick(() => {
				void handleExportChat();
			});
	});

	menu.addSeparator();

	addRenameSessionMenuItem(
		menu,
		plugin,
		sessionId,
		plugin.settingsService
			.getSavedSessions()
			.find((s) => s.sessionId === sessionId)?.title ?? "New session",
	);

	if (onOpenNewWindow) {
		menu.addItem((item: MenuItem) => {
			item.setTitle("Open new floating chat")
				.setIcon("copy-plus")
				.onClick(() => {
					onOpenNewWindow();
				});
		});
	}

	menu.addItem((item: MenuItem) => {
		item.setTitle("Restart agent")
			.setIcon("refresh-cw")
			.onClick(() => {
				void handleRestartAgent();
			});
	});

	menu.addItem((item: MenuItem) => {
		item.setTitle("New chat in directory...")
			.setIcon("folder-open")
			.onClick(() => {
				const modal = new ChangeDirectoryModal(
					plugin.app,
					agentCwd,
					(directory) => {
						void handleNewChatInDirectory(directory);
					},
				);
				modal.open();
			});
	});

	menu.addItem((item: MenuItem) => {
		item.setTitle("Open session manager")
			.setIcon("layout-list")
			.onClick(() => {
				void plugin.activateSessionManager();
			});
	});

	menu.addSeparator();

	menu.addItem((item: MenuItem) => {
		item.setTitle("Plugin settings")
			.setIcon("settings")
			.onClick(() => {
				handleOpenSettings();
			});
	});

	return menu;
}
