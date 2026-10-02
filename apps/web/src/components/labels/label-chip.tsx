import { isLabelColor, type LabelColor } from '@wa/core/labels'
import { cn } from '@/lib/utils'

export interface LabelView {
  id: string
  name: string
  color: string
}

// Whole class names, so Tailwind finds them when it scans this file.
const CHIP: Record<LabelColor, string> = {
  gray: 'bg-label-gray-bg text-label-gray',
  blue: 'bg-label-blue-bg text-label-blue',
  teal: 'bg-label-teal-bg text-label-teal',
  green: 'bg-label-green-bg text-label-green',
  yellow: 'bg-label-yellow-bg text-label-yellow',
  orange: 'bg-label-orange-bg text-label-orange',
  red: 'bg-label-red-bg text-label-red',
  purple: 'bg-label-purple-bg text-label-purple',
}

const DOT: Record<LabelColor, string> = {
  gray: 'bg-label-gray',
  blue: 'bg-label-blue',
  teal: 'bg-label-teal',
  green: 'bg-label-green',
  yellow: 'bg-label-yellow',
  orange: 'bg-label-orange',
  red: 'bg-label-red',
  purple: 'bg-label-purple',
}

/** A colour read from the database, falling back to gray for anything unknown. */
export function colorOf(color: string): LabelColor {
  return isLabelColor(color) ? color : 'gray'
}

export function LabelChip({ name, color, small, className }: { name: string; color: string; small?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center truncate rounded-full font-medium',
        small ? 'px-1.5 text-[10px] leading-4' : 'px-2 py-0.5 text-[11px]',
        CHIP[colorOf(color)],
        className,
      )}
      title={name}
    >
      <span className="truncate">{name}</span>
    </span>
  )
}

export function LabelDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-full', DOT[colorOf(color)], className)} />
}
