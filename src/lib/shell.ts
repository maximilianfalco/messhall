/** Joins argv into one shell line, single quoting any arg that is not a plain word. */
export function shellLine(argv: string[]) {
  return argv.map(arg => (/^[\w./:=@-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`)).join(' ');
}
