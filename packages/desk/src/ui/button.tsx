import type { ButtonHTMLAttributes } from 'react'

export type Variant = 'default' | 'primary' | 'quiet' | 'end' | 'danger'

const BASE =
  'inline-flex items-center gap-2 whitespace-nowrap rounded-lg border text-[13px] font-semibold no-underline cursor-pointer disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const VARIANTS: Record<Variant, string> = {
  default: 'border-line bg-raised text-text hover:enabled:bg-raised-2',
  primary: 'border-accent bg-accent text-accent-ink hover:enabled:brightness-110',
  quiet: 'border-transparent bg-transparent text-muted hover:enabled:bg-raised hover:enabled:text-text',
  // Ends something on a machine: always red-outlined and always confirmed.
  end: 'border-end-line bg-transparent text-danger hover:enabled:bg-end',
  danger: 'border-danger bg-danger text-accent-ink hover:enabled:brightness-110',
}

export type Size = 'text' | 'small' | 'icon'

// Size owns height and padding, so callers never pass classes that fight these.
const SIZES: Record<Size, string> = {
  text: 'h-[34px] px-3.5',
  small: 'h-7 px-3',
  icon: 'h-[34px] w-[34px] justify-center',
}

/** Classes for anything that should look like a button, such as a router link. */
export const buttonClass = (variant: Variant = 'default', extra = '', size: Size = 'text') =>
  `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${extra}`

export function Button({
  variant = 'default',
  size = 'text',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, className, size)} {...props} />
}
