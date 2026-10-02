'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { handlesOf, type FlowNode } from '@wa/core/flow'
import { NODE_LABELS } from '@wa/core/flow'
import { cn } from '@/lib/utils'
import { useAiEndpoints } from './ai-context'

/**
 * Connection points. A handle nobody can find is a handle that does not
 * exist, so these are accent-ringed and grow on hover rather than blending
 * into the card the way a plain white dot did.
 */
const handleClass =
  '!size-3 !border-2 !border-accent !bg-surface transition-all hover:!size-4 hover:!bg-accent-bg'

/**
 * One node on the canvas.
 *
 * A buttons node renders one output handle per button, aligned with the button
 * it belongs to, so the branch you drag from is the branch you can see. That
 * alignment is the whole reason this is a custom node rather than a default
 * one with a single output.
 */
export function NodeCard({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FlowNode['data']
  const outputs = handlesOf({ id, type: nodeData.kind, position: { x: 0, y: 0 }, data: nodeData })
  const hasIssue = (data as { __issue?: 'error' | 'warning' }).__issue

  return (
    <div
      className={cn(
        'w-56 rounded-lg border bg-surface text-left shadow-xs',
        selected && 'ring-2 ring-accent',
        hasIssue === 'error' && 'border-danger',
        hasIssue === 'warning' && 'border-warn',
      )}
    >
      {nodeData.kind !== 'trigger' && (
        <Handle type="target" position={Position.Top} className={handleClass} />
      )}

      <div
        className={cn(
          'flex items-center gap-1.5 rounded-t-lg border-b px-2.5 py-1.5 text-[11px]',
          nodeData.kind === 'trigger' ? 'bg-accent-bg text-accent' : 'bg-muted text-fg-muted',
        )}
      >
        <span>{NODE_LABELS[nodeData.kind]}</span>
        {hasIssue === 'error' && <span className="ml-auto text-danger">!</span>}
        {hasIssue === 'warning' && <span className="ml-auto text-warn">!</span>}
      </div>

      <div className="px-2.5 py-2">
        <Summary data={nodeData} />
      </div>

      {outputs.length > 0 &&
        (outputs.length === 1 && outputs[0]!.id === null ? (
          <Handle type="source" position={Position.Bottom} className={handleClass} />
        ) : (
          <div className="border-t">
            {outputs.map((h, i) => (
              <div
                key={h.id}
                className="relative flex items-center justify-between px-2.5 py-1 text-[11px] text-fg-muted"
              >
                <span className="truncate">{h.label}</span>
                <Handle
                  id={h.id!}
                  type="source"
                  position={Position.Right}
                  style={{ top: '50%' }}
                  className={handleClass}
                />
                {i < outputs.length - 1 && (
                  <span className="absolute inset-x-2.5 bottom-0 border-b" />
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}

function Summary({ data }: { data: FlowNode['data'] }) {
  const text = (s: string) => (
    <p className="line-clamp-3 text-[12px] whitespace-pre-wrap text-fg">{s}</p>
  )
  const muted = (s: string) => <p className="text-[12px] text-fg-muted italic">{s}</p>

  switch (data.kind) {
    case 'trigger': {
      const values = data.values.filter(Boolean)
      if (data.match === 'newConversation') return muted('Percakapan baru')
      if (data.match === 'api') return muted('Dipicu lewat API')
      return values.length ? text(values.join(', ')) : muted('Belum ada kata kunci')
    }
    case 'sendText':
      return data.body ? text(data.body) : muted('Pesan kosong')
    case 'sendMedia':
      return data.value
        ? text(`${data.media}${data.caption ? ` — ${data.caption}` : ''}`)
        : muted(`${data.media}: belum ada sumber`)
    case 'sendButtons':
      return data.body ? text(data.body) : muted('Pesan kosong')
    case 'sendList':
      return data.body ? text(data.body) : muted('Pesan kosong')
    case 'sendTemplate':
      return data.templateName
        ? text(`${data.templateName} (${data.language})`)
        : muted('Template belum dipilih')
    case 'waitReply':
      return text(`Simpan ke {{${data.saveAs}}}`)
    case 'condition':
      return text(`{{${data.variable}}} ${OPERATORS[data.operator]} ${data.value}`)
    case 'setVariable':
      return text(`{{${data.name}}} = ${data.value}`)
    case 'httpRequest':
      return data.url
        ? text(`${data.method} ${data.url}\n→ {{${data.saveAs}}}`)
        : muted('URL belum diisi')
    case 'askAi':
      return <AskAiSummary data={data} />

    case 'delay':
      return text(humanSeconds(data.seconds))
    case 'assign':
      return muted(data.userId ? 'Tugaskan ke agen' : 'Tugaskan otomatis')
    case 'tag':
      return text(`${data.action === 'add' ? '+' : '−'} ${data.tags.join(', ')}`)
    case 'handover':
      return muted('Jeda bot, serahkan ke agen')
    case 'end':
      return muted(data.reason || 'Selesai')
  }
}

function AskAiSummary({ data }: { data: Extract<FlowNode['data'], { kind: 'askAi' }> }) {
  const ai = useAiEndpoints().find((a) => a.id === data.endpointId)
  return (
    <div className="space-y-0.5 text-[12px]">
      <p className={ai ? 'text-fg' : 'text-fg-muted italic'}>
        {ai ? ai.name : data.endpointId ? 'AI sudah dihapus' : 'AI belum dipilih'}
      </p>
      <p className="text-fg-muted">
        Tanya {`{{${data.question}}}`}
        {data.sendAnswer
          ? data.endButton.trim()
            ? `, jawaban dikirim + tombol "${data.endButton.trim()}"`
            : ', jawaban langsung dikirim'
          : `, simpan ke {{${data.saveAs}}}`}
      </p>
    </div>
  )
}

const OPERATORS: Record<string, string> = {
  eq: '=',
  neq: '≠',
  contains: 'memuat',
  startsWith: 'diawali',
  gt: '>',
  lt: '<',
  isSet: 'terisi',
  isEmpty: 'kosong',
}

export function humanSeconds(s: number) {
  if (s % 3600 === 0) return `Jeda ${s / 3600} jam`
  if (s % 60 === 0) return `Jeda ${s / 60} menit`
  return `Jeda ${s} detik`
}
