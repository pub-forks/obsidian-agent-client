/**
 * Minimal AgentClientPlugin fake for ChatExporter tests (Phase 0, PR0.6).
 *
 * Implements only the surface chat-exporter.ts touches:
 * - plugin.settings.exportSettings (override per test)
 * - plugin.app.vault: getAbstractFileByPath / create / modify / createBinary /
 *   createFolder, backed by an in-memory Map<string, string | ArrayBuffer>
 * - plugin.app.metadataCache.getFileCache: frontmatter from an explicit Map,
 *   falling back to parsing the stored file content (so re-exports see the
 *   session_id the exporter itself wrote)
 * - plugin.app.fileManager.getAvailablePathForAttachment: controllable vi.fn
 * - plugin.app.workspace.getLeaf().openFile: vi.fn
 *
 * `getAbstractFileByPath` returns stub `TFile` instances for files (the
 * exporter does `instanceof TFile` checks) and `TFolder` for folders.
 */

import { vi, type Mock } from "vitest";
import { TFile, TFolder } from "obsidian";

export interface FakeExportSettings {
	defaultFolder: string;
	filenameTemplate: string;
	autoExportOnNewChat: boolean;
	autoExportOnCloseChat: boolean;
	openFileAfterExport: boolean;
	includeImages: boolean;
	imageLocation: "obsidian" | "custom" | "base64";
	imageCustomFolder: string;
	frontmatterTag: string;
}

/** Mirrors DEFAULT_SETTINGS.exportSettings in src/plugin.ts. */
const DEFAULT_EXPORT_SETTINGS: FakeExportSettings = {
	defaultFolder: "Agent Client",
	filenameTemplate: "agent_client_{date}_{time}",
	autoExportOnNewChat: false,
	autoExportOnCloseChat: false,
	openFileAfterExport: true,
	includeImages: true,
	imageLocation: "obsidian",
	imageCustomFolder: "Agent Client",
	frontmatterTag: "agent-client",
};

function makeTFile(path: string): TFile {
	const fileName = path.split("/").pop() ?? path;
	const basename = fileName.replace(/\.[^.]+$/, "");
	return new TFile(path, basename);
}

/** Naive `key: value` frontmatter parse — enough for session_id lookups. */
function parseFrontmatter(
	content: string,
): Record<string, unknown> | undefined {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return undefined;
	const fm: Record<string, unknown> = {};
	for (const line of match[1].split("\n")) {
		const kv = line.match(/^([\w-]+):\s*(.*)$/);
		if (kv) fm[kv[1]] = kv[2];
	}
	return fm;
}

export interface FakePluginHarness {
	/** Cast to AgentClientPlugin at the ChatExporter constructor call site. */
	plugin: unknown;
	/** In-memory vault contents, keyed by path. Seed before exporting. */
	files: Map<string, string | ArrayBuffer>;
	/** Existing folders. createFolder adds here. */
	folders: Set<string>;
	/** Explicit frontmatter per path; wins over parsing file content. */
	frontmatter: Map<string, Record<string, unknown>>;
	create: Mock;
	modify: Mock;
	createBinary: Mock;
	createFolder: Mock;
	getAvailablePathForAttachment: Mock;
	getLeaf: Mock;
	openFile: Mock;
	/** Read a stored text file (throws if missing or binary). */
	readText(path: string): string;
}

export function createFakePlugin(
	exportSettingsOverrides: Partial<FakeExportSettings> = {},
): FakePluginHarness {
	const files = new Map<string, string | ArrayBuffer>();
	const folders = new Set<string>();
	const frontmatter = new Map<string, Record<string, unknown>>();

	const create = vi.fn(async (path: string, content: string) => {
		files.set(path, content);
		return makeTFile(path);
	});
	const modify = vi.fn(async (file: TFile, content: string) => {
		files.set(file.path, content);
	});
	const createBinary = vi.fn(async (path: string, data: ArrayBuffer) => {
		files.set(path, data);
		return makeTFile(path);
	});
	const createFolder = vi.fn(async (path: string) => {
		folders.add(path);
	});
	// Default: the requested name is available (returned as-is, no folder).
	const getAvailablePathForAttachment = vi.fn(
		async (fileName: string, _sourcePath: string) => fileName,
	);
	const openFile = vi.fn(async (_file: TFile) => {});
	const getLeaf = vi.fn((_newLeaf: boolean) => ({ openFile }));

	const plugin = {
		settings: {
			exportSettings: {
				...DEFAULT_EXPORT_SETTINGS,
				...exportSettingsOverrides,
			},
		},
		app: {
			vault: {
				getAbstractFileByPath(path: string) {
					if (files.has(path)) return makeTFile(path);
					if (folders.has(path)) return new TFolder(path);
					return null;
				},
				create,
				modify,
				createBinary,
				createFolder,
			},
			metadataCache: {
				getFileCache(file: TFile) {
					const explicit = frontmatter.get(file.path);
					if (explicit) return { frontmatter: explicit };
					const content = files.get(file.path);
					if (typeof content === "string") {
						const fm = parseFrontmatter(content);
						if (fm) return { frontmatter: fm };
					}
					return null;
				},
			},
			fileManager: { getAvailablePathForAttachment },
			workspace: { getLeaf },
		},
	};

	return {
		plugin,
		files,
		folders,
		frontmatter,
		create,
		modify,
		createBinary,
		createFolder,
		getAvailablePathForAttachment,
		getLeaf,
		openFile,
		readText(path: string): string {
			const content = files.get(path);
			if (typeof content !== "string") {
				throw new Error(`No text file at: ${path}`);
			}
			return content;
		},
	};
}
