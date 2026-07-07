/**
 * Fake vault access for message-sender characterization tests.
 *
 * Implements only the surface message-sender actually uses:
 * - readNote(path): returns notes[path] or throws
 * - getAllFiles(): plain objects { basename, path, stat: { mtime } } —
 *   stat.mtime is REQUIRED (processNote reads it for the lastModified
 *   annotation; a missing stat is swallowed by try/catch and the resource
 *   block silently disappears).
 * The remaining IVaultAccess methods are vi.fn() stubs to satisfy the type.
 */

import { vi, type Mock } from "vitest";
import type { IVaultAccess } from "../../src/services/vault-service";
import type { IMentionService } from "../../src/utils/mention-parser";
import type {
	IWikilinkResolver,
	LinkedNoteMetadata,
	LineRange,
} from "../../src/utils/wikilink-resolver";

/** Fixed mtime for all fake files: 2025-01-01T00:00:00.000Z */
export const FAKE_MTIME = 1735689600000;

export interface FakeWikilinkResolver extends IWikilinkResolver {
	getNoteWikiLinks: Mock<
		(notePath: string, lineRange?: LineRange) => LinkedNoteMetadata[]
	>;
}

export interface FakeVault {
	vaultAccess: IVaultAccess & IMentionService;
	wikilinkResolver: FakeWikilinkResolver;
}

function basenameOf(path: string): string {
	const name = path.split("/").pop() ?? path;
	return name.replace(/\.[^.]+$/, "");
}

/**
 * Build a fake vault from a map of vault-relative path -> note content.
 * message-sender is structurally typed, so plain file objects suffice
 * (no stub TFile instances needed).
 */
export function fakeVaultAccess(notes: Record<string, string>): FakeVault {
	const vaultAccess: IVaultAccess & IMentionService = {
		readNote: async (path: string) => {
			if (!(path in notes)) {
				throw new Error(`Note not found: ${path}`);
			}
			return notes[path];
		},
		getAllFiles: () =>
			Object.keys(notes).map((path) => ({
				path,
				basename: basenameOf(path),
				stat: { mtime: FAKE_MTIME },
			})),
		searchNotes: vi.fn(async () => []),
		getActiveNote: vi.fn(async () => null),
		listNotes: vi.fn(async () => []),
	};

	const wikilinkResolver: FakeWikilinkResolver = {
		// Replace per test: wikilinkResolver.getNoteWikiLinks.mockReturnValue([...])
		getNoteWikiLinks: vi.fn(
			(_notePath: string, _lineRange?: LineRange): LinkedNoteMetadata[] =>
				[],
		),
	};

	return { vaultAccess, wikilinkResolver };
}
