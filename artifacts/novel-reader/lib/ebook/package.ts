// Packages a file set (from epub.ts or docx.ts) into a ZIP archive.
//
// Uses JSZip, a pure JavaScript library, so it needs no native module and works
// in Expo managed builds. Output is base64, which expo-file-system writes as
// binary.

import JSZip from "jszip";

export async function zipToBase64(
  files: Record<string, string>,
  mimeType: string,
): Promise<string> {
  const zip = new JSZip();

  // Insertion order is archive order. Object keys keep their insertion order.
  for (const [path, text] of Object.entries(files)) {
    if (path === "mimetype") {
      // EPUB requires "mimetype" to be the first entry and stored uncompressed.
      zip.file(path, text, { compression: "STORE", createFolders: false });
    } else {
      zip.file(path, text, { compression: "DEFLATE", createFolders: false });
    }
  }

  return zip.generateAsync({
    type: "base64",
    mimeType,
    compression: "DEFLATE",
  });
}
