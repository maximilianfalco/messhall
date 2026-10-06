const isHeader = (line: string) => line.trimStart().startsWith('[');

// Subtables like [mcp_servers.messhall.tools.post] belong to the block, so a replace drops them too.
const inBlock = (line: string, header: string) =>
  line.trim() === header || line.trim().startsWith(`${header.slice(0, -1)}.`);

/** Where the table named by `header` sits in `text`, as line indexes, or null when it is not there. */
function findBlock({ header, lines }: { header: string; lines: string[] }) {
  const start = lines.findIndex(line => line.trim() === header);
  if (start === -1) return null;
  const next = lines.findIndex((line, at) => at > start && isHeader(line) && !inBlock(line, header));
  let end = next === -1 ? lines.length : next;
  while (end > start + 1 && lines[end - 1]!.trim() === '') end -= 1;
  return { end, start };
}

const headerOf = (block: string) => block.split('\n')[0]!;

/** The block in `text` that starts with the same header as `block`, or null. */
export function readBlock({ block, text }: { block: string; text: string }) {
  const lines = text.split('\n');
  const found = findBlock({ header: headerOf(block), lines });
  return found ? lines.slice(found.start, found.end).join('\n') : null;
}

/** `text` with `block` in place of the old one, or appended after a blank line when there is none. */
export function withBlock({ block, text }: { block: string; text: string }) {
  const lines = text.split('\n');
  const found = findBlock({ header: headerOf(block), lines });
  if (found) return [...lines.slice(0, found.start), block, ...lines.slice(found.end)].join('\n');
  const body = text.trimEnd();
  return body ? `${body}\n\n${block}\n` : `${block}\n`;
}

/** `text` without the table named by `header` and the blank lines before it. */
export function withoutBlock({ header, text }: { header: string; text: string }) {
  const lines = text.split('\n');
  const found = findBlock({ header, lines });
  if (!found) return text;
  let start = found.start;
  while (start > 0 && lines[start - 1]!.trim() === '') start -= 1;
  return [...lines.slice(0, start), ...lines.slice(found.end)].join('\n');
}
