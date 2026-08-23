/**
 * Trim inflected word forms to root word
 * reflected → reflect
 * cultivating → cultivate
 * tribulations → tribulation
 */

const SUFFIX_RULES = [
  // Verb inflections
  { suffix: 'ing', minLength: 5, add: '' },      // walking → walk
  { suffix: 'ed', minLength: 4, add: '' },       // reflected → reflect, talked → talk
  { suffix: 's', minLength: 4, add: '' },        // walks → walk
  { suffix: 'es', minLength: 5, add: '' },       // boxes → box
  
  // Noun/adjective inflections
  { suffix: 'ies', minLength: 5, add: 'y' },     // tribulations → tribulation (special case)
  { suffix: 'ness', minLength: 6, add: '' },     // darkness → dark
  { suffix: 'ment', minLength: 6, add: '' },     // refinement → refine
  { suffix: 'tion', minLength: 6, add: '' },     // reflection → reflect (approximate)
  { suffix: 'sion', minLength: 6, add: '' },     // dimension → dimen... (rough)
];

export function trimRootWord(word: string): string {
  const lower = word.toLowerCase();
  
  // Try each rule in order
  for (const rule of SUFFIX_RULES) {
    if (
      lower.length > rule.minLength &&
      lower.endsWith(rule.suffix)
    ) {
      // Remove suffix
      const trimmed = lower.slice(0, -rule.suffix.length);
      
      // Add back if needed (e.g., y for -ies → -y)
      if (rule.add) {
        return trimmed + rule.add;
      }
      
      return trimmed;
    }
  }
  
  // No rule matched, return original
  return lower;
}

/**
 * Get multiple search candidates (word + root forms)
 * reflected → [reflected, reflect]
 */
export function getSearchCandidates(word: string): string[] {
  const trimmed = trimRootWord(word);
  const candidates = new Set<string>();
  
  candidates.add(word.toLowerCase());
  if (trimmed !== word.toLowerCase()) {
    candidates.add(trimmed);
  }
  
  return Array.from(candidates);
}
