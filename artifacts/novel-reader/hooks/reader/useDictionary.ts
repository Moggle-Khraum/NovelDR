import { useState, useCallback, useEffect } from "react";
import { SIMPLE_DICTIONARY, DictionaryEntry } from "@/constants/dictionary";
import { getSearchCandidates, trimRootWord } from "@/lib/trimRootWord";
import { useGlossary } from "./useGlossary";
import { useNetInfo } from "@react-native-community/netinfo";

const WIKTIONARY_API = "https://en.wiktionary.org/api/rest_v1/page/definition";
const FREE_DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en";
const FETCH_TIMEOUT = 5000;

// Strips punctuation clinging to a tapped word (quotes, commas, em-dashes).
function cleanWord(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/^[^a-z']+|[^a-z']+$/g, "");
}

export interface OnlineDefinition {
  meaning: string;
  pos: string;
  source: "online" | "glossary";
}

async function fetchWiktionaryDefinition(
  word: string,
): Promise<OnlineDefinition | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(
      `${WIKTIONARY_API}/${encodeURIComponent(word)}`,
      { signal: controller.signal },
    );

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = await response.json();
    const definitions = data[word.toLowerCase()]?.[0]?.definitions ?? [];

    if (definitions.length === 0) return null;

    return {
      meaning: definitions.map((d: any) => d.definition).join("; "),
      pos: definitions[0]?.partOfSpeech ?? "unknown",
      source: "online",
    };
  } catch (error) {
    console.log("Wiktionary fetch failed:", error);
    return null;
  }
}

async function fetchFreeDefinition(
  word: string,
): Promise<OnlineDefinition | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(
      `${FREE_DICT_API}/${encodeURIComponent(word)}`,
      { signal: controller.signal },
    );

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = await response.json();
    const first = data[0];

    if (!first?.meanings?.[0]) return null;

    return {
      meaning: first.meanings[0].definitions[0]?.definition ?? "",
      pos: first.meanings[0].partOfSpeech ?? "unknown",
      source: "online",
    };
  } catch (error) {
    console.log("Free Dictionary fetch failed:", error);
    return null;
  }
}

export function useDictionary() {
  const [word, setWord] = useState<string | null>(null);
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [onlineEntry, setOnlineEntry] = useState<OnlineDefinition | null>(null);
  const [fetching, setFetching] = useState(false);
  const isConnected = useNetInfo().isConnected;
  const { getEntry: getGlossaryEntry, addEntry: addToGlossary } = useGlossary();

  const lookup = useCallback(
    (raw: string) => {
      const clean = cleanWord(raw);
      if (clean.length < 2) return;

      const candidates = getSearchCandidates(clean);

      // 1. Check offline dictionary
      for (const candidate of candidates) {
        const found =
          SIMPLE_DICTIONARY[candidate as keyof typeof SIMPLE_DICTIONARY];
        if (found && found.length > 0) {
          setWord(clean);
          setEntries(found);
          setNotFound(false);
          setOnlineEntry(null);
          return;
        }
      }

      // 2. Check glossary
      const glossaryEntry = getGlossaryEntry(clean);
      if (glossaryEntry) {
        setWord(clean);
        setEntries([]);
        setNotFound(false);
        setOnlineEntry({
          meaning: glossaryEntry.meaning,
          pos: glossaryEntry.pos,
          source: "glossary",
        });
        return;
      }

      // 3. Not found - show empty state ready for online fetch
      setWord(clean);
      setEntries([]);
      setNotFound(true);
      setOnlineEntry(null);
    },
    [getGlossaryEntry],
  );

  /**
   * Fetch online definition and auto-save to glossary
   */
  const fetchOnline = useCallback(async () => {
    if (!word || !isConnected) return;

    setFetching(true);

    try {
      const candidates = getSearchCandidates(word);
      let result = null;

      // Try Wiktionary first
      for (const candidate of candidates) {
        result = await fetchWiktionaryDefinition(candidate);
        if (result) break;
      }

      // Fallback to Free Dictionary
      if (!result) {
        for (const candidate of candidates) {
          result = await fetchFreeDefinition(candidate);
          if (result) break;
        }
      }

      if (result) {
        // Auto-save to glossary
        await addToGlossary({
          word,
          meaning: result.meaning,
          pos: result.pos,
          source: "online",
          added_at: Date.now(),
          root_word: trimRootWord(word),
          tags: [], // Can be enhanced later
        });

        setOnlineEntry(result);
        setNotFound(false);
      } else {
        setNotFound(true);
      }
    } catch (error) {
      console.error("Fetch error:", error);
      setNotFound(true);
    } finally {
      setFetching(false);
    }
  }, [word, isConnected, addToGlossary]);

  const clear = useCallback(() => {
    setWord(null);
    setEntries([]);
    setNotFound(false);
    setOnlineEntry(null);
    setFetching(false);
  }, []);

  return {
    word,
    entries,
    notFound,
    isOpen: word !== null,
    onlineEntry,
    fetching,
    isConnected,
    lookup,
    fetchOnline,
    clear,
  };
}
