import { Streamdown } from "streamdown";
import { APPLICATION_HEADING, inlineBoldParts, type StoredSummary } from "../../lib/summary-content";

export function InlineBold({ children }: { children: string }) {
  return <>{inlineBoldParts(children).map((part, index) =>
    part.bold ? <strong key={index}>{part.text}</strong> : part.text
  )}</>;
}

function LegacyMarkdown({ children, streaming }: { children: string; streaming: boolean }) {
  return <Streamdown className="space-y-0" controls={false} isAnimating={streaming}
    mode={streaming ? "streaming" : "static"} skipHtml>{children}</Streamdown>;
}

export function SummaryOverview({ text, legacy, streaming }: { text: string; legacy: boolean; streaming: boolean }) {
  return legacy
    ? <LegacyMarkdown streaming={streaming}>{text}</LegacyMarkdown>
    : <p><InlineBold>{text}</InlineBold></p>;
}

export function SummaryBody({ summary, streaming }: { summary: StoredSummary; streaming: boolean }) {
  if (typeof summary === "string") return <LegacyMarkdown streaming={streaming}>{summary}</LegacyMarkdown>;

  // Omit empty in-progress strings without changing the stored array order.
  const bullets = summary.bullets.filter((text) => text.trim());
  const steps = summary.steps.filter((text) => text.trim());
  const note = summary.applicationNote?.trim();
  return <>
    {bullets.length > 0 && <ul>{bullets.map((text, index) =>
      <li key={index}><InlineBold>{text}</InlineBold></li>
    )}</ul>}
    {(steps.length > 0 || note) && <h2>{APPLICATION_HEADING}</h2>}
    {steps.length > 0
      ? <ol>{steps.map((text, index) => <li key={index}><InlineBold>{text}</InlineBold></li>)}</ol>
      : note && <p><InlineBold>{note}</InlineBold></p>}
  </>;
}
