/** `value` as one shell word, quoted only when it needs to be. */
export const shellArg = (value: string) =>
  /^[\w@%+=:,./~-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`
