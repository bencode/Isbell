// How a document reads: its theme, text size, width and typeface. Pure, so the settings store can
// use it without bringing in the renderer.

export type ReadingTheme = 'auto' | 'light' | 'paper' | 'dark'

export type ReadingAppearance = {
  /** 'auto' follows the app's own theme. */
  theme: ReadingTheme
  fontSize: number
  /** 'focused' keeps prose in a column; code, tables and diagrams may still run wider. */
  width: 'focused' | 'full'
  font: 'sans' | 'serif'
}

export const READING_THEMES: readonly ReadingTheme[] = ['auto', 'light', 'paper', 'dark']
export const FONT_SIZE = { min: 12, max: 20 }

export const DEFAULT_APPEARANCE: ReadingAppearance = {
  theme: 'auto',
  fontSize: 16,
  width: 'focused',
  font: 'sans',
}

const oneOf = <T extends string>(values: readonly T[], value: unknown, fallback: T): T =>
  values.find(v => v === value) ?? fallback

/** Saved settings field by field: each one that is not valid takes its default. */
export function readingAppearance(
  saved: Partial<Record<keyof ReadingAppearance, unknown>>,
): ReadingAppearance {
  const size = saved.fontSize
  return {
    theme: oneOf(READING_THEMES, saved.theme, DEFAULT_APPEARANCE.theme),
    fontSize:
      typeof size === 'number' && Number.isFinite(size)
        ? Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, Math.round(size)))
        : DEFAULT_APPEARANCE.fontSize,
    width: oneOf(['focused', 'full'], saved.width, DEFAULT_APPEARANCE.width),
    font: oneOf(['sans', 'serif'], saved.font, DEFAULT_APPEARANCE.font),
  }
}

// Paper: warm light tokens, after Gamma Reader's #f3ead2 / #302b26.
const PAPER = {
  '--bg': '#f3ead2',
  '--raised': '#f8f1de',
  '--raised-2': '#eadfc3',
  '--line': '#ddcfa9',
  '--line-strong': '#c9b98f',
  '--text': '#302b26',
  '--muted': '#5b5246',
  '--faint': '#6b6152',
}

/** The inline style that puts an element and what is in it in `theme`. Every app token is
 * light-dark(), so a color-scheme flips them all; paper also sets its own. */
export const themeStyle = (theme: ReadingTheme): Record<string, string> =>
  theme === 'auto' ? {} : theme === 'paper' ? { colorScheme: 'light', ...PAPER } : { colorScheme: theme }
