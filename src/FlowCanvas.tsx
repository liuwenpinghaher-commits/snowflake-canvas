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
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import { estimateSnowCardHeight, shiftOverlappingCards, type ShiftBox } from './card-layout.ts'
import {
  bodyTextForCard,
  cardFace,
  cardFootnotes,
  laterLayers,
  layerLabel,
  premiseMark,
  type AppState,
  type CanvasEdge,
  type CanvasNode,
  type Card,
  type Entity,
  type FootnoteSegment,
  type FootnoteTarget,
} from './document.ts'
import { shownCharCount, shownProse } from './mentions.ts'
import { entityCanvasPaint } from './relations.ts'

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
  boxHeight: number
  onHeight: (id: string, height: number) => void
  premise: boolean
  footnotes: FootnoteSegment[]
  footnoteKey: string
  onFootnote: (target: FootnoteTarget) => void
}
type GroupData = { text: string; conflict: boolean }
type EntityData = {
  name: string
  color: string
  shape: 'square'
  footnotes: FootnoteSegment[]
  onFootnote: (target: FootnoteTarget) => void
}

function FootnoteRow({
  segments,
  onOpen,
}: {
  segments: FootnoteSegment[]
  onOpen: (target: FootnoteTarget) => void
}) {
  if (segments.length === 0) return null
  return (
    <div className="snow-footnotes" aria-label="卡片脚注">
      {segments.map((segment, index) => (
        <span key={segment.text}>
          {index > 0 ? ' · ' : null}
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onOpen(segment.target)
            }}
          >
            {segment.text}
          </button>
        </span>
      ))}
    </div>
  )
}

function SnowCard({ id, data }: NodeProps<Node<CardData, 'snowCard'>>) {
  const cardRef = useRef<HTMLDivElement>(null)
  const title = data.title.trim()
  const body = data.body.trim()
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
  }, [id, data.body, data.boxHeight, data.footnoteKey, data.layerLabel, data.meta, data.onHeight, data.premise, data.title, data.width])
  return (
    <div className="snow-node">
      <div
        ref={cardRef}
        className={['snow-card', data.flash ? 'adopt-flash' : '', data.conflict ? 'is-conflict' : ''].filter(Boolean).join(' ')}
        data-color={data.color}
      >
        {data.conflict ? <div className="conflict-badge">待选</div> : null}
        {data.premise ? <div className="premise-badge">前提</div> : null}
        <div className="snow-kicker">
          <div className="snow-layer">{data.layerLabel}</div>
          {data.meta ? <div className="snow-meta">{data.meta}</div> : null}
        </div>
        <div className="snow-copy">
          <div className="snow-title">{title || '还没有写下内容'}</div>
          {body ? <div className="snow-body">{body}</div> : null}
        </div>
        <FootnoteRow segments={data.footnotes} onOpen={data.onFootnote} />
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

function SnowEntity({ data }: NodeProps<Node<EntityData, 'snowEntity'>>) {
  return (
    <div className="snow-node">
      <div className="snow-entity" data-shape={data.shape} style={{ background: data.color, borderColor: data.color }}>
        <div className="snow-entity-name">{data.name}</div>
        <FootnoteRow segments={data.footnotes} onOpen={data.onFootnote} />
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { snowCard: SnowCard, snowGroup: SnowGroup, snowEntity: SnowEntity }

function toFlowNode(
  node: CanvasNode,
  card: Card | undefined,
  activeId: string | null,
  flashId: string | null,
  conflict: boolean,
  measured: number | undefined,
  onHeight: (id: string, height: number) => void,
  premise: boolean,
  footnotes: FootnoteSegment[],
  onFootnote: (target: FootnoteTarget) => void,
  state: AppState,
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
  // 卡片 body 为空时，用字段里多出来、会画在正文上的那段，避免只去量一段空正文。
  // 引用标记在这里换成当前名字，卡片上不出现 [[sf:...]]。
  const bodyText = card ? shownProse(bodyTextForCard(card).text, state) : shownProse(face.body, state)
  const title = shownProse(face.title, state)
  // 卡片和正文草稿的「N 字」跟侧栏同一口径：标记本身不计，显示出来的名字计。
  const counted =
    card && (card.layer === 'situation' || card.layer === '正文草稿')
      ? shownCharCount(card.body, state)
      : null
  const meta = counted === null ? face.meta : counted ? `${counted} 字` : ''
  const estimated = estimateSnowCardHeight({
    title,
    body: bodyText,
    meta,
    width: node.width,
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
      title,
      body: bodyText,
      meta,
      width: node.width,
      boxHeight: height,
      onHeight,
      premise,
      footnotes,
      footnoteKey: footnotes.map((segment) => segment.text).join('|'),
      onFootnote,
    },
    style: { width: node.width, height },
  }
}

function entityFlowNode(
  node: CanvasNode,
  entity: Entity | undefined,
  activeId: string | null,
  footnotes: FootnoteSegment[],
  onFootnote: (target: FootnoteTarget) => void,
): Node {
  const paint = entity ? entityCanvasPaint(entity.entityType) : null
  return {
    id: node.id,
    type: 'snowEntity',
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    selected: node.id === activeId,
    zIndex: 1,
    data: {
      name: entity?.name.trim() || node.text || '未命名',
      color: paint?.color ?? 'transparent',
      shape: 'square',
      footnotes,
      onFootnote,
    },
    style: { width: node.width, height: node.height },
  }
}

function flowEndpoint(id: string, nodes: readonly CanvasNode[]): string | null {
  if (nodes.some((node) => node.id === id)) return id
  const via = nodes.find((node) => node.entityId === id)
  return via?.id ?? null
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
  onFootnote,
  onPlaceEntity,
  documentState,
  flashCardId,
  onCardMenu,
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
  onFootnote: (target: FootnoteTarget) => void
  onPlaceEntity: (entityId: string, x: number, y: number) => void
  documentState: AppState
  flashCardId: string | null
  onCardMenu: (id: string, point: { x: number; y: number }) => void
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
      if (active.closest('.discuss-dock, [data-discuss-popover], .control-pane, .session-pane')) return
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
  const onFootnoteRef = useRef(onFootnote)
  onFootnoteRef.current = onFootnote
  const openFootnote = useCallback((target: FootnoteTarget) => {
    onFootnoteRef.current(target)
  }, [])
  const flowNodes = nodes.map((node) => {
    if (node.entityId) {
      const entity = (documentState.entities ?? []).find((item) => item.id === node.entityId)
      const flow = entityFlowNode(node, entity, activeId, cardFootnotes(documentState, node.id), openFootnote)
      const held = dragged[node.id]
      return held ? { ...flow, position: held } : flow
    }
    const measured = node.type === 'group' ? undefined : heights[node.id]
    const flow = toFlowNode(
      node,
      cards[node.id],
      activeId,
      flashCardId,
      conflictIds?.has(node.id) ?? false,
      measured,
      onHeight,
      premiseMark(documentState, node.id) === '前提',
      cardFootnotes(documentState, node.id),
      openFootnote,
      documentState,
    )
    const held = dragged[node.id]
    return held ? { ...flow, position: held } : flow
  })
  const flowEdges: Edge[] = edges.flatMap((edge): Edge[] => {
    const source = flowEndpoint(edge.fromNode, nodes)
    const target = flowEndpoint(edge.toNode, nodes)
    if (!source || !target) return []
    if (edge.kind === 'projects-onto') {
      return [{ id: edge.id, source, target, label: String(edge.sedimentEvents?.length ?? 0), style: { strokeDasharray: '6 4' } }]
    }
    if (edge.kind === 'appears-in') {
      return [{ id: edge.id, source, target, style: { strokeWidth: 1 } }]
    }
    return [{ id: edge.id, source, target, label: edge.label }]
  })

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
        onNodeClick={(_event, node) => {
          onSelect(node.id)
        }}
        onNodeDoubleClick={(event, node) => {
          if (node.type !== 'snowCard') return
          event.preventDefault()
        }}
        onDragOver={(event) => {
          if ([...event.dataTransfer.types].includes('text/plain')) event.preventDefault()
        }}
        onDrop={(event) => {
          const raw = event.dataTransfer.getData('text/plain')
          if (!raw.startsWith('place-entity:')) return
          event.preventDefault()
          if (!canEdit) return
          const entityId = raw.slice('place-entity:'.length)
          const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
          onPlaceEntity(entityId, pos.x, pos.y)
        }}
        isValidConnection={(connection) => Boolean(connection.source && connection.target && connection.source !== connection.target)}
        onConnect={(connection) => {
          if (!connection.source || !connection.target || connection.source === connection.target) return
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
        onNodeContextMenu={(event, node) => {
          if (node.type !== 'snowCard') return
          event.preventDefault()
          onSelect(node.id)
          onCardMenu(node.id, { x: event.clientX, y: event.clientY })
        }}
        // 不把 Delete / Backspace 交给 xyflow，避免和页面上的确认删除各删一次。
        deleteKeyCode={[]}
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
