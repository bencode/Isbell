// A machine's name over what the right column lists of it: one that folds them away, saying while
// they are how many ask.

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useI18n } from '../../core/i18n'

type Heading = { name: string; count: number; asking: number; open: boolean; onToggle?: () => void }

export function MachineHeading({ name, count, asking, open, onToggle }: Heading) {
  const t = useI18n()
  const inner = (
    <>
      {onToggle ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
      <span className="min-w-0 truncate">{name}</span>
      <span className="font-mono font-medium">{count}</span>
      {!open && asking ? <span className="text-warn">{t('active.asking', { n: asking })}</span> : null}
    </>
  )
  const look = 'flex h-6 min-w-0 flex-none items-center gap-1 px-1 text-[11.5px] font-semibold text-faint'
  return onToggle ? (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={`${look} cursor-pointer rounded-md border-0 bg-transparent text-left hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent`}
    >
      {inner}
    </button>
  ) : (
    <h3 className={`${look} m-0`}>{inner}</h3>
  )
}
