import { describe, it, expect } from "vitest";
import {
	formatLinkedNotesBlock,
	type FormatLinkedNotesOptions,
} from "../src/utils/wikilink-formatter";
import type { LinkedNoteMetadata } from "../src/utils/wikilink-resolver";

// The formatter is pure. It resolves candidate paths to absolute paths / URIs
// via paths.ts (convertWindowsPathToWsl is a pure regex, no Platform branch),
// so no obsidian-stub Platform mutation is needed here.

const UNIX: FormatLinkedNotesOptions = {
	vaultBasePath: "/vault",
	convertToWsl: false,
};

function link(partial: Partial<LinkedNoteMetadata>): LinkedNoteMetadata {
	return { linkText: "Foo", ...partial };
}

describe("formatLinkedNotesBlock — wrapper and empty handling", () => {
	it("returns '' for zero links (caller emits nothing)", () => {
		expect(formatLinkedNotesBlock([], "/vault/Src.md", UNIX)).toBe("");
	});

	it("wraps links in <obsidian_note_links ref> with the given ref", () => {
		const out = formatLinkedNotesBlock(
			[link({ linkText: "Foo" })],
			"/vault/Src.md",
			UNIX,
		);
		expect(
			out.startsWith('<obsidian_note_links ref="/vault/Src.md">'),
		).toBe(true);
		expect(out.endsWith("</obsidian_note_links>")).toBe(true);
		expect(out).toContain("<links>");
		expect(out).toContain("</links>");
		// Never the old inline wrapper.
		expect(out).not.toContain("obsidian_metadata");
	});

	it("escapes XML special characters in the ref", () => {
		const out = formatLinkedNotesBlock(
			[link({})],
			"/vault/A & B <\"'>.md",
			UNIX,
		);
		expect(out).toContain('ref="/vault/A &amp; B &lt;&quot;&apos;&gt;.md"');
	});
});

describe("formatLinkedNotesBlock — per-link rendering", () => {
	it("renders an unresolved link as self-closing resolved=false (no path/uri)", () => {
		const out = formatLinkedNotesBlock(
			[link({ linkText: "Missing" })],
			"/vault/Src.md",
			UNIX,
		);
		expect(out).toContain('<link text="Missing" resolved="false" />');
		expect(out).not.toContain("path=");
	});

	it("renders a resolved link as resolved=true with path and uri", () => {
		const out = formatLinkedNotesBlock(
			[link({ linkText: "Note", resolvedPath: "folder/Note.md" })],
			"/vault/Src.md",
			UNIX,
		);
		expect(out).toContain(
			'<link text="Note" path="/vault/folder/Note.md" uri="file:///vault/folder/Note.md" resolved="true" />',
		);
	});

	it("includes displayText and section attributes when present", () => {
		const out = formatLinkedNotesBlock(
			[
				link({
					linkText: "Foo",
					displayText: "bar",
					section: "Heading",
				}),
			],
			"/vault/Src.md",
			UNIX,
		);
		expect(out).toContain(
			'<link text="Foo" displayText="bar" section="Heading" resolved="false" />',
		);
	});

	it("omits displayText and section when absent", () => {
		const out = formatLinkedNotesBlock(
			[link({ linkText: "Foo" })],
			"/vault/Src.md",
			UNIX,
		);
		expect(out).not.toContain("displayText=");
		expect(out).not.toContain("section=");
	});

	it("escapes XML special characters in link attributes", () => {
		const out = formatLinkedNotesBlock(
			[link({ linkText: "A & B<\"'>" })],
			"/vault/Src.md",
			UNIX,
		);
		expect(out).toContain(
			'<link text="A &amp; B&lt;&quot;&apos;&gt;" resolved="false" />',
		);
	});
});

describe("formatLinkedNotesBlock — 50-link cap", () => {
	function makeLinks(n: number): LinkedNoteMetadata[] {
		return Array.from({ length: n }, (_, i) => link({ linkText: `L${i}` }));
	}

	it("emits <links> without truncated when at or under the cap", () => {
		const out = formatLinkedNotesBlock(makeLinks(3), "/vault/Src.md", {
			...UNIX,
			maxLinks: 3,
		});
		expect(out).toContain("<links>");
		expect(out).not.toContain("truncated=");
		expect(out.match(/<link /g)?.length).toBe(3);
	});

	it("caps at maxLinks and reports the overflow via truncated", () => {
		const out = formatLinkedNotesBlock(makeLinks(5), "/vault/Src.md", {
			...UNIX,
			maxLinks: 3,
		});
		expect(out).toContain('<links truncated="2">');
		expect(out.match(/<link /g)?.length).toBe(3);
	});

	it("defaults the cap to 50", () => {
		const out = formatLinkedNotesBlock(
			makeLinks(51),
			"/vault/Src.md",
			UNIX,
		);
		expect(out).toContain('<links truncated="1">');
		expect(out.match(/<link /g)?.length).toBe(50);
	});
});

describe("formatLinkedNotesBlock — path handling", () => {
	it("returns the relative path unchanged when vaultBasePath is empty", () => {
		const out = formatLinkedNotesBlock(
			[link({ linkText: "Note", resolvedPath: "folder/Note.md" })],
			"Src.md",
			{ vaultBasePath: "", convertToWsl: false },
		);
		expect(out).toContain('path="folder/Note.md"');
		expect(out).toContain('uri="file://folder/Note.md"');
	});

	it("converts to a WSL path when convertToWsl is set", () => {
		const out = formatLinkedNotesBlock(
			[link({ linkText: "Note", resolvedPath: "folder/Note.md" })],
			"C:\\Vault\\Src.md",
			{ vaultBasePath: "C:\\Vault", convertToWsl: true },
		);
		expect(out).toContain('path="/mnt/c/Vault/folder/Note.md"');
		expect(out).toContain('uri="file:///mnt/c/Vault/folder/Note.md"');
	});
});
