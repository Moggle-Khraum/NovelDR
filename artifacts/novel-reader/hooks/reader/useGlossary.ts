import * as FileSystem from "expo-file-system";
import { useState, useCallback } from "react";

const GLOSSARY_DIR = `${FileSystem.documentDirectory}.library`;
const GLOSSARY_FILE = `${GLOSSARY_DIR}/user_glossary.json`;
const GLOSSARY_METADATA = `${GLOSSARY_DIR}/glossary_metadata.json`;

export interface GlossaryEntry {
  word: string;
  meaning: string;
  pos: string; // part of speech: noun, verb, adjective, etc.
  source: "user_added" | "online";
  added_at: number;
  tags?: string[]; // e.g., ['xianxia', 'cultivation']
  root_word?: string; // e.g., 'reflect' for 'reflected'
}

export interface GlossaryMetadata {
  total_entries: number;
  xianxia_terms: number;
  last_updated: number;
  version: number;
}

/**
 * Initialize glossary directories on first launch
 */
async function initializeGlossaryDirs() {
  try {
    await FileSystem.makeDirectoryAsync(GLOSSARY_DIR, { intermediates: true });
  } catch (error) {
    // Directory might already exist
    console.log("Glossary directory initialized");
  }
}

/**
 * Read entire glossary from FileSystem
 */
async function readGlossaryFile(): Promise<Record<string, GlossaryEntry>> {
  try {
    const content = await FileSystem.readAsStringAsync(GLOSSARY_FILE);
    return JSON.parse(content);
  } catch (error) {
    // File doesn't exist yet, return empty
    return {};
  }
}

/**
 * Write entire glossary to FileSystem
 */
async function writeGlossaryFile(glossary: Record<string, GlossaryEntry>) {
  await FileSystem.writeAsStringAsync(
    GLOSSARY_FILE,
    JSON.stringify(glossary, null, 2),
  );

  // Update metadata
  await updateMetadata(glossary);
}

/**
 * Update glossary metadata
 */
async function updateMetadata(glossary: Record<string, GlossaryEntry>) {
  const xianxiaCount = Object.values(glossary).filter((e) =>
    e.tags?.includes("xianxia"),
  ).length;

  const metadata: GlossaryMetadata = {
    total_entries: Object.keys(glossary).length,
    xianxia_terms: xianxiaCount,
    last_updated: Date.now(),
    version: 1,
  };

  await FileSystem.writeAsStringAsync(
    GLOSSARY_METADATA,
    JSON.stringify(metadata, null, 2),
  );
}

/**
 * Get metadata
 */
async function readMetadata(): Promise<GlossaryMetadata | null> {
  try {
    const content = await FileSystem.readAsStringAsync(GLOSSARY_METADATA);
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

export function useGlossary() {
  const [glossary, setGlossary] = useState<Record<string, GlossaryEntry>>({});
  const [metadata, setMetadata] = useState<GlossaryMetadata | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Load glossary from disk
   */
  const loadGlossary = useCallback(async () => {
    setLoading(true);
    try {
      await initializeGlossaryDirs();
      const data = await readGlossaryFile();
      const meta = await readMetadata();
      setGlossary(data);
      setMetadata(meta);
    } catch (error) {
      console.error("Error loading glossary:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Add entry to glossary
   */
  const addEntry = useCallback(
    async (entry: GlossaryEntry) => {
      try {
        const updated = { ...glossary };
        updated[entry.word.toLowerCase()] = {
          ...entry,
          added_at: entry.added_at || Date.now(),
        };

        setGlossary(updated);
        await writeGlossaryFile(updated);
      } catch (error) {
        console.error("Error adding to glossary:", error);
      }
    },
    [glossary],
  );

  /**
   * Remove entry from glossary
   */
  const removeEntry = useCallback(
    async (word: string) => {
      try {
        const updated = { ...glossary };
        delete updated[word.toLowerCase()];

        setGlossary(updated);
        await writeGlossaryFile(updated);
      } catch (error) {
        console.error("Error removing from glossary:", error);
      }
    },
    [glossary],
  );

  /**
   * Get entry by word
   */
  const getEntry = useCallback(
    (word: string) => {
      return glossary[word.toLowerCase()];
    },
    [glossary],
  );

  /**
   * Check if word exists in glossary
   */
  const hasEntry = useCallback(
    (word: string) => {
      return word.toLowerCase() in glossary;
    },
    [glossary],
  );

  /**
   * Get all entries (for browsing)
   */
  const getAllEntries = useCallback(() => {
    return Object.values(glossary);
  }, [glossary]);

  /**
   * Clear entire glossary (with confirmation)
   */
  const clearGlossary = useCallback(async () => {
    try {
      setGlossary({});
      await FileSystem.deleteAsync(GLOSSARY_FILE, { idempotent: true });
      await FileSystem.deleteAsync(GLOSSARY_METADATA, { idempotent: true });
    } catch (error) {
      console.error("Error clearing glossary:", error);
    }
  }, []);

  /**
   * Export glossary as JSON
   */
  const exportGlossary = useCallback(async () => {
    try {
      const content = JSON.stringify(glossary, null, 2);
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `user_glossary_${timestamp}.json`;

      // Save to Downloads or share
      const exportPath = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(exportPath, content);

      return exportPath;
    } catch (error) {
      console.error("Error exporting glossary:", error);
      return null;
    }
  }, [glossary]);

  return {
    glossary,
    metadata,
    loading,
    loadGlossary,
    addEntry,
    removeEntry,
    getEntry,
    hasEntry,
    getAllEntries,
    clearGlossary,
    exportGlossary,
  };
}
