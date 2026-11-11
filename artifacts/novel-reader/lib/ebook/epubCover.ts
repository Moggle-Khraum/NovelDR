// Cover support for EPUB only.
//
// The cover is the novel's local cover file, when one exists. Remote covers are
// not used, because exports must work offline. A cover above MAX_COVER_BYTES is
// skipped, so a large image cannot make an export fail on a low-end phone.

import { xmlText } from "./xml";

export const MAX_COVER_BYTES = 5 * 1024 * 1024;

export type EpubCover = {
  fileName: string;
  mediaType: string;
};

export function coverFromFileName(name: string): EpubCover | null {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (ext === "jpg" || ext === "jpeg")
    return { fileName: "cover.jpg", mediaType: "image/jpeg" };
  if (ext === "png") return { fileName: "cover.png", mediaType: "image/png" };
  if (ext === "webp")
    return { fileName: "cover.webp", mediaType: "image/webp" };
  if (ext === "gif") return { fileName: "cover.gif", mediaType: "image/gif" };
  return null;
}

export function coverPageXhtml(
  language: string,
  title: string,
  fileName: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xmlText(language)}" lang="${xmlText(language)}">
<head>
  <meta charset="UTF-8"/>
  <title>${xmlText(title)}</title>
  <style>body { margin: 0; text-align: center; } img { max-width: 100%; max-height: 100%; }</style>
</head>
<body>
  <img src="${xmlText(fileName)}" alt="${xmlText(title)}"/>
</body>
</html>
`;
}
