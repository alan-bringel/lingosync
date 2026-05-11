const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "ave", "blvd",
  "etc", "vs", "dept", "est", "govt", "inc", "ltd", "co", "corp",
  "gen", "sgt", "capt", "lt", "col", "maj", "cpl", "pvt",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
  "sun", "mon", "tue", "wed", "thu", "fri", "sat",
  "v", "i.e", "e.g", "a.m", "p.m", "c.e", "b.c", "a.d",
  "ch", "vol", "no", "pp", "pg", "ex", "cf", "c", "ca",
  "approx", "dept", "ed", "eds", "fig", "al", "rev",
]);

const CLAUSE_CONNECTORS = [
  " and ", " but ", " or ", " nor ", " yet ", " so ", " for ",
  " because ", " although ", " though ", " whereas ", " while ",
  " since ", " unless ", " until ", " after ", " before ",
  " however ", " moreover ", " furthermore ", " nevertheless ",
  " therefore ", " consequently ", " accordingly ", " besides ",
  " indeed ", " instead ", " meanwhile ", " otherwise ",
  " thus ", " hence ", " nonetheless ", " additionally ",
  " in addition ", " on the other hand ", " as a result ",
  " in contrast ", " in other words ", " that is ", " for example ",
  " for instance ", " in fact ", " of course ", " at least ",
  " in particular ", " as well as ", " along with ", " together with ",
];

function isAbbreviation(word: string): boolean {
  const clean = word.toLowerCase().replace(/[^a-z.]/g, "");
  return ABBREVIATIONS.has(clean) || /^[a-z]\.$/i.test(clean);
}

function isAllCapsWord(word: string): boolean {
  return /^[A-Z]{2,}$/.test(word.replace(/[^A-Z]/g, ""));
}

export interface SplitSentence {
  text: string;
  startIndex: number;
  endIndex: number;
}

export function splitSentences(text: string): SplitSentence[] {
  const result: SplitSentence[] = [];
  const trimmed = text.trim();
  if (!trimmed) return result;

  const sentenceEnders = /[.!?]+/g;
  let match: RegExpExecArray | null;
  let lastEnd = 0;
  const matches: { index: number; length: number }[] = [];

  while ((match = sentenceEnders.exec(trimmed)) !== null) {
    const potentialEnd = match.index + match[0].length;

    const nextChars = trimmed.slice(potentialEnd, potentialEnd + 5);
    const precedingText = trimmed.slice(Math.max(0, potentialEnd - 10), potentialEnd);
    const precedingWords = precedingText.split(/\s+/).filter(Boolean);
    const lastWord = precedingWords[precedingWords.length - 1] || "";

    if (isAbbreviation(lastWord)) continue;

    const followingText = trimmed.slice(potentialEnd).trimStart();
    const followingWord = followingText.split(/\s+/)[0] || "";

    if (followingWord && /^[a-z]/.test(followingWord)) continue;

    if (isAllCapsWord(lastWord) && followingWord && /^[a-z]/.test(followingWord)) continue;

    matches.push({ index: potentialEnd, length: match[0].length });
  }

  if (matches.length === 0) {
    return [{ text: trimmed, startIndex: 0, endIndex: trimmed.length }];
  }

  let startIdx = 0;
  for (const m of matches) {
    const sentenceText = trimmed.slice(startIdx, m.index).trim();
    if (sentenceText) {
      result.push({
        text: sentenceText,
        startIndex: startIdx,
        endIndex: m.index,
      });
    }
    startIdx = m.index;
  }

  const remaining = trimmed.slice(startIdx).trim();
  if (remaining) {
    result.push({
      text: remaining,
      startIndex: startIdx,
      endIndex: trimmed.length,
    });
  }

  return result;
}

export interface SemanticSegment {
  text: string;
  words: string[];
}

export function splitIntoClauses(text: string): string[] {
  const sentences = splitSentences(text);
  const clauses: string[] = [];

  for (const sentence of sentences) {
    const parts = splitClauseAtConnectors(sentence.text);
    clauses.push(...parts);
  }

  return clauses.filter(c => c.trim().length > 0);
}

const SUBJECT_PRONOUNS = new Set([
  "i", "you", "he", "she", "it", "we", "they",
  "this", "that", "these", "those",
  "there",
]);

function splitClauseAtConnectors(text: string): string[] {
  const result: string[] = [];
  let remaining = text.trim();
  if (!remaining) return result;

  let bestIndex = -1;
  let bestConnector = "";

  for (const connector of CLAUSE_CONNECTORS) {
    const connectorTrimmed = connector.trim();
    const idx = remaining.indexOf(connector);

    if (idx > 0) {
      const precedingWord = remaining.slice(0, idx).trim().split(/\s+/).pop() || "";
      if (isAbbreviation(precedingWord)) continue;

      const wordsBefore = remaining.slice(0, idx).trim().split(/\s+/).length;
      const wordsAfter = remaining.slice(idx + connector.length).trim().split(/\s+/).length;

      if (wordsBefore >= 3 && wordsAfter >= 3) {
        const afterText = remaining.slice(idx + connector.length).trim();
        const firstWordAfter = afterText.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") || "";
        const hasExplicitSubject = SUBJECT_PRONOUNS.has(firstWordAfter);

        if (hasExplicitSubject) {
          bestIndex = idx;
          bestConnector = connector;
          break;
        }
      }
    }
  }

  if (bestIndex > 0) {
    const before = remaining.slice(0, bestIndex).trim();
    const after = remaining.slice(bestIndex + bestConnector.length).trim();
    result.push(before);
    result.push(bestConnector.trim() + " " + after);
  } else {
    result.push(remaining);
  }

  return result;
}

export function splitTextIntoSemanticSegments(
  text: string,
  maxWords: number = 20
): string[] {
  const sentences = splitSentences(text);
  const result: string[] = [];
  let clauseFragmentBuffer: string[] = [];

  for (const sentence of sentences) {
    const sentenceWordCount = sentence.text.split(/\s+/).filter(Boolean).length;

    if (sentenceWordCount > maxWords) {
      if (clauseFragmentBuffer.length > 0) {
        result.push(clauseFragmentBuffer.join(" "));
        clauseFragmentBuffer = [];
      }
      const clauses = splitClauseAtConnectors(sentence.text);
      if (clauses.length > 1) {
        let clauseBuffer: string[] = [];
        for (const clause of clauses) {
          const cwc = clause.split(/\s+/).filter(Boolean).length;
          if (clauseBuffer.length > 0) {
            const combined = [...clauseBuffer, clause].join(" ");
            if (combined.split(/\s+/).filter(Boolean).length <= maxWords) {
              clauseBuffer.push(clause);
            } else {
              result.push(clauseBuffer.join(" "));
              clauseBuffer = [clause];
            }
          } else {
            if (cwc <= maxWords) {
              clauseBuffer.push(clause);
            } else {
              result.push(clause);
            }
          }
        }
        if (clauseBuffer.length > 0) {
          result.push(clauseBuffer.join(" "));
        }
      } else {
        result.push(sentence.text);
      }
    } else {
      if (clauseFragmentBuffer.length > 0) {
        const combined = [...clauseFragmentBuffer, sentence.text].join(" ");
        if (combined.split(/\s+/).filter(Boolean).length <= maxWords) {
          clauseFragmentBuffer.push(sentence.text);
        } else {
          result.push(clauseFragmentBuffer.join(" "));
          clauseFragmentBuffer = [sentence.text];
        }
      } else {
        result.push(sentence.text);
      }
    }
  }

  if (clauseFragmentBuffer.length > 0) {
    result.push(clauseFragmentBuffer.join(" "));
  }

  return result.filter(s => s.split(/\s+/).filter(Boolean).length >= 1);
}

export function groupWordsBySemanticBoundaries(
  words: { text: string; start: number; end: number }[],
  text: string,
  maxWords: number = 15
): { text: string; start: number; end: number; words: { text: string; start: number; end: number }[] }[] {
  const segments = splitTextIntoSemanticSegments(text, maxWords);
  const result: { text: string; start: number; end: number; words: { text: string; start: number; end: number }[] }[] = [];

  let wordIndex = 0;
  for (const segmentText of segments) {
    const segmentWords = segmentText.split(/\s+/).filter(Boolean);
    const matchingWords: typeof words = [];

    for (let i = wordIndex; i < words.length && matchingWords.length < segmentWords.length; i++) {
      matchingWords.push(words[i]);
      wordIndex = i + 1;
    }

    if (matchingWords.length > 0) {
      result.push({
        text: segmentText,
        start: matchingWords[0].start,
        end: matchingWords[matchingWords.length - 1].end,
        words: matchingWords,
      });
    }
  }

  const remainingWords = words.slice(wordIndex);
  if (remainingWords.length > 0) {
    if (result.length > 0) {
      const last = result[result.length - 1];
      last.text = (last.text + " " + remainingWords.map(w => w.text).join(" ")).trim();
      last.end = remainingWords[remainingWords.length - 1].end;
      last.words = [...last.words, ...remainingWords];
    } else {
      result.push({
        text: remainingWords.map(w => w.text).join(" "),
        start: remainingWords[0].start,
        end: remainingWords[remainingWords.length - 1].end,
        words: remainingWords,
      });
    }
  }

  return result;
}
