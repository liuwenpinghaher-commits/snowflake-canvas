import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  getViewportForBounds,
  useReactFlow,
  useStore,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import { estimateSnowCardHeight, shiftOverlappingCards, snowBodyOverflows, type ShiftBox } from './card-layout.ts'
import { cardFace, laterLayers, layerLabel, type CanvasEdge, type CanvasNode, type Card } from './document.ts'

type CardData = {
  layerLabel: string
  color: string
  canGrow: boolean
  flash: boolean
  conflict: boolean
  title: string
  body: string
  meta: string
  width: number
  expanded: boolean
  boxHeight: number
  onHeight: (id: string, height: number) => void
  onToggleExpand: (id: string) => void
}
type GroupData = { text: string; conflict: boolean }

function SnowCard({ id, data }: NodeProps<Node<CardData, 'snowCard'>>) {
  const cardRef = useRef<HTMLDivElement>(null)
  const title = data.title.trim()
  const body = data.body.trim()
  const overflows = snowBodyOverflows(body, data.width)
  const expanded = data.expanded && overflows
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const report = () => {
      const measured = Math.round(el.offsetHeight)
      if (!Number.isFinite(measured) || measured < 1) return
      const next = Math.abs(measured - data.boxHeight) <= 1 ? data.boxHeight : measured
      data.onHeight(id, next)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [id, data.body, data.boxHeight, data.expanded, data.layerLabel, data.meta, data.onHeight, data.title, data.width])
  return (
    <div className="snow-node">
      <div
        ref={cardRef}
        className={['snow-card', data.flash ? 'adopt-flash' : '', data.conflict ? 'is-conflict' : ''].filter(Boolean).join(' ')}
        data-color={data.color}
      >
        {data.conflict ? <div className="conflict-badge">待选</div> : null}
        <div className="snow-kicker">
          <div className="snow-layer">{data.layerLabel}</div>
          {data.meta ? <div className="snow-meta">{data.meta}</div> : null}
        </div>
        <div className="snow-copy">
          <div className="snow-title">{title || '还没有写下内容'}</div>
          {body ? <div className={overflows && !expanded ? 'snow-body is-collapsed' : 'snow-body'}>{body}</div> : null}
        </div>
        {overflows ? (
          <button
            type="button"
            className="snow-expand nodrag nopan nowheel"
            aria-expanded={expanded}
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onMouseDown={(event) => {
              event.stopPropagation()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              data.onToggleExpand(id)
            }}
            onDoubleClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            {expanded ? '收起' : '展开全文'}
          </button>
        ) : null}
        <Handle type="target" position={Position.Left} />
        {data.canGrow ? <Handle type="source" position={Position.Right} /> : null}
      </div>
    </div>
  )
}

function SnowGroup({ data }: NodeProps<Node<GroupData, 'snowGroup'>>) {
  return (
    <div className={data.conflict ? 'snow-group is-conflict' : 'snow-group'}>
      {data.conflict ? <div className="conflict-badge">待选</div> : null}
      {data.text || '分组'}
    </div>
  )
}

const nodeTypes = { snowCard: SnowCard, snowGroup: SnowGroup }

function toFlowNode(
  node: CanvasNode,
  card: Card | undefined,
  activeId: string | null,
  flashId: string | null,
  conflict: boolean,
  measured: number | undefined,
  expanded: boolean,
  onHeight: (id: string, height: number) => void,
  onToggleExpand: (id: string) => void,
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
      data: { text: node.text ?? '分组', conflict },
      style: { width: node.width, height: node.height },
    }
  }
  const face = card ? cardFace(card) : { title: node.text ?? '', body: '', meta: '' }
  const estimated = estimateSnowCardHeight({
    title: face.title,
    body: face.body,
    meta: face.meta,
    width: node.width,
    expanded,
  })
  const height = measured ?? estimated
  return {
    id: node.id,
    type: 'snowCard',
    position: { x: node.x, y: node.y },
    width: node.width,
    height,
    selected: node.id === activeId,
    zIndex: 1,
    data: {
      layerLabel: card ? layerLabel(card.layer) : '',
      color: node.color ?? '1',
      canGrow: card ? laterLayers(card.layer).length > 0 : false,
      flash: flashId === node.id,
      conflict,
      title: face.title,
      body: face.body,
      meta: face.meta,
      width: node.width,
      expanded,
      boxHeight: height,
      onHeight,
      onToggleExpand,
    },
    style: { width: node.width, height },
  }
}

export default function FlowCanvas({
  nodes,
  edges,
  cards,
  activeId,
  conflictIds,
  canEdit,
  onMove,
  onShift,
  onSelect,
  onSpawn,
  onLink,
  onCreateAt,
  flashCardId,
}: {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  cards: Record<string, Card>
  activeId: string | null
  conflictIds?: ReadonlySet<string>
  canEdit: boolean
  onMove: (id: string, x: number, y: number) => void
  onShift: (moves: { id: string; x: number; y: number }[]) => void
  onSelect: (id: string) => void
  onSpawn: (fromId: string, x: number, y: number) => void
  onLink: (fromId: string, toId: string) => void
  onCreateAt: (x: number, y: number) => void
  flashCardId: string | null
}) {
  const { screenToFlowPosition, fitView, getNodesBounds, setViewport } = useReactFlow()
  const lastPaneClick = useRef(0)
  const flowCount = useStore((state) => state.nodeLookup.size)
  const paneWidth = useStore((state) => state.width)
  const paneHeight = useStore((state) => state.height)
  const fittedOnce = useRef(false)

  // 打开页面、画布拿到卡片后看一次全稿；之后打字、拖动都不再自动缩放。
  // 受控节点下 fitView 和 nodesInitialized 都要等下一次节点变化才更新，页面静止时不会触发，
  // 所以按卡片自带的宽高算外框，直接设视口。
  const nodesReady = flowCount > 0 && flowCount >= nodes.length
  useEffect(() => {
    if (fittedOnce.current || !nodesReady || nodes.length === 0 || paneWidth < 1 || paneHeight < 1) return
    fittedOnce.current = true
    const bounds = getNodesBounds(nodes.map((node) => node.id))
    void setViewport(getViewportForBounds(bounds, paneWidth, paneHeight, 0.1, 1, 0.2))
  }, [nodesReady, nodes, paneWidth, paneHeight, getNodesBounds, setViewport])

  const [heights, setHeights] = useState<Record<string, number>>({})
  // 展开记在本页内存里，按卡片 id。换选中的卡不会把已经展开的收回。刷新后回到全部收起。
  const [expandedIds, setExpandedIds] = useState<Record<string, true>>({})
  const toggleExpanded = useCallback((cardId: string) => {
    setExpandedIds((current) => {
      if (current[cardId]) {
        const next = { ...current }
        delete next[cardId]
        return next
      }
      return { ...current, [cardId]: true }
    })
  }, [])
  const heightsRef = useRef(heights)
  heightsRef.current = heights
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit
  const onShiftRef = useRef(onShift)
  onShiftRef.current = onShift
  const dragRef = useRef<string | null>(null)
  const pendingShift = useRef(false)
  const settledRef = useRef<Record<string, number>>({})
  const yRef = useRef<Record<string, number>>({})
  const seenY = useRef<Record<string, number>>({})
  const shiftQueue = useRef<Promise<void>>(Promise.resolve())

  for (const node of nodes) {
    const seen = seenY.current[node.id]
    if (seen !== node.y) {
      if (seen != null && yRef.current[node.id] !== node.y) yRef.current[node.id] = node.y
      seenY.current[node.id] = node.y
    }
  }

  const onHeight = useCallback((id: string, height: number) => {
    const rounded = Math.round(height)
    if (!Number.isFinite(rounded) || rounded < 1) return
    setHeights((current) => {
      const prev = current[id]
      if (prev != null && Math.abs(prev - rounded) < 2) return current
      if (prev === rounded) return current
      return { ...current, [id]: rounded }
    })
  }, [])

  const resolveOverlaps = useCallback((overrides?: Record<string, { x: number; y: number }>) => {
    if (dragRef.current) {
      pendingShift.current = true
      return
    }
    const currentNodes = nodesRef.current
    const measured = heightsRef.current
    let heightChanged = pendingShift.current
    const boxes: ShiftBox[] = []
    for (const node of currentNodes) {
      const at = overrides?.[node.id]
      const x = at?.x ?? node.x
      const y = at?.y ?? yRef.current[node.id] ?? node.y
      if (node.type === 'group') {
        boxes.push({
          id: node.id,
          x,
          y,
          width: node.width,
          height: node.height,
          prevHeight: node.height,
          kind: 'group',
        })
        continue
      }
      const height = measured[node.id] ?? node.height
      const prev = settledRef.current[node.id] ?? node.height
      if (measured[node.id] != null && measured[node.id] !== prev) heightChanged = true
      boxes.push({ id: node.id, x, y, width: node.width, height, prevHeight: prev, kind: 'card' })
    }
    if (!heightChanged) return
    const moves = shiftOverlappingCards(boxes, null)
    if (moves.length > 0 && !canEditRef.current) {
      pendingShift.current = true
      return
    }
    pendingShift.current = false
    const nextSettled = { ...settledRef.current }
    for (const node of currentNodes) {
      if (node.type !== 'group' && measured[node.id] != null) nextSettled[node.id] = measured[node.id]
    }
    settledRef.current = nextSettled
    if (moves.length === 0) return
    for (const move of moves) yRef.current[move.id] = move.y
    shiftQueue.current = shiftQueue.current
      .then(() => onShiftRef.current(moves))
      .then(
        () => undefined,
        () => undefined,
      )
  }, [])

  useLayoutEffect(() => {
    resolveOverlaps()
  }, [heights, canEdit, resolveOverlaps])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.isComposing) return
      const active = document.activeElement
      if (!(active instanceof Element)) return
      if (active.closest('.discuss-dock, [data-discuss-popover], .side')) return
      if (!active.classList.contains('react-flow__node-snowCard')) return
      const id = active.getAttribute('data-id')
      if (!id) return
      event.preventDefault()
      onSelect(id)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onSelect])

  const [dragged, setDragged] = useState<Record<string, { x: number; y: number }>>({})
  const draggedRef = useRef(dragged)
  draggedRef.current = dragged
  const flowNodes = nodes.map((node) => {
    const measured = node.type === 'group' ? undefined : heights[node.id]
    const flow = toFlowNode(
      node,
      cards[node.id],
      activeId,
      flashCardId,
      conflictIds?.has(node.id) ?? false,
      measured,
      expandedIds[node.id] === true,
      onHeight,
      toggleExpanded,
    )
    const held = dragged[node.id]
    return held ? { ...flow, position: held } : flow
  })
  const flowEdges = edges.map((edge) => ({
    id: edge.id,
    source: edge.fromNode,
    target: edge.toNode,
    label: edge.label,
  }))

  // 拖动途中只挪页面上的位置；松手那一次（dragging 为 false）才写进画布。
  // 松手之后才按新高度解决重叠，拖的那张在拖动过程中不被下移打断。
  const onNodesChange = (changes: NodeChange[]) => {
    const moving: Record<string, { x: number; y: number }> = {}
    const released: { id: string; x: number; y: number }[] = []
    let draggingNow: string | null = null
    for (const change of changes) {
      if (change.type !== 'position') continue
      if (change.dragging) {
        draggingNow = change.id
        if (change.position) moving[change.id] = { x: change.position.x, y: change.position.y }
        continue
      }
      const at = change.position ?? draggedRef.current[change.id]
      if (at) released.push({ id: change.id, x: at.x, y: at.y })
    }
    if (draggingNow) dragRef.current = draggingNow
    const done = new Set(released.map((item) => item.id))
    if (Object.keys(moving).length > 0 || done.size > 0) {
      const next = { ...draggedRef.current, ...moving }
      for (const id of done) delete next[id]
      draggedRef.current = next
      setDragged(next)
    }
    for (const item of released) onMove(item.id, item.x, item.y)
    if (draggingNow) return
    if (released.length === 0 && dragRef.current == null) return
    dragRef.current = null
    if (!pendingShift.current) return
    const overrides: Record<string, { x: number; y: number }> = {}
    for (const item of released) {
      overrides[item.id] = { x: item.x, y: item.y }
      yRef.current[item.id] = item.y
    }
    resolveOverlaps(overrides)
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
          event.preventDefault()
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
