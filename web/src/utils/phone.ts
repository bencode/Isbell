/** A finger, not a mouse: a phone, or a tablet in the desktop shell. */
export const COARSE = matchMedia('(pointer: coarse)').matches

/** A phone gets its own shell, decided once at load; by the shorter side, so landscape counts too. */
export const PHONE = COARSE && Math.min(screen.width, screen.height) < 600
