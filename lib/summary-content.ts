export interface SummaryContent {
  bullets: string[];
  steps: string[];
  applicationNote: string | null;
}

// Strings are retained only for existing session summaries and native YTS output.
export type StoredSummary = SummaryContent | string;

export const APPLICATION_HEADING = "Apply this to your life";

/** Only inline bold is interpreted. Everything else remains literal text. */
export function inlineBoldParts(text: string): { text: string; bold: boolean }[] {
  const parts: { text: string; bold: boolean }[] = [];
  const tokens = /\\[\\*_]|\*\*|__/g;
  let plain = "";
  let bold = "";
  let delimiter: string | null = null;
  let position = 0;
  for (const token of text.matchAll(tokens)) {
    const before = text.slice(position, token.index);
    if (delimiter) bold += before;
    else plain += before;
    const marker = token[0];
    if (marker.startsWith("\\")) {
      if (delimiter) bold += marker.slice(1);
      else plain += marker.slice(1);
    } else if (delimiter === marker) {
      parts.push({ text: plain, bold: false }, { text: bold, bold: true });
      plain = "";
      bold = "";
      delimiter = null;
    } else if (delimiter) {
      bold += marker;
    } else {
      delimiter = marker;
    }
    position = token.index + marker.length;
  }
  // An unfinished streamed bold span stays visible as text until it closes.
  parts.push({ text: plain + (delimiter ? delimiter + bold : "") + text.slice(position), bold: false });
  return parts.filter((part) => part.text.length > 0);
}

export function plainInlineText(text: string): string {
  return inlineBoldParts(text).map((part) => part.text).join("");
}

/** Serialize only at the Readwise/export boundary, never for panel rendering. */
export function summaryToText(summary: StoredSummary): string {
  if (typeof summary === "string") return plainInlineText(summary);
  const bullets = summary.bullets.map((text) => `- ${plainInlineText(text)}`).join("\n");
  const application = summary.steps.length
    ? summary.steps.map((text, index) => `${index + 1}. ${plainInlineText(text)}`).join("\n")
    : plainInlineText(summary.applicationNote ?? "");
  return [bullets, application ? `${APPLICATION_HEADING}\n\n${application}` : ""].filter(Boolean).join("\n\n");
}

export function summaryWordCount(tldr: string | null, summary: StoredSummary): number {
  const prose = typeof summary === "string"
    ? [summary]
    : [...summary.bullets, ...summary.steps, summary.applicationNote ?? ""];
  return plainInlineText([tldr ?? "", ...prose].join(" ")).trim().split(/\s+/).filter(Boolean).length;
}
