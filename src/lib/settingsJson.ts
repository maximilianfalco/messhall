type Settings = Record<string, unknown>;

const isObject = (value: unknown): value is Settings =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const serversOf = (settings: Settings) => (isObject(settings.mcpServers) ? settings.mcpServers : {});

const render = (settings: Settings) => `${JSON.stringify(settings, null, 2)}\n`;

/** The settings object in `text`, `{}` for an empty file, or null when it is not a plain JSON object.
 * JSON with comments is null too, since a rewrite would drop them. */
export function parseSettings(text: string) {
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  if (parsed.mcpServers !== undefined && !isObject(parsed.mcpServers)) return null;
  return parsed;
}

/** The `mcpServers` entry named `name`, or undefined. */
export function readServer({ name, settings }: { name: string; settings: Settings }) {
  return serversOf(settings)[name];
}

/** The settings text with `entry` as the `mcpServers` entry named `name`. */
export function withServer({ entry, name, settings }: { entry: unknown; name: string; settings: Settings }) {
  return render({ ...settings, mcpServers: { ...serversOf(settings), [name]: entry } });
}

/** The settings text without the `mcpServers` entry named `name`. */
export function withoutServer({ name, settings }: { name: string; settings: Settings }) {
  const servers = Object.fromEntries(Object.entries(serversOf(settings)).filter(([key]) => key !== name));
  return render({ ...settings, mcpServers: servers });
}
