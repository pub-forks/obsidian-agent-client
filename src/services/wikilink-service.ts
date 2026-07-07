/**
 * Wikilink service
 *
 * Reads a note's wikilinks from Obsidian's metadata cache — never by scanning
 * raw note text. The cache excludes links inside code blocks/inline code and
 * separates embeds (`.embeds`) and frontmatter links (`.frontmatterLinks`), so
 * we get body wikilinks only, already tokenized. Each is resolved to its single
 * destination via Obsidian's own linkpath resolution (`getFirstLinkpathDest`).
 *
 * Lives in services/ (not utils/) because it depends on the Obsidian runtime
 * (`App`, `TFile`, `parseLinktext`). The pure vocabulary — `LinkedNoteMetadata`,
 * `LineRange`, `IWikilinkResolver`, `extractAlias` — stays in
 * `utils/wikilink-resolver.ts`.
 */

import { TFile, parseLinktext, type App } from "obsidian";
import {
	extractAlias,
	type LineRange,
	type LinkedNoteMetadata,
} from "../utils/wikilink-resolver";

/**
 * Wikilinks in a note's body, from the metadata cache. When `lineRange` is
 * given, only links whose position falls fully within it (for selection
 * scoping). Markdown links and embeds are excluded; each wikilink resolves to
 * a single destination (or unresolved).
 */
export function getNoteWikiLinks(
	app: App,
	notePath: string,
	lineRange?: LineRange,
): LinkedNoteMetadata[] {
	const file = app.vault.getFileByPath(notePath);
	if (!(file instanceof TFile)) return [];

	const links = app.metadataCache.getFileCache(file)?.links ?? [];
	const result: LinkedNoteMetadata[] = [];
	const seen = new Set<string>();

	for (const link of links) {
		// Wikilinks only (skip markdown links [t](p)); embeds live in .embeds.
		if (!link.original.startsWith("[[")) continue;

		// Selection scoping: keep only links fully inside the selected lines.
		if (
			lineRange &&
			(link.position.start.line < lineRange.fromLine ||
				link.position.end.line > lineRange.toLine)
		) {
			continue;
		}

		const { path, subpath } = parseLinktext(link.link);
		if (!path) continue; // in-document anchor like [[#Heading]]

		const section = subpath.startsWith("#") ? subpath.slice(1) : undefined;
		const displayText = extractAlias(link.original);

		const key = `${path}|${displayText ?? ""}|${section ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);

		const dest = app.metadataCache.getFirstLinkpathDest(path, notePath);
		result.push({
			linkText: path,
			displayText,
			section: section || undefined,
			resolvedPath: dest?.path,
		});
	}

	return result;
}
