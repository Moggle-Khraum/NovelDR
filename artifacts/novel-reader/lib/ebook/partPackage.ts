// Packages one finished part (EPUB or DOCX) with JSZip, the default path.
//
// The part's entries are read from its folder in archive order, so "mimetype"
// (EPUB) is first and stored. A part is capped at a few MB of text, so holding
// it in memory here is acceptable. The zip-from-disk path is a fallback (see
// exportDevice.ts).

import { zipToBase64 } from "./package";

export async function packagePart(
  entries: string[],
  readText: (relativePath: string) => Promise<string>,
  mimeType: string,
): Promise<string> {
  const files: Record<string, string> = {};
  for (const rel of entries) {
    files[rel] = await readText(rel);
  }
  return zipToBase64(files, mimeType);
}
