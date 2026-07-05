/**
 * Wikilink metadata formatter
 *
 * Pure function: takes a `LinkedNoteMetadata[]` (vault-relative), the source
 * note's ref, and the vault base path / WSL flag, and produces a standalone
 * `<obsidian_note_links ref="…">` block. The block is emitted as a SIBLING of
 * the note content (a separate content block in the embedded transport, a
 * sibling XML element in the text transport), never merged into the note body
 * — so `resource.text` / `<obsidian_mentioned_note>` stay byte-identical to
 * the note as the agent would read it from disk.
 */

import type { LinkedNoteMetadata } from "./wikilink-resolver";
import { buildFileUri, resolveAbsolutePath } from "./paths";

/** Hard cap on links per note. Beyond this, emit `truncated="N"`. */
const MAX_LINKS_PER_NOTE = 50;

export interface FormatLinkedNotesOptions {
	vaultBasePath: string;
	convertToWsl: boolean;
	/** Override the cap (tests). Defaults to MAX_LINKS_PER_NOTE. */
	maxLinks?: number;
}

/**
 * Build the `<obsidian_note_links ref="…">` block for a note.
 *
 * `sourceRef` is the identifier the sibling note block uses in this transport
 * (the resource `uri` for embedded, the absolute path for the XML
 * `<obsidian_mentioned_note ref>`), so the agent can correlate the two.
 * Returns an empty string when there are no links; callers skip emitting in
 * that case, preserving byte-identical output for link-free notes.
 */
export function formatLinkedNotesBlock(
	links: LinkedNoteMetadata[],
	sourceRef: string,
	options: FormatLinkedNotesOptions,
): string {
	if (links.length === 0) return "";

	const cap = options.maxLinks ?? MAX_LINKS_PER_NOTE;
	const truncated = links.length > cap;
	const visibleLinks = truncated ? links.slice(0, cap) : links;

	const linkLines = visibleLinks.map((link) =>
		formatLink(link, options.vaultBasePath, options.convertToWsl),
	);

	const linksOpen = truncated
		? `<links truncated="${links.length - cap}">`
		: "<links>";

	return `<obsidian_note_links ref="${escapeAttr(sourceRef)}">\n  ${linksOpen}\n${linkLines.join("\n")}\n  </links>\n</obsidian_note_links>`;
}

function formatLink(
	link: LinkedNoteMetadata,
	vaultBasePath: string,
	convertToWsl: boolean,
): string {
	const attrs: string[] = [`text="${escapeAttr(link.linkText)}"`];
	if (link.displayText) {
		attrs.push(`displayText="${escapeAttr(link.displayText)}"`);
	}
	if (link.section) {
		attrs.push(`section="${escapeAttr(link.section)}"`);
	}

	if (link.resolvedPath === undefined) {
		attrs.push(`resolved="false"`);
		return `    <link ${attrs.join(" ")} />`;
	}

	const absolutePath = resolveAbsolutePath(
		link.resolvedPath,
		vaultBasePath,
		convertToWsl,
	);
	attrs.push(`path="${escapeAttr(absolutePath)}"`);
	attrs.push(`uri="${escapeAttr(buildFileUri(absolutePath))}"`);
	attrs.push(`resolved="true"`);
	return `    <link ${attrs.join(" ")} />`;
}

/** XML attribute-value escaping. Covers all five XML predefined entities. */
function escapeAttr(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
