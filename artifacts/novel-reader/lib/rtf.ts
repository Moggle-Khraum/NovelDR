// RTF text escaping, shared by the standard RTF export and the RTF part writer.
// Escapes backslashes and braces, and turns line breaks into paragraph marks.

export function escapeRTF(str: string): string {
  if (!str) return "";
  return str
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\n/g, "\\par ");
}
