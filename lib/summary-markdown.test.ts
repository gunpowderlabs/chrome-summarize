import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { normalizeSummaryMarkdown } from "./summary-markdown";

// Same flattened structure as the reported Gizmodo summary: four bullets,
// an inline heading, and five numbered steps, with bold phrases still intact.
const flattened = "* Police flag **travel patterns**. * Cameras collect location data. * A survey found **46 percent opposition**. * Drivers challenged traffic stops. ## Apply this to your life 1. Review your state laws. 2. Evaluate your privacy concerns. 3. Monitor local announcements. 4. Contact your representatives. 5. Review your travel habits.";

test.each(["static", "streaming"] as const)("renders collapsed summary blocks in %s mode", (mode) => {
  const html = renderToStaticMarkup(createElement(Streamdown, {
    mode, controls: false, skipHtml: true,
    children: normalizeSummaryMarkdown(flattened),
  }));

  expect(html.match(/<ul\b/g)).toHaveLength(1);
  expect(html.match(/<ol\b/g)).toHaveLength(1);
  expect(html.match(/<li\b/g)).toHaveLength(9);
  expect(html).toMatch(/<h2[^>]*>Apply this to your life<\/h2>/);
  expect(html).toContain('data-streamdown="strong">travel patterns</span>');
  expect(html).not.toContain("## Apply");
  expect(html).not.toContain(". * ");
});

test("preserves formatted Markdown and is idempotent", () => {
  const formatted = "- A **point**.\n- Another point.\n\n## Apply this to your life\n\n1. Do this.\n2. Do that.";
  expect(normalizeSummaryMarkdown(formatted)).toBe(formatted);
  const repaired = normalizeSummaryMarkdown(flattened);
  expect(normalizeSummaryMarkdown(repaired)).toBe(repaired);
});

test("preserves prose, arithmetic, and complex Markdown instead of guessing", () => {
  for (const text of [
    "The result is 2 * 3. Version 2. Use it today.",
    "- A point about **bold** and *emphasis*.",
    "- Use `text. * literal`. ## Apply this to your life 1. Try it.",
    "- See [a label. * literal](https://example.com). ## Apply this to your life 1. Read it.",
    "```text\n* literal. * literal.\n```",
  ]) expect(normalizeSummaryMarkdown(text)).toBe(text);
});

test("only splits sequential guide steps, preserving numbers in prose", () => {
  const text = "- It uses **version 2.0**. - Multiply 2 * 3. ## Apply this to your life 1. Open version 2. Use the menu. 2. Check the result.";
  expect(normalizeSummaryMarkdown(text)).toBe("- It uses **version 2.0**.\n- Multiply 2 * 3.\n\n## Apply this to your life\n\n1. Open version 2. Use the menu.\n2. Check the result.");
});

test("supports the no-application explanation and an unfinished streamed guide", () => {
  expect(normalizeSummaryMarkdown("+ News happened. + More news happened. ## Apply this to your life No useful personal application exists."))
    .toBe("+ News happened.\n+ More news happened.\n\n## Apply this to your life\n\nNo useful personal application exists.");
  expect(normalizeSummaryMarkdown("* A point. ## Apply this to your life 1. Review this. 2. Start"))
    .toBe("* A point.\n\n## Apply this to your life\n\n1. Review this.\n2. Start");
});
