import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineBold, SummaryBody, SummaryOverview } from "../src/components/SummaryContent";
import { plainInlineText, summaryToText, summaryWordCount, type SummaryContent } from "./summary-content";
import { normalizePartial, summarySchema } from "./summarize";

const content: SummaryContent = {
  bullets: ["Police flag **travel patterns**.", "Cameras collect location data.", "A survey found **46 percent opposition**.", "Drivers challenged traffic stops."],
  steps: ["Review your state laws.", "Evaluate your privacy concerns.", "Monitor local announcements.", "Contact your representatives.", "Review your travel habits."],
  applicationNote: null,
};

test.each([false, true])("renders separate list items and inline bold (streaming=%s)", (streaming) => {
  const html = renderToStaticMarkup(createElement(SummaryBody, { summary: content, streaming }));
  expect(html.match(/<li>/g)).toHaveLength(9);
  expect(html).toContain("<strong>travel patterns</strong>");
  expect(html).toContain("</ul><h2>Apply this to your life</h2><ol>");
  expect(html).not.toContain("**");
  expect(html).not.toContain("##");
});

test("renders incomplete array items without inventing empty lists or headings", () => {
  const partial = normalizePartial({ bullets: ["First **point**.", null, 1, "", "Partial **bold"], steps: ["", false] });
  const html = renderToStaticMarkup(createElement(SummaryBody, { summary: partial, streaming: true }));
  expect(html.match(/<li>/g)).toHaveLength(2);
  expect(html).toContain("Partial **bold");
  expect(html).not.toContain("<ol>");
  expect(html).not.toContain("<h2>");
  expect(renderToStaticMarkup(createElement(SummaryBody, { summary: normalizePartial({}), streaming: true }))).toBe("");
});

test("renders an application explanation without an empty numbered list", () => {
  const summary = { ...content, steps: [], applicationNote: "This report offers **no actionable advice**." };
  const html = renderToStaticMarkup(createElement(SummaryBody, { summary, streaming: false }));
  expect(html).toContain("<h2>Apply this to your life</h2><p>This report offers <strong>no actionable advice</strong>.</p>");
  expect(html).not.toContain("<ol>");
});

test("inline text cannot inject HTML, links, headings, or additional list items", () => {
  const summary = { ...content, bullets: ["**<img src=x onerror=alert(1)>**\n# Heading\n- Item [link](https://example.com)."], steps: [] };
  const html = renderToStaticMarkup(createElement(SummaryBody, { summary, streaming: false }));
  expect(html.match(/<li>/g)).toHaveLength(1);
  expect(html).toContain("&lt;img");
  for (const tag of ["<img", "<a", "<h1", "<script"]) expect(html).not.toContain(tag);
});

test("inline bold handles both delimiters, escapes, and unfinished streamed markers", () => {
  const text = "A **bold** and __strong__ word. \\*\\*literal\\*\\* and **unfinished";
  expect(renderToStaticMarkup(createElement(InlineBold, { children: text })))
    .toBe("A <strong>bold</strong> and <strong>strong</strong> word. **literal** and **unfinished");
  expect(plainInlineText(text)).toBe("A bold and strong word. **literal** and **unfinished");
  expect(renderToStaticMarkup(createElement(SummaryOverview, { text: "A **brief** overview.", legacy: false, streaming: true })))
    .toBe("<p>A <strong>brief</strong> overview.</p>");
});

test("legacy cached and YTS summaries retain normal Markdown rendering", () => {
  const summary = "- A cached point.\n- Another point.\n\n## Existing heading\n\n1. A step.";
  const html = renderToStaticMarkup(createElement(SummaryBody, { summary, streaming: false }));
  expect(html.match(/<li\b/g)).toHaveLength(3);
  expect(html).toMatch(/<h2[^>]*>Existing heading<\/h2>/);
  expect(summaryToText("A **YouTube** summary.")).toBe("A YouTube summary.");
});

test("Readwise serialization includes each bullet and numbered step, without bold markers", () => {
  expect(summaryToText({ bullets: ["First **point**.", "Second point."], steps: ["Try __this__.", "Check results."], applicationNote: null }))
    .toBe("- First point.\n- Second point.\n\nApply this to your life\n\n1. Try this.\n2. Check results.");
  expect(summaryToText({ bullets: ["News."], steps: [], applicationNote: "No **useful** application." }))
    .toBe("- News.\n\nApply this to your life\n\nNo useful application.");
  expect(summaryWordCount("Brief overview.", { bullets: ["First **point**."], steps: ["Try this."], applicationNote: null })).toBe(6);
});

test("final validation requires nonempty bullets, complete items, and exactly one application mode", () => {
  const valid = { tldr: "Overview.", ...content, tags: [] };
  expect(summarySchema.safeParse(valid).success).toBe(true);
  expect(summarySchema.safeParse({ ...valid, steps: [], applicationNote: "No personal application exists." }).success).toBe(true);
  const invalid = [
    { bullets: [] }, { bullets: [""] }, { bullets: ["Unfinished"] },
    { bullets: ["An **unclosed phrase."] }, { bullets: ["An __unclosed phrase."] },
    { bullets: ["- List marker."] }, { steps: ["1. Numbered step."] },
    { steps: ["## Heading."] }, { steps: ["Unfinished"] },
    { steps: [], applicationNote: null }, { steps: [], applicationNote: "" },
    { applicationNote: "Do this too." }, { steps: [], applicationNote: "Unfinished" },
  ];
  for (const override of invalid) expect(summarySchema.safeParse({ ...valid, ...override }).success).toBe(false);
  const failure = summarySchema.safeParse({ ...valid, steps: ["Complete.", "Unfinished"] });
  expect(failure.success).toBe(false);
  if (!failure.success) expect(failure.error.issues[0]?.path).toEqual(["steps", 1]);
});
