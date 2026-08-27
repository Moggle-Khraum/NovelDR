import { useCallback, useEffect, useRef, useState } from "react";
import * as FileSystem from "expo-file-system";
import { DictionaryEntry } from "@/constants/dictionary";

export interface SavedDictionaryEntry extends DictionaryEntry {
  source: "saved";
  added_at: number;
}

const SAVED_DICT_PATH = `${FileSystem.documentDirectory}noveldr_saved_dictionary.json`;

export function useSavedDictionary() {
  const [entries, setEntries] = useState<Record<string, SavedDictionaryEntry>>(
    {},
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  /**
   * Load saved dictionary from JSON file
   */
  const loadSavedDictionary = useCallback(async () => {
    if (loadPromiseRef.current) {
      return loadPromiseRef.current;
    }

    loadPromiseRef.current = (async () => {
      try {
        const fileInfo = await FileSystem.getInfoAsync(SAVED_DICT_PATH);

        if (fileInfo.exists) {
          const content = await FileSystem.readAsStringAsync(SAVED_DICT_PATH);
          const parsed = JSON.parse(content) as Record<
            string,
            SavedDictionaryEntry
          >;
          setEntries(parsed);
          console.log(
            `✓ Loaded ${Object.keys(parsed).length} saved dictionary entries`,
          );
        } else {
          console.log("ℹ️  No saved dictionary file found, starting fresh");
          setEntries({});
        }

        setIsLoaded(true);
      } catch (error) {
        console.error("Error loading saved dictionary:", error);
        setEntries({});
        setIsLoaded(true);
      }
    })();

    await loadPromiseRef.current;
  }, []);

  /**
   * Save dictionary to JSON file
   */
  const saveToDisk = useCallback(
    async (data: Record<string, SavedDictionaryEntry>) => {
      try {
        await FileSystem.writeAsStringAsync(
          SAVED_DICT_PATH,
          JSON.stringify(data, null, 2),
        );
        console.log("✓ Saved dictionary persisted to JSON");
      } catch (error) {
        console.error("Error saving dictionary to disk:", error);
        throw error;
      }
    },
    [],
  );

  /**
   * Add or update a dictionary entry
   */
  const addEntry = useCallback(
    async (entry: SavedDictionaryEntry) => {
      const normalized = entry.word.toLowerCase().trim();

      const updated = {
        ...entries,
        [normalized]: {
          ...entry,
          word: normalized,
          source: "saved" as const,
          added_at: entry.added_at || Date.now(),
        },
      };

      setEntries(updated);
      await saveToDisk(updated);
      console.log(`✓ Added/updated dictionary entry: ${normalized}`);
    },
    [entries, saveToDisk],
  );

  /**
   * Search in saved dictionary
   */
  const search = useCallback(
    (query: string): SavedDictionaryEntry | null => {
      const normalized = query.toLowerCase().trim();
      return entries[normalized] || null;
    },
    [entries],
  );

  /**
   * Get all entries
   */
  const getAllEntries = useCallback((): SavedDictionaryEntry[] => {
    return Object.values(entries);
  }, [entries]);

  /**
   * Remove an entry
   */
  const removeEntry = useCallback(
    async (word: string) => {
      const normalized = word.toLowerCase().trim();
      const updated = { ...entries };
      delete updated[normalized];

      setEntries(updated);
      await saveToDisk(updated);
      console.log(`✓ Removed dictionary entry: ${normalized}`);
    },
    [entries, saveToDisk],
  );

  /**
   * Clear all saved entries (keep built-in dictionary)
   */
  const clearAll = useCallback(async () => {
    setEntries({});
    await saveToDisk({});
    console.log("✓ Cleared all saved dictionary entries");
  }, [saveToDisk]);

  /**
   * Merge with another dictionary (for importing)
   */
  const mergeEntries = useCallback(
    async (newEntries: Record<string, SavedDictionaryEntry>) => {
      const merged = { ...entries, ...newEntries };
      setEntries(merged);
      await saveToDisk(merged);
      console.log(
        `✓ Merged ${Object.keys(newEntries).length} entries into dictionary`,
      );
    },
    [entries, saveToDisk],
  );

  /**
   * Auto-load on mount
   */
  useEffect(() => {
    loadSavedDictionary();
  }, [loadSavedDictionary]);

  return {
    // State
    entries,
    isLoaded,

    // Methods
    loadSavedDictionary,
    addEntry,
    search,
    getAllEntries,
    removeEntry,
    clearAll,
    mergeEntries,
  };
}
