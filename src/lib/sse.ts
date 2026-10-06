/** One server-sent event with all three fields. */
export interface Frame {
  data: string;
  event: string;
  id: string;
}

function parseFrame(block: string) {
  const fields = new Map(
    block
      .split('\n')
      .filter(line => !line.startsWith(':'))
      .map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)] as const),
  );
  const { data, event, id } = Object.fromEntries(fields);
  return data && event && id ? { data, event, id } : undefined;
}

/** Yields each full frame off an SSE body. Pings and frames missing a field are skipped. */
export async function* readFrames(body: AsyncIterable<Uint8Array>) {
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const frame = parseFrame(block);
      if (frame) yield frame satisfies Frame;
    }
  }
}
