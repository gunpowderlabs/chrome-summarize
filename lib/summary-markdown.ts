/**
 * Recover the known summary/guide layout when a model puts it on one line.
 * Leave ordinary prose, existing multiline Markdown, and complex inline syntax
 * alone: guessing their block boundaries could change the author's meaning.
 */
export function normalizeSummaryMarkdown(text: string): string {
  if (/[\r\n`\[<>]/.test(text)) return text;

  const match = text.match(/^\s*([-*+]) (.+?)\s+## Apply this to your life(?:\s+(.+))?$/);
  if (!match) return text;

  const [, marker, body = "", guide = ""] = match;
  // Only treat markers after complete sentences as collapsed list boundaries.
  const bullets = `${marker} ${body}`.replace(
    /([.!?]["'’”]?)\s+([-*+]) (?=\S)/g,
    "$1\n$2 "
  );

  let nextStep = 2;
  const steps = /^1[.)] /.test(guide)
    ? guide.replace(/([.!?]["'’”]?)\s+(\d+)([.)]) (?=\S)/g, (original, end, number, delimiter) => {
        if (Number(number) !== nextStep) return original;
        nextStep++;
        return `${end}\n${number}${delimiter} `;
      })
    : guide;

  return `${bullets}\n\n## Apply this to your life${steps ? `\n\n${steps}` : ""}`;
}
