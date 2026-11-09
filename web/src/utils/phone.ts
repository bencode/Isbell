/** A phone gets its own shell, decided once at load; by the shorter side, so landscape counts too. */
export const PHONE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600
