import { useState, useCallback } from "react";
import { SIMPLE_DICTIONARY, DictionaryEntry } from "@/constants/dictionary";

// Strips punctuation clinging to a tapped word (quotes, commas, em-dashes).
function cleanWord(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/^[^a-z']+|[^a-z']+$/g, "");
}

export function useDictionary() {
  const [word, setWord] = useState<string | null>(null);
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [notFound, setNotFound] = useState(false);

  const lookup = useCallback((raw: string) => {
    const clean = cleanWord(raw);
    if (clean.length < 2) return;

    const found = SIMPLE_DICTIONARY[clean];
    setWord(clean);

    if (found && found.length > 0) {
      setEntries(found);
      setNotFound(false);
    } else {
      setEntries([]);
      setNotFound(true);
    }
  }, []);

  const clear = useCallback(() => {
    setWord(null);
    setEntries([]);
    setNotFound(false);
  }, []);

  return {
    word,
    entries,
    notFound,
    isOpen: word !== null,
    lookup,
    clear,
  };
}
