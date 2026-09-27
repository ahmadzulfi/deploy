'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface TrendSeries {
  key: string
  label: string
  /** A CSS color token, e.g. var(--color-series-1). */
  color: string
  values: number[]
}

const PLOT_H = 220
const AXIS_H = 24
const PAD_TOP = 12
const PAD_LEFT = 40
/** Room for the direct labels at the line ends. */
const PAD_RIGHT = 108

const fmt = new Intl.NumberFormat('id-ID')

/** Clean axis steps: 0 / 5 / 10 / 20 / 50 / 100 … */
function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const top = Math.ceil(max / step) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
}

function dayLabel(key: string, long = false) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    ...(long ? { weekday: 'long' } : {}),
    timeZone: 'UTC',
  })
}

export function TrendChart({ title, days, series }: { title: string; days: string[]; series: TrendSeries[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [active, setActive] = useState<number | null>(null)
  const [table, setTable] = useState(false)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e!.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const ticks = niceTicks(Math.max(0, ...series.flatMap((s) => s.values)))
  const top = ticks[ticks.length - 1]!
  const plotW = width - PAD_LEFT - PAD_RIGHT
  const x = (i: number) => PAD_LEFT + (days.length === 1 ? plotW / 2 : (i / (days.length - 1)) * plotW)
  const y = (v: number) => PAD_TOP + PLOT_H - (v / top) * PLOT_H

  // Few enough date labels that they never collide.
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotW / 72))))

  const onPointer = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect()
    const px = clientX - rect.left - PAD_LEFT
    const i = Math.round((px / plotW) * (days.length - 1))
    setActive(Math.min(days.length - 1, Math.max(0, i)))
  }

  const last = days.length - 1
  // Direct end labels, nudged apart only if they would overlap.
  const ends = series
    .map((s) => ({ s, y: y(s.values[last] ?? 0) }))
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 16) ends[i]!.y = ends[i - 1]!.y + 16

  return (
    // min-w-0: as a grid item the figure would otherwise grow to fit the SVG,
    // and the observer below would then measure that stretched width.
    <figure className="min-w-0 rounded-xl border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-sm text-fg">{title}</figcaption>
        <div className="flex items-center gap-4">
          {/* Legend: always present for two or more series. */}
          <ul className="flex gap-3 text-[11px] text-fg-muted">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                {s.label}
              </li>
            ))}
          </ul>
          <button
            onClick={() => setTable(!table)}
            className="rounded-md border px-2 py-0.5 text-[11px] text-fg-muted hover:bg-muted hover:text-fg"
            aria-pressed={table}
          >
            {table ? 'Grafik' : 'Tabel'}
          </button>
        </div>
      </div>

      {table ? (
        <div className="max-h-[260px] overflow-auto">
          <table className="w-full text-[12px] tabular-nums">
            <thead className="sticky top-0 bg-surface text-left text-[11px] text-fg-muted">
              <tr>
                <th className="py-1 font-normal">Tanggal</th>
                {series.map((s) => (
                  <th key={s.key} className="py-1 text-right font-normal">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d} className="border-t">
                  <td className="py-1 text-fg-muted">{dayLabel(d)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1 text-right text-fg">
                      {fmt.format(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={wrap}
          className="relative w-full min-w-0 overflow-hidden"
          onPointerMove={(e) => onPointer(e.clientX)}
          onPointerLeave={() => setActive(null)}
        >
          <svg
            width={width}
            height={PAD_TOP + PLOT_H + AXIS_H}
            role="img"
            aria-label={`${title}. Tekan panah kiri atau kanan untuk membaca per hari.`}
            tabIndex={0}
            className="block outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onFocus={() => setActive((a) => a ?? last)}
            onBlur={() => setActive(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? last) - 1))
              if (e.key === 'ArrowRight') setActive((a) => Math.min(last, (a ?? last) + 1))
            }}
          >
            {/* Hairline gridlines and tick values: recessive, solid. */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD_LEFT}
                  x2={PAD_LEFT + plotW}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 ? 'var(--color-axis)' : 'var(--color-grid)'}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text x={PAD_LEFT - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-muted text-[10px] tabular-nums">
                  {fmt.format(t)}
                </text>
              </g>
            ))}

            {days.map((d, i) =>
              // The last day is always labelled; a regular label too close to it is dropped
              // rather than printed on top of it.
              i === last || (i % labelEvery === 0 && last - i >= labelEvery) ? (
                <text key={d} x={x(i)} y={PAD_TOP + PLOT_H + 16} textAnchor="middle" className="fill-fg-muted text-[10px]">
                  {dayLabel(d)}
                </text>
              ) : null,
            )}

            {active !== null && (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD_TOP}
                y2={PAD_TOP + PLOT_H}
                stroke="var(--color-axis)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            )}

            {series.map((s) => (
              <path
                key={s.key}
                d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {/* End dots with a 2px surface ring, and the hovered day's dots. */}
            {series.map((s) =>
              [last, ...(active !== null && active !== last ? [active] : [])].map((i) => (
                <circle
                  key={`${s.key}-${i}`}
                  cx={x(i)}
                  cy={y(s.values[i] ?? 0)}
                  r={4}
                  fill={s.color}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              )),
            )}

            {ends.map(({ s, y: ly }) => (
              <text key={s.key} x={x(last) + 10} y={ly} dy="0.32em" className="text-[11px]">
                <tspan className="fill-fg font-medium">{fmt.format(s.values[last] ?? 0)}</tspan>
                <tspan className="fill-fg-muted"> {s.label.toLowerCase()}</tspan>
              </text>
            ))}
          </svg>

          {active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border bg-surface px-3 py-2 shadow-sm"
              style={{
                left: Math.min(x(active) + 12, width - 160),
              }}
            >
              <div className="mb-1 text-[10px] text-fg-muted">{dayLabel(days[active]!, true)}</div>
              {series.map((s) => (
                <div key={s.key} className="flex items-center gap-2 text-[12px]">
                  <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="font-semibold text-fg tabular-nums">{fmt.format(s.values[active] ?? 0)}</span>
                  <span className="text-fg-muted">{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  )
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 96
  const h = 28
  const max = Math.max(1, ...values)
  const px = (i: number) => (values.length === 1 ? w / 2 : 2 + (i / (values.length - 1)) * (w - 6))
  const py = (v: number) => h - 3 - (v / max) * (h - 8)
  const last = values.length - 1
  return (
    <svg width={w} height={h} aria-hidden className={cn('block', className)}>
      <path
        d={values.map((v, i) => `${i ? 'L' : 'M'}${px(i)},${py(v)}`).join('')}
        fill="none"
        stroke="var(--color-axis)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={px(last)} cy={py(values[last] ?? 0)} r={3} fill="var(--color-series-1)" stroke="var(--color-surface)" strokeWidth={1.5} />
    </svg>
  )
}
