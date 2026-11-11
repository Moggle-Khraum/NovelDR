// Packages a file set into a ZIP archive. Binary entries are supplied as
// base64; text entries remain UTF-8. Object insertion order preserves EPUB's
// required first "mimetype" entry, which is stored without compression.

import JSZip from "jszip";

export async function zipFilesToBase64(
  files: Record<string, string>,
  mimeType: string,
  binaryPaths: Set<string> = new Set(),
): Promise<string> {
  const zip = new JSZip();

  for (const [path, content] of Object.entries(files)) {
    const options = {
      compression: path === "mimetype" ? "STORE" as const : "DEFLATE" as const,
      createFolders: false,
    };
    if (binaryPaths.has(path)) {
      zip.file(path, content, { ...options, base64: true });
    } else {
      zip.file(path, content, options);
    }
  }

  return zip.generateAsync({
    type: "base64",
    mimeType,
    compression: "DEFLATE",
  });
}

export async function zipToBase64(
  files: Record<string, string>,
  mimeType: string,
): Promise<string> {
  return zipFilesToBase64(files, mimeType);
}
