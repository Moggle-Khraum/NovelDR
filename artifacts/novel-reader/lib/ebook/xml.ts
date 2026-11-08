// XML helpers shared by the EPUB and DOCX builders. Pure functions, no imports.

// Characters that XML 1.0 does not allow, even when escaped.
const INVALID_XML_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

// Escapes text for use in element content or attribute values.
export function xmlText(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Splits chapter text into paragraphs. Blank lines separate paragraphs. Single
// line breaks inside a paragraph are kept as separate lines. Each paragraph is
// returned as its list of lines, with empty paragraphs removed.
export function splitParagraphs(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .filter((lines) => lines.length > 0);
}

// A stable, XML-safe identifier built from an internal id.
export function safeId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9-]/g, "-").replace(/-+/g, "-");
  return cleaned.length > 0 ? cleaned : "novel";
}

// Current time in the second-precision UTC form used by EPUB and OOXML dates.
export function isoSeconds(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
