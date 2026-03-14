// Chunking module for memory_import
// 3 strategies: paragraph (default), fixed, markdown
// All use generator functions for memory efficiency

export type ChunkStrategy = 'paragraph' | 'fixed' | 'markdown';

export interface ChunkOptions {
  strategy?: ChunkStrategy;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface Chunk {
  index: number;
  text: string;
  heading?: string;
}

const DEFAULT_CHUNK_SIZE = 1500;
const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * Main entry point — returns generator of chunks
 */
export function* chunkText(
  text: string,
  options: ChunkOptions = {}
): Generator<Chunk> {
  const {
    strategy = 'paragraph',
    chunkSize = DEFAULT_CHUNK_SIZE,
    chunkOverlap = DEFAULT_CHUNK_OVERLAP,
  } = options;

  switch (strategy) {
    case 'paragraph':
      yield* chunkByParagraph(text, chunkSize);
      break;
    case 'fixed':
      yield* chunkByFixed(text, chunkSize, chunkOverlap);
      break;
    case 'markdown':
      yield* chunkByMarkdown(text, chunkSize);
      break;
    default:
      yield* chunkByParagraph(text, chunkSize);
  }
}

/**
 * Paragraph strategy: split by \n\n, merge small paragraphs, split large ones by sentences
 */
function* chunkByParagraph(text: string, chunkSize: number): Generator<Chunk> {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  let buffer = '';
  let index = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();

    // If paragraph alone exceeds chunkSize — split by sentences
    if (trimmed.length > chunkSize) {
      // Flush buffer first
      if (buffer.trim().length > 0) {
        yield { index: index++, text: buffer.trim() };
        buffer = '';
      }
      // Split large paragraph by sentences
      yield* splitBySentences(trimmed, chunkSize, index);
      index += Math.ceil(trimmed.length / chunkSize);
      continue;
    }

    // Try to merge with buffer
    const merged = buffer.length > 0 ? buffer + '\n\n' + trimmed : trimmed;
    if (merged.length <= chunkSize) {
      buffer = merged;
    } else {
      // Flush buffer, start new one
      if (buffer.trim().length > 0) {
        yield { index: index++, text: buffer.trim() };
      }
      buffer = trimmed;
    }
  }

  // Flush remaining
  if (buffer.trim().length > 0) {
    yield { index: index++, text: buffer.trim() };
  }
}

/**
 * Fixed strategy: sliding window with overlap, respects sentence boundaries
 */
function* chunkByFixed(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): Generator<Chunk> {
  if (text.length <= chunkSize) {
    yield { index: 0, text: text.trim() };
    return;
  }

  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Try to extend/shrink to sentence boundary
    if (end < text.length) {
      const sentenceEnd = findSentenceBoundary(text, start + Math.floor(chunkSize * 0.8), end + 100);
      if (sentenceEnd > start) {
        end = sentenceEnd;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      yield { index: index++, text: chunk };
    }

    // Move window forward
    const step = end - start - chunkOverlap;
    start += Math.max(step, Math.floor(chunkSize / 4)); // Ensure progress

    if (start >= text.length) break;
  }
}

/**
 * Markdown strategy: split by headings, apply paragraph chunking within large sections
 */
function* chunkByMarkdown(text: string, chunkSize: number): Generator<Chunk> {
  // Split by headings (# ## ###)
  const sections = splitByHeadings(text);
  let index = 0;

  for (const section of sections) {
    const { heading, body } = section;

    if (body.trim().length === 0) continue;

    // If section fits in one chunk
    const fullText = heading ? `${heading}\n\n${body}` : body;
    if (fullText.length <= chunkSize) {
      yield { index: index++, text: fullText.trim(), heading: heading || undefined };
      continue;
    }

    // Section too large — sub-chunk with paragraph strategy, prepend heading
    const subChunks = chunkByParagraph(body, chunkSize - (heading ? heading.length + 4 : 0));
    for (const sub of subChunks) {
      const prefixed = heading ? `${heading}\n\n${sub.text}` : sub.text;
      yield { index: index++, text: prefixed.trim(), heading: heading || undefined };
    }
  }
}

// --- Helpers ---

function* splitBySentences(text: string, chunkSize: number, startIndex: number): Generator<Chunk> {
  // Split by sentence-ending punctuation followed by space or end
  const sentences = text.match(/[^.!?]*[.!?]+[\s]?|[^.!?]+$/g) || [text];
  let buffer = '';
  let index = startIndex;

  for (const sentence of sentences) {
    const merged = buffer + sentence;
    if (merged.length <= chunkSize) {
      buffer = merged;
    } else {
      if (buffer.trim().length > 0) {
        yield { index: index++, text: buffer.trim() };
      }
      // If single sentence exceeds chunkSize — force-split
      if (sentence.length > chunkSize) {
        for (let i = 0; i < sentence.length; i += chunkSize) {
          const piece = sentence.slice(i, i + chunkSize).trim();
          if (piece.length > 0) {
            yield { index: index++, text: piece };
          }
        }
        buffer = '';
      } else {
        buffer = sentence;
      }
    }
  }

  if (buffer.trim().length > 0) {
    yield { index: index++, text: buffer.trim() };
  }
}

function findSentenceBoundary(text: string, searchStart: number, searchEnd: number): number {
  const clampedEnd = Math.min(searchEnd, text.length);
  const segment = text.slice(searchStart, clampedEnd);

  // Look for sentence-ending punctuation followed by whitespace
  const matches = [...segment.matchAll(/[.!?]\s/g)];
  if (matches.length > 0) {
    const lastMatch = matches[matches.length - 1];
    return searchStart + lastMatch.index! + 2; // After the punctuation + space
  }

  // Fallback: look for newline
  const newline = segment.lastIndexOf('\n');
  if (newline > 0) {
    return searchStart + newline + 1;
  }

  return 0; // No good boundary found
}

interface MarkdownSection {
  heading: string | null;
  body: string;
}

function splitByHeadings(text: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  // Match lines starting with 1-3 # followed by space
  const headingRegex = /^(#{1,3}\s+.+)$/gm;
  let lastIndex = 0;
  let lastHeading: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(text)) !== null) {
    // Everything before this heading belongs to previous section
    const body = text.slice(lastIndex, match.index);
    if (lastIndex > 0 || body.trim().length > 0) {
      sections.push({ heading: lastHeading, body: body.trim() });
    }
    lastHeading = match[1];
    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  const remaining = text.slice(lastIndex);
  if (remaining.trim().length > 0 || lastHeading) {
    sections.push({ heading: lastHeading, body: remaining.trim() });
  }

  return sections;
}
