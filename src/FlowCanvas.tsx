import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import CardDiscuss from './CardDiscuss.tsx'
import { cardFace, laterLayers, layerLabel, type CanvasEdge, type CanvasNode, type Card } from './document.ts'

type DiscussBind = {
  cardBody: string
  onClose: () => void
  onCommitBody: (cardId: string, body: string) => Promise<void>
}

type CardData = {
  layerLabel: string
  color: string
  canGrow: boolean
  flash: boolean
  discuss: DiscussBind | null
  title: string
  body: string
  meta: string
}
type GroupData = { text: string }

function DiscussDock({ cardId, bind }: { cardId: string; bind: DiscussBind }) {
  const dockRef = useRef<HTMLDivElement>(null)
  const { getViewport, setViewport } = useReactFlow()
  const flowRef = useRef({ getViewport, setViewport })
  flowRef.current = { getViewport, setViewport }
  const [dir, setDir] = useState<'down' | 'up' | 'clamp'>('down')
  const [maxH, setMaxH] = useState<number | null>(null)
  const [clampTop, setClampTop] = useState<number | null>(null)
  const panned = useRef(false)

  useLayoutEffect(() => {
    panned.current = false
    const dock = dockRef.current
    if (!dock) return
    let dead = false
    const place = () => {
      if (dead) return
      const node = dock.closest('.react-flow__node')
      if (!(node instanceof HTMLElement)) return
      const vh = window.innerHeight
      const margin = 8
      const gap = 8
      const desired = 460
      const card = node.getBoundingClientRect()
      if (card.width < 1 || card.height < 1) return
      const spaceBelow = vh - card.bottom - gap
      const spaceAbove = card.top - gap
      const zoom = flowRef.current.getViewport().zoom || 1
      let nextDir: 'down' | 'up' | 'clamp' = 'down'
      let nextMax: number | null = null
      let nextTop: number | null = null
      if (spaceBelow >= desired) {
        nextDir = 'down'
      } else if (spaceAbove >= desired) {
        nextDir = 'up'
      } else if (spaceBelow >= spaceAbove && spaceBelow >= 220) {
        nextDir = 'down'
        nextMax = Math.floor(spaceBelow)
      } else if (spaceAbove >= 220) {
        nextDir = 'up'
        nextMax = Math.floor(spaceAbove)
      } else {
        const height = Math.min(desired, Math.max(180, vh - margin * 2))
        let screenTop = card.bottom + gap
        if (screenTop + height > vh - margin) screenTop = vh - margin - height
        if (screenTop < margin) screenTop = margin
        nextDir = 'clamp'
        nextMax = Math.floor(height)
        nextTop = (screenTop - card.top) / zoom
      }
      setDir((prev) => (prev === nextDir ? prev : nextDir))
      setMaxH((prev) => (prev === nextMax ? prev : nextMax))
      setClampTop((prev) => (prev === nextTop ? prev : nextTop))
    }
    // 父级把卡片平移写进页面之后再量，避免用摆正前的位置决定展开方向。
    queueMicrotask(place)
    const frame = window.requestAnimationFrame(() => place())
    window.addEventListener('resize', place)
    return () => {
      dead = true
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', place)
    }
  }, [cardId])

  useLayoutEffect(() => {
    if (panned.current) return
    if (dir !== 'clamp' && maxH == null) return
    const dock = dockRef.current
    if (!dock) return
    const button = dock.querySelector<HTMLElement>('.discuss-compose-bar button')
    if (!button) return
    const rect = button.getBoundingClientRect()
    const vh = window.innerHeight
    const margin = 8
    const tooLow = rect.bottom > vh - margin + 1
    const tooHigh = rect.top < margin - 1
    if (!tooLow && !tooHigh) return
    const { getViewport: readViewport, setViewport: moveViewport } = flowRef.current
    const zoom = readViewport().zoom || 1
    const vp = readViewport()
    let shift = 0
    if (tooLow) shift -= rect.bottom - (vh - margin)
    if (rect.top + shift < margin) shift += margin - (rect.top + shift)
    if (Math.abs(shift) < 1) return
    panned.current = true
    void moveViewport({ x: vp.x, y: vp.y + shift / zoom, zoom: vp.zoom })
  }, [dir, maxH, clampTop])

  const style: CSSProperties & Record<string, string | number> = {}
  if (dir === 'clamp' && clampTop != null) {
    style.top = clampTop
    style.bottom = 'auto'
  }
  if (maxH != null) style['--discuss-max'] = `${maxH}px`
  const className = [
    'discuss-dock nodrag nopan nowheel',
    dir === 'up' ? 'discuss-up' : '',
    dir === 'clamp' ? 'discuss-clamp' : '',
    maxH != null ? 'discuss-fit' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div ref={dockRef} className={className} style={style} data-discuss-dock="">
      <CardDiscuss cardId={cardId} cardBody={bind.cardBody} onClose={bind.onClose} onCommitBody={bind.onCommitBody} />
    </div>
  )
}

function SnowCard({ id, data }: NodeProps<Node<CardData, 'snowCard'>>) {
  const title = data.title.trim()
  const body = data.body.trim()
  return (
    <div className="snow-node">
      <div className={data.flash ? 'snow-card adopt-flash' : 'snow-card'} data-color={data.color}>
        <div className="snow-kicker">
          <div className="snow-layer">{data.layerLabel}</div>
          {data.meta ? <div className="snow-meta">{data.meta}</div> : null}
        </div>
        <div className="snow-copy">
          <div className="snow-title">{title || '还没有写下内容'}</div>
          {body ? <div className="snow-body">{body}</div> : null}
        </div>
        <Handle type="target" position={Position.Left} />
        {data.canGrow ? <Handle type="source" position={Position.Right} /> : null}
      </div>
      {data.discuss ? <DiscussDock cardId={id} bind={data.discuss} /> : null}
    </div>
  )
}

function SnowGroup({ data }: NodeProps<Node<GroupData, 'snowGroup'>>) {
  return <div className="snow-group">{data.text || '分组'}</div>
}

const nodeTypes = { snowCard: SnowCard, snowGroup: SnowGroup }

function toFlowNode(
  node: CanvasNode,
  card: Card | undefined,
  activeId: string | null,
  discuss: { cardId: string; bind: DiscussBind } | null,
  flashId: string | null,
): Node {
  if (node.type === 'group') {
    return {
      id: node.id,
      type: 'snowGroup',
      position: { x: node.x, y: node.y },
      width: node.width,
      height: node.height,
      selected: node.id === activeId,
      zIndex: 0,
      data: { text: node.text ?? '分组' },
      style: { width: node.width, height: node.height },
    }
  }
  const face = card ? cardFace(card) : { title: node.text ?? '', body: '', meta: '' }
  const tall = face.body.trim().length > 0 || face.title.trim().length > 18
  const height = Math.max(node.height, tall ? 176 : node.height)
  return {
    id: node.id,
    type: 'snowCard',
    position: { x: node.x, y: node.y },
    width: node.width,
    height,
    selected: node.id === activeId,
    zIndex: discuss?.cardId === node.id ? 20 : 1,
    data: {
      layerLabel: card ? layerLabel(card.layer) : '',
      color: node.color ?? '1',
      canGrow: card ? laterLayers(card.layer).length > 0 : false,
      flash: flashId === node.id,
      discuss: discuss?.cardId === node.id ? discuss.bind : null,
      title: face.title,
      body: face.body,
      meta: face.meta,
    },
    style: { width: node.width, height },
  }
}

export default function FlowCanvas({
  nodes,
  edges,
  cards,
  activeId,
  onMove,
  onSelect,
  onSpawn,
  onLink,
  onCreateAt,
  onOpenDiscuss,
  discussCardId,
  flashCardId,
  onCloseDiscuss,
  onCommitBody,
}: {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  cards: Record<string, Card>
  activeId: string | null
  onMove: (id: string, x: number, y: number) => void
  onSelect: (id: string) => void
  onSpawn: (fromId: string, x: number, y: number) => void
  onLink: (fromId: string, toId: string) => void
  onCreateAt: (x: number, y: number) => void
  onOpenDiscuss: (cardId: string) => void
  discussCardId: string | null
  flashCardId: string | null
  onCloseDiscuss: () => void
  onCommitBody: (cardId: string, body: string) => Promise<void>
}) {
  const { screenToFlowPosition, fitView } = useReactFlow()
  const lastPaneClick = useRef(0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.isComposing) return
      const active = document.activeElement
      if (!(active instanceof Element)) return
      if (active.closest('.discuss-dock, [data-discuss-popover]')) return
      if (!active.classList.contains('react-flow__node-snowCard')) return
      const id = active.getAttribute('data-id')
      if (!id) return
      event.preventDefault()
      onOpenDiscuss(id)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onOpenDiscuss])

  const discuss =
    discussCardId && cards[discussCardId]
      ? {
          cardId: discussCardId,
          bind: { cardBody: cards[discussCardId].body, onClose: onCloseDiscuss, onCommitBody },
        }
      : null
  const flowNodes = nodes.map((node) => toFlowNode(node, cards[node.id], activeId, discuss, flashCardId))
  const flowEdges = edges.map((edge) => ({
    id: edge.id,
    source: edge.fromNode,
    target: edge.toNode,
    label: edge.label,
  }))

  const onNodesChange = (changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        onMove(change.id, change.position.x, change.position.y)
      }
    }
  }

  const focusActive = () => {
    if (!activeId) return
    const ids = new Set<string>([activeId])
    for (const edge of edges) {
      if (edge.fromNode === activeId) ids.add(edge.toNode)
      if (edge.toNode === activeId) ids.add(edge.fromNode)
    }
    void fitView({
      nodes: [...ids].map((id) => ({ id })),
      padding: 0.3,
      duration: 200,
    })
  }

  return (
    <div className="canvas-wrap">
      <ReactFlow
        onPaneClick={(event) => {
          const now = Date.now()
          const repeated = now - lastPaneClick.current < 450
          lastPaneClick.current = event.detail >= 2 ? 0 : now
          if (event.detail < 2 && !repeated) return
          const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
          onCreateAt(pos.x, pos.y)
        }}
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onSelect(node.id)}
        onNodeDoubleClick={(event, node) => {
          if (node.type !== 'snowCard') return
          const target = 'target' in event && event.target instanceof Element ? event.target : null
          if (target?.closest('[data-discuss-popover]')) return
          event.preventDefault()
          onOpenDiscuss(node.id)
        }}
        onConnect={(connection) => {
          if (!connection.source || !connection.target) return
          onLink(connection.source, connection.target)
        }}
        onConnectEnd={(event, connectionState) => {
          if (!connectionState.fromNode || connectionState.isValid) return
          let clientX = 0
          let clientY = 0
          if ('changedTouches' in event && event.changedTouches.length > 0) {
            clientX = event.changedTouches[0].clientX
            clientY = event.changedTouches[0].clientY
          } else if ('clientX' in event) {
            clientX = event.clientX
            clientY = event.clientY
          }
          const pos = screenToFlowPosition({ x: clientX, y: clientY })
          onSpawn(connectionState.fromNode.id, pos.x, pos.y)
        }}
        deleteKeyCode={null}
        edgesReconnectable={false}
        onlyRenderVisibleElements={false}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        fitView={false}
        proOptions={{ hideAttribution: false }}
      >
        <Background />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <div className="canvas-tools">
            <button type="button" onClick={() => void fitView({ padding: 0.2, duration: 200 })}>
              看全稿
            </button>
            <button type="button" onClick={focusActive} disabled={!activeId}>
              聚焦这张
            </button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}
