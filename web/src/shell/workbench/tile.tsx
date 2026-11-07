// A project's mark: two letters on a color its name always gets.

const TILES = ['#7a4b6e', '#8a4a3f', '#3f6f73', '#6a5a8c', '#8a5568', '#6b6259', '#57607a', '#5a6b4a']

const tileColor = (name: string) =>
  TILES[[...name].reduce((h, c) => (h * 41 + (c.codePointAt(0) ?? 0)) % 100003, 5381) % TILES.length]

/** The first letters of a name's first two words, or its first two letters when it is one word. */
export function shortName(name: string) {
  const [first, second] = name.split(/[-_ .]|(?<=[a-z])(?=[A-Z])/).filter(Boolean)
  return first && second ? `${first[0]}${second[0]}`.toUpperCase() : name.slice(0, 2)
}

export const ProjectTile = ({ name, dim }: { name: string; dim: boolean }) => (
  <span
    style={{ background: tileColor(name) }}
    className={`grid size-6 flex-none place-items-center rounded-md text-[11px] leading-none font-semibold text-white ${dim ? 'opacity-60 saturate-[.25]' : ''}`}
  >
    {shortName(name)}
  </span>
)
