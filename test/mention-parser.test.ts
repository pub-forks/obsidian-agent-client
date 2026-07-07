import { describe, it, expect } from "vitest";
import { TFile } from "obsidian";
import {
	detectMention,
	replaceMention,
	extractMentionedNotes,
	type IMentionService,
} from "../src/utils/mention-parser";

function mentionService(files: TFile[]): IMentionService {
	return { getAllFiles: () => files };
}

describe("detectMention", () => {
	it("detects an unclosed @[[ mention with the partial query", () => {
		const text = "hello @[[My No";
		const result = detectMention(text, text.length);
		expect(result).toEqual({
			start: 6,
			end: text.length,
			query: "My No",
		});
	});

	it("keeps the trailing ] in the query while the second ] is untyped (current behavior)", () => {
		const text = "@[[Note]";
		expect(detectMention(text, text.length)).toEqual({
			start: 0,
			end: 8,
			query: "Note]",
		});
	});

	it("returns null once the cursor reaches the end of a closed @[[...]] (current behavior)", () => {
		// The "complete bracket" branch computes closingBracketsPos = index of
		// the second ']', but "]]" only enters textUpToCursor when the cursor
		// is already PAST that index — so the branch can never return a
		// context; every closed mention yields null. The plan's expected case
		// (cursor inside a closed mention -> end = ]]+1) is unreachable.
		const text = "@[[Note]]";
		expect(detectMention(text, 9)).toBeNull();
	});

	it("returns null when the cursor is after a closed mention", () => {
		const text = "@[[Note]] tail";
		expect(detectMention(text, text.length)).toBeNull();
	});

	it("detects a bare @query mention", () => {
		const text = "hello @que";
		expect(detectMention(text, text.length)).toEqual({
			start: 6,
			end: 10,
			query: "que",
		});
	});

	it("detects @ immediately followed by nothing (empty query)", () => {
		expect(detectMention("@", 1)).toEqual({ start: 0, end: 1, query: "" });
	});

	it("returns null when whitespace follows @ before the cursor", () => {
		expect(detectMention("@ foo", 5)).toBeNull();
		expect(detectMention("@que ry", 7)).toBeNull();
		expect(detectMention("@a\tb", 4)).toBeNull();
		expect(detectMention("@a\nb", 4)).toBeNull();
	});

	it("fires on @ embedded in a word like foo@bar (current behavior)", () => {
		const text = "foo@bar";
		expect(detectMention(text, text.length)).toEqual({
			start: 3,
			end: 7,
			query: "bar",
		});
	});

	it("uses the last @ before the cursor", () => {
		const text = "@first @sec";
		expect(detectMention(text, text.length)).toEqual({
			start: 7,
			end: 11,
			query: "sec",
		});
	});

	it("returns null when there is no @ before the cursor", () => {
		expect(detectMention("hello", 5)).toBeNull();
		expect(detectMention("@late", 0)).toBeNull();
	});

	it("returns null for out-of-range cursor positions", () => {
		expect(detectMention("@a", -1)).toBeNull();
		expect(detectMention("@a", 3)).toBeNull();
	});
});

describe("replaceMention", () => {
	it("replaces the mention span with ' @[[Title]] ' (spaces on both sides)", () => {
		const text = "hi @que there";
		const context = { start: 3, end: 7, query: "que" };
		const { newText, newCursorPos } = replaceMention(
			text,
			context,
			"Title",
		);
		expect(newText).toBe("hi  @[[Title]]  there");
		expect(newCursorPos).toBe(3 + " @[[Title]] ".length);
	});

	it("places the cursor right after the inserted replacement", () => {
		const { newText, newCursorPos } = replaceMention(
			"@q",
			{ start: 0, end: 2, query: "q" },
			"Note",
		);
		expect(newText).toBe(" @[[Note]] ");
		expect(newCursorPos).toBe(newText.length);
	});
});

describe("extractMentionedNotes", () => {
	it("resolves mentions by exact basename match", () => {
		const file = new TFile("notes/Alpha.md", "Alpha");
		const result = extractMentionedNotes(
			"see @[[Alpha]]",
			mentionService([file]),
		);
		expect(result).toEqual([{ noteTitle: "Alpha", file }]);
	});

	it("dedupes repeated titles, keeping first occurrence order", () => {
		const alpha = new TFile("Alpha.md", "Alpha");
		const beta = new TFile("Beta.md", "Beta");
		const result = extractMentionedNotes(
			"@[[Alpha]] and @[[Beta]] and @[[Alpha]]",
			mentionService([alpha, beta]),
		);
		expect(result).toEqual([
			{ noteTitle: "Alpha", file: alpha },
			{ noteTitle: "Beta", file: beta },
		]);
	});

	it("keeps unresolved mentions with file undefined", () => {
		const result = extractMentionedNotes(
			"@[[Ghost]]",
			mentionService([]),
		);
		expect(result).toEqual([{ noteTitle: "Ghost", file: undefined }]);
	});

	it("returns the first file when basenames collide (current behavior)", () => {
		// QUIRK-10: linear scan, first match wins; ambiguity unsupported.
		const first = new TFile("a/Note.md", "Note");
		const second = new TFile("b/Note.md", "Note");
		const result = extractMentionedNotes(
			"@[[Note]]",
			mentionService([first, second]),
		);
		expect(result[0].file).toBe(first);
	});

	it("does not match titles containing ] (current behavior)", () => {
		// QUIRK-10: regex is /@\[\[([^\]]+)\]\]/ — a ']' inside the title
		// breaks the match entirely.
		const file = new TFile("Weird].md", "Weird]");
		const result = extractMentionedNotes(
			"@[[Weird]]]",
			mentionService([file]),
		);
		// The regex matches "@[[Weird]]" capturing "Weird", not "Weird]".
		expect(result).toEqual([{ noteTitle: "Weird", file: undefined }]);
	});

	it("returns empty array when there are no mentions", () => {
		expect(extractMentionedNotes("plain text", mentionService([]))).toEqual(
			[],
		);
	});
});
