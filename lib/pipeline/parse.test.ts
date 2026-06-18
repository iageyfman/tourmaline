import { describe, it, expect } from "vitest";
import {
  parseNote,
  normalizeBody,
  parseFrontmatter,
  maskCode,
  extractLinks,
  extractTags,
  normalizeTag,
  LINK_RE,
} from "./parse";

// ── normalizeBody ─────────────────────────────────────────────────────────────

describe("normalizeBody", () => {
  it("leaves LF-only text unchanged", () => {
    expect(normalizeBody("a\nb\nc")).toBe("a\nb\nc");
  });

  it("converts CRLF to LF", () => {
    expect(normalizeBody("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  it("converts bare CR to LF", () => {
    expect(normalizeBody("a\rb")).toBe("a\nb");
  });

  it("handles mixed line endings", () => {
    expect(normalizeBody("a\r\nb\rc")).toBe("a\nb\nc");
  });
});

// ── normalizeTag ──────────────────────────────────────────────────────────────

describe("normalizeTag", () => {
  it("lowercases the tag", () => {
    expect(normalizeTag("PROJECT")).toBe("project");
  });

  it("strips a leading # if present", () => {
    expect(normalizeTag("#project")).toBe("project");
  });

  it("preserves nested slash notation", () => {
    expect(normalizeTag("area/work")).toBe("area/work");
  });

  it("collapses double slashes", () => {
    expect(normalizeTag("a//b")).toBe("a/b");
  });

  it("trims leading and trailing slashes", () => {
    expect(normalizeTag("/tag/")).toBe("tag");
  });

  it("returns null for pure-numeric strings", () => {
    expect(normalizeTag("123")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeTag("")).toBeNull();
  });

  it("returns null for whitespace-only", () => {
    expect(normalizeTag("   ")).toBeNull();
  });

  it("accepts tags that mix letters and digits", () => {
    expect(normalizeTag("v2ray")).toBe("v2ray");
  });

  it("accepts hex-like tags that contain letters", () => {
    // '#fff' has letters so it IS a tag; '#123' is pure-numeric so it is NOT
    expect(normalizeTag("fff")).toBe("fff");
  });
});

// ── parseFrontmatter ──────────────────────────────────────────────────────────

describe("parseFrontmatter", () => {
  it("returns empty result when there is no frontmatter", () => {
    const result = parseFrontmatter("No frontmatter here.");
    expect(result).toEqual({ properties: {}, fmTags: [], contentStart: 0 });
  });

  it("parses a simple YAML block", () => {
    const body = "---\ntitle: Hello\nstatus: active\n---\nContent";
    const { properties, fmTags, contentStart } = parseFrontmatter(body);
    expect(properties).toEqual({ title: "Hello", status: "active" });
    expect(fmTags).toEqual([]);
    expect(contentStart).toBe(body.indexOf("Content"));
  });

  it("parses tags as an array", () => {
    const body = "---\ntags: [planning, area/work]\n---\n";
    const { fmTags } = parseFrontmatter(body);
    expect(fmTags).toEqual(["planning", "area/work"]);
  });

  it("parses tags as a comma-separated string", () => {
    const body = "---\ntags: planning, area/work\n---\n";
    const { fmTags } = parseFrontmatter(body);
    expect(fmTags).toEqual(["planning", "area/work"]);
  });

  it("parses tags as a bare string (single tag)", () => {
    const body = "---\ntags: urgent\n---\n";
    const { fmTags } = parseFrontmatter(body);
    expect(fmTags).toEqual(["urgent"]);
  });

  it("stores _raw_error and _raw when YAML is invalid, still advances contentStart", () => {
    const body = "---\n: bad: yaml: value\n---\nContent";
    const { properties, fmTags, contentStart } = parseFrontmatter(body);
    expect(properties).toHaveProperty("_raw_error");
    expect(properties).toHaveProperty("_raw");
    expect(fmTags).toEqual([]);
    expect(contentStart).toBeGreaterThan(0);
  });

  it("treats a non-object YAML value (e.g. a plain string) as empty properties", () => {
    const body = "---\njust a string\n---\n";
    const { properties } = parseFrontmatter(body);
    expect(properties).toEqual({});
  });

  it("does not recognise frontmatter that does not start at byte 0", () => {
    const body = "\n---\ntitle: x\n---\n";
    const { contentStart } = parseFrontmatter(body);
    expect(contentStart).toBe(0);
  });
});

// ── maskCode ──────────────────────────────────────────────────────────────────

describe("maskCode", () => {
  it("blanks a fenced block, preserving line lengths and structure", () => {
    const text = "before\n```\n[[InFence]]\n#fencedtag\n```\nafter";
    const masked = maskCode(text);
    // fence lines and content are blanked; surrounding lines are unchanged
    expect(masked).toContain("before");
    expect(masked).toContain("after");
    expect(masked).not.toContain("[[InFence]]");
    expect(masked).not.toContain("#fencedtag");
  });

  it("blanks a tilde fenced block", () => {
    const masked = maskCode("~~~\n[[InTildeFence]]\n~~~");
    expect(masked).not.toContain("[[InTildeFence]]");
  });

  it("requires closing delimiter to be at least as long as the opening", () => {
    // ``` opened, ```` closes a longer fence — the ``` body stays fenced
    const masked = maskCode("````\n[[Inside]]\n````");
    expect(masked).not.toContain("[[Inside]]");
  });

  it("blanks inline code, preserving the rest of the line", () => {
    const masked = maskCode("before `[[inline]] #tag` after");
    expect(masked).not.toContain("[[inline]]");
    expect(masked).not.toContain("#tag");
    expect(masked).toContain("before");
    expect(masked).toContain("after");
  });

  it("preserves length of masked regions (offsets not shifted)", () => {
    const text = "a `b` c";
    const masked = maskCode(text);
    expect(masked.length).toBe(text.length);
  });

  it("leaves unterminated inline backtick runs in place", () => {
    // Unterminated: no second backtick — leave the rest of the line intact
    const text = "a `unclosed and [[Link]]";
    const masked = maskCode(text);
    // The link text should still be visible because the backtick run was unterminated
    expect(masked).toContain("[[Link]]");
  });

  it("handles text with no code", () => {
    const text = "just plain text [[Link]] #tag";
    expect(maskCode(text)).toBe(text);
  });

  it("handles fenced block with a language hint", () => {
    const masked = maskCode("```js\n[[InFence]]\n```");
    expect(masked).not.toContain("[[InFence]]");
  });
});

// ── extractLinks ─────────────────────────────────────────────────────────────

describe("extractLinks", () => {
  it("extracts a basic wiki-link", () => {
    const links = extractLinks("See [[Alpha]] for details.");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ targetTitle: "Alpha", isEmbed: false, position: 0 });
  });

  it("extracts an embed link", () => {
    const links = extractLinks("![[Alpha]]");
    expect(links[0]).toMatchObject({ targetTitle: "Alpha", isEmbed: true });
  });

  it("strips the alias, preserves the title", () => {
    const links = extractLinks("[[Alpha|see alpha]]");
    expect(links[0].targetTitle).toBe("Alpha");
  });

  it("trims whitespace from targetTitle", () => {
    const links = extractLinks("[[ Alpha ]]");
    expect(links[0].targetTitle).toBe("Alpha");
  });

  it("skips empty or whitespace-only link text", () => {
    expect(extractLinks("[[]]")).toHaveLength(0);
    expect(extractLinks("[[ ]]")).toHaveLength(0);
    expect(extractLinks("[[|alias]]")).toHaveLength(0);
  });

  it("assigns sequential positions across multiple links", () => {
    const links = extractLinks("[[A]] and [[B]] and [[C]]");
    expect(links.map((l) => l.position)).toEqual([0, 1, 2]);
  });

  it("preserves case in targetTitle", () => {
    const links = extractLinks("[[My Note]]");
    expect(links[0].targetTitle).toBe("My Note");
  });

  it("LINK_RE export matches the same links as extractLinks", () => {
    const text = "[[A]] ![[B]]";
    LINK_RE.lastIndex = 0;
    const matches: string[] = [];
    let m;
    while ((m = LINK_RE.exec(text)) !== null) matches.push(m[2]);
    const extracted = extractLinks(text).map((l) => l.targetTitle);
    expect(matches).toEqual(extracted);
  });
});

// ── extractTags ───────────────────────────────────────────────────────────────

describe("extractTags", () => {
  it("extracts a basic tag", () => {
    expect(extractTags("#project")).toContain("project");
  });

  it("extracts a nested tag", () => {
    expect(extractTags("#area/work")).toContain("area/work");
  });

  it("does NOT extract a tag that is just digits", () => {
    expect(extractTags("#123")).toHaveLength(0);
  });

  it("extracts #fff (contains a letter)", () => {
    expect(extractTags("#fff")).toContain("fff");
  });

  it("does NOT treat '# heading' as a tag (space after #)", () => {
    expect(extractTags("# Heading")).toHaveLength(0);
  });

  it("extracts tags after whitespace mid-line", () => {
    expect(extractTags("Tags: #planning #urgent")).toEqual(
      expect.arrayContaining(["planning", "urgent"]),
    );
  });

  it("lowercases extracted tags", () => {
    expect(extractTags("#UPPER")).toContain("upper");
  });

  it("deduplicates (via parseNote) — raw extractTags may return duplicates", () => {
    // extractTags itself may return duplicates; parseNote dedupes
    const result = parseNote({ title: "t", body: "#dup #dup" });
    expect(result.tags.filter((t) => t === "dup")).toHaveLength(1);
  });
});

// ── parseNote (integration) ───────────────────────────────────────────────────

describe("parseNote", () => {
  it("returns the normalized body", () => {
    const { body } = parseNote({ title: "T", body: "a\r\nb" });
    expect(body).toBe("a\nb");
  });

  it("extracts links from the body", () => {
    const { links } = parseNote({ title: "T", body: "See [[Alpha]]." });
    expect(links).toHaveLength(1);
    expect(links[0].targetTitle).toBe("Alpha");
  });

  it("does NOT extract links from a fenced code block", () => {
    const body = "```\n[[InsideFence]]\n```";
    const { links } = parseNote({ title: "T", body });
    expect(links).toHaveLength(0);
  });

  it("does NOT extract tags from a fenced code block", () => {
    const body = "```\n#fenced\n```";
    const { tags } = parseNote({ title: "T", body });
    expect(tags).toHaveLength(0);
  });

  it("does NOT extract links from inline code", () => {
    const { links } = parseNote({ title: "T", body: "Try `[[inline]]` ok" });
    expect(links).toHaveLength(0);
  });

  it("does NOT extract tags from inline code", () => {
    const { tags } = parseNote({ title: "T", body: "`#inlinetag`" });
    expect(tags).toHaveLength(0);
  });

  it("merges tags from frontmatter and body, deduped", () => {
    const body = [
      "---",
      "tags: [planning, area/work]",
      "---",
      "",
      "Body tag: #planning #urgent",
    ].join("\n");
    const { tags } = parseNote({ title: "T", body });
    expect(tags).toContain("planning");
    expect(tags).toContain("area/work");
    expect(tags).toContain("urgent");
    expect(tags.filter((t) => t === "planning")).toHaveLength(1); // deduped
  });

  it("does NOT extract links from frontmatter", () => {
    const body = "---\ndesc: see [[Alpha]]\n---\n";
    const { links } = parseNote({ title: "T", body });
    // frontmatter content is above contentStart; the scan starts at contentStart
    expect(links).toHaveLength(0);
  });

  it("parses frontmatter properties", () => {
    const body = "---\nstatus: active\npriority: 1\n---\n";
    const { properties } = parseNote({ title: "T", body });
    expect(properties).toMatchObject({ status: "active", priority: 1 });
  });

  it("handles the full exit-test kickoff body", () => {
    const body = [
      "---",
      "title: Project Kickoff",
      "status: active",
      "priority: 1",
      "tags: [planning, area/work]",
      "due: 2026-07-01",
      "---",
      "",
      "# Project Kickoff",
      "",
      "Links to [[Welcome]] and to [[Nonexistent Page]] (missing).",
      "Aliased link: [[Welcome|the welcome note]].",
      "",
      "![[Welcome]]",
      "",
      "Tags: #project #urgent #area/work",
    ].join("\n");
    const { links, tags, properties } = parseNote({ title: "Project Kickoff", body });

    // Links: Welcome (twice: plain + alias + embed), Nonexistent Page
    const titles = links.map((l) => l.targetTitle);
    expect(titles).toContain("Welcome");
    expect(titles).toContain("Nonexistent Page");
    expect(links.find((l) => l.targetTitle === "Welcome" && l.isEmbed)).toBeTruthy();

    // Tags: merged from frontmatter + body, deduped
    expect(tags).toContain("planning");
    expect(tags).toContain("area/work");
    expect(tags).toContain("project");
    expect(tags).toContain("urgent");
    expect(tags.filter((t) => t === "area/work")).toHaveLength(1);

    // Properties parsed from frontmatter
    expect(properties).toMatchObject({ status: "active", priority: 1 });
  });

  it("handles the exit-test code-sample body (code links/tags ignored)", () => {
    const body = [
      "---",
      "title: Code Sample",
      "---",
      "",
      "A real link [[Welcome]] and a real tag #documented.",
      "",
      "```js",
      'const a = "[[In Fenced Block]] and #fencedtag";',
      "```",
      "",
      "Inline: `[[Inline Link]] and #inlinetag` must be ignored.",
    ].join("\n");
    const { links, tags } = parseNote({ title: "Code Sample", body });

    const titles = links.map((l) => l.targetTitle);
    expect(titles).toContain("Welcome");
    expect(titles).not.toContain("In Fenced Block");
    expect(titles).not.toContain("Inline Link");

    expect(tags).toContain("documented");
    expect(tags).not.toContain("fencedtag");
    expect(tags).not.toContain("inlinetag");
  });
});
