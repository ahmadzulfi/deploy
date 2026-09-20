'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nanoid } from 'nanoid'
import { NODE_LABELS, validateFlow, type FlowGraph, type NodeKind } from '@wa/core/flow'
import { publishFlow, saveDraft } from '@/lib/actions/flows'
import { NodeCard } from './node-card'
import { Inspector } from './inspector'
import { PALETTE, defaultData } from './defaults'
import { cn } from '@/lib/utils'

const nodeTypes = { wa: NodeCard }

export function FlowEditor(props: { flowId: string; initial: FlowGraph; publishedVersion: number | null }) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

function Canvas({
  flowId,
  initial,
  publishedVersion,
}: {
  flowId: string
  initial: FlowGraph
  publishedVersion: number | null
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initial.nodes.map((n) => ({ id: n.id, type: 'wa', position: n.position, data: n.data as never })),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initial.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
    })),
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [save, setSave] = useState<{ at: string } | { failed: string } | null>(null)
  const [publishState, setPublishState] = useState<{ issues: string[] } | { version: number } | null>(null)
  const [publishing, startPublish] = useTransition()

  const { screenToFlowPosition } = useReactFlow()
  const wrapper = useRef<HTMLDivElement>(null)

  const graph: FlowGraph = useMemo(
    () => ({
      nodes: nodes.map((n) => ({
        id: n.id,
        type: (n.data as { kind: NodeKind }).kind,
        position: n.position,
        data: n.data as never,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
      })),
    }),
    [nodes, edges],
  )

  const issues = useMemo(() => validateFlow(graph), [graph])
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  // Autosave the draft, never the published version. Debounced so dragging a
  // node across the canvas does not fire a write per frame.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const t = setTimeout(async () => {
      const res = await saveDraft(flowId, graph)
      // A failed autosave must not look like an unsaved draft - that is how
      // work gets lost silently.
      setSave(
        'savedAt' in res
          ? { at: new Date(res.savedAt).toLocaleTimeString('id-ID') }
          : { failed: res.error },
      )
    }, 900)
    return () => clearTimeout(t)
  }, [graph, flowId])

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: nanoid(8) }, eds)),
    [setEdges],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const kind = event.dataTransfer.getData('application/wa-node') as NodeKind
      if (!kind) return

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const id = nanoid(8)
      setNodes((ns) => [...ns, { id, type: 'wa', position, data: defaultData(kind) as never }])
      setSelectedId(id)
    },
    [screenToFlowPosition, setNodes],
  )

  const updateNode = useCallback(
    (id: string, data: unknown) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: data as never } : n)))
    },
    [setNodes],
  )

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id))
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
      setSelectedId(null)
    },
    [setNodes, setEdges],
  )

  // Paint the issue marker onto each node so problems are visible on the
  // canvas, not only in the panel below it.
  const decorated = useMemo(() => {
    const worst = new Map<string, 'error' | 'warning'>()
    for (const i of issues) {
      if (!i.nodeId) continue
      if (i.severity === 'error' || !worst.has(i.nodeId)) worst.set(i.nodeId, i.severity)
    }
    return nodes.map((n) =>
      worst.has(n.id) ? { ...n, data: { ...n.data, __issue: worst.get(n.id) } } : n,
    )
  }, [nodes, issues])

  const selected = nodes.find((n) => n.id === selectedId) ?? null

  return (
    <div className="flex h-full">
      <aside className="w-40 shrink-0 overflow-y-auto border-r bg-surface p-2">
        {PALETTE.map(({ group, kinds }) => (
          <div key={group} className="mb-3">
            <div className="mb-1 px-1 text-[10px] text-fg-muted">{group}</div>
            {kinds.map((kind) => (
              <div
                key={kind}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/wa-node', kind)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                className="mb-1 cursor-grab rounded-md border bg-surface px-2 py-1.5 text-[12px] text-fg active:cursor-grabbing hover:bg-muted"
              >
                {NODE_LABELS[kind]}
              </div>
            ))}
          </div>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b bg-surface px-3">
          <span className={cn('text-[11px]', save && 'failed' in save ? 'text-danger' : 'text-fg-muted')}>
            {save && 'failed' in save
              ? `Gagal menyimpan: ${save.failed}`
              : save
                ? `Tersimpan ${save.at}`
                : 'Draf'}
            {publishedVersion !== null && ` · live v${publishedVersion}`}
          </span>

          <div className="ml-auto flex items-center gap-2 text-[11px]">
            {errors.length > 0 && <span className="text-danger">{errors.length} error</span>}
            {warnings.length > 0 && <span className="text-warn">{warnings.length} peringatan</span>}
            <button
              disabled={publishing || errors.length > 0}
              title={errors.length > 0 ? 'Perbaiki error dulu' : 'Simpan versi baru dan jadikan live'}
              onClick={() =>
                startPublish(async () => {
                  await saveDraft(flowId, graph)
                  const res = await publishFlow(flowId)
                  setPublishState(res.ok ? { version: res.version } : { issues: res.issues })
                })
              }
              className="h-7 rounded-md bg-fg px-2.5 text-white hover:opacity-90 disabled:opacity-40"
            >
              {publishing ? 'Menerbitkan…' : 'Terbitkan'}
            </button>
          </div>
        </div>

        <div ref={wrapper} className="min-h-0 flex-1" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <ReactFlow
            nodes={decorated}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            fitView
            defaultEdgeOptions={{ animated: false, style: { strokeWidth: 1.5 } }}
          >
            {nodes.length > 1 && edges.length === 0 && (
              <Panel position="top-center">
                <p className="rounded-md border bg-surface px-3 py-1.5 text-[11px] text-fg-muted shadow-xs">
                  Tarik dari titik biru di tepi node ke tepi atas node tujuan untuk
                  menghubungkannya.
                </p>
              </Panel>
            )}
            <Background gap={16} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-muted" />
          </ReactFlow>
        </div>

        {(issues.length > 0 || publishState) && (
          <div className="max-h-32 shrink-0 overflow-y-auto border-t bg-surface px-3 py-2">
            {publishState && 'version' in publishState && (
              <p className="text-[11px] text-ok">Terbit sebagai v{publishState.version}.</p>
            )}
            {issues.map((i, idx) => (
              <p
                key={idx}
                onClick={() => i.nodeId && setSelectedId(i.nodeId)}
                className={cn(
                  'cursor-pointer text-[11px] hover:underline',
                  i.severity === 'error' ? 'text-danger' : 'text-warn',
                )}
              >
                {i.message}
              </p>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <Inspector
          key={selected.id}
          nodeId={selected.id}
          data={selected.data as never}
          onChange={(d) => updateNode(selected.id, d)}
          onDelete={() => deleteNode(selected.id)}
        />
      )}
    </div>
  )
}
