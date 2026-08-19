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
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [notFound, setNotFound] = useState(false);

  const lookup = useCallback((raw: string) => {
    const clean = cleanWord(raw);
    if (clean.length < 2) return;

    const found = SIMPLE_DICTIONARY[clean];
    setWord(clean);

    if (found) {
      setEntry(found);
      setNotFound(false);
    } else {
      setEntry(null);
      setNotFound(true);
    }
  }, []);

  const clear = useCallback(() => {
    setWord(null);
    setEntry(null);
    setNotFound(false);
  }, []);

  return {
    word,
    definition: entry?.meaning ?? null,
    partOfSpeech: entry?.pos ?? null,
    notFound,
    isOpen: word !== null,
    lookup,
    clear,
  };
}
