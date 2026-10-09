import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
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
  conflict: boolean
  title: string
  body: string
  meta: string
}
type GroupData = { text: string; conflict: boolean }

export const NARROW_QUERY = '(max-width: 760px)'

type DockPlace = { dir: 'down' | 'up' | 'clamp'; top: number; left: number; maxH: number | null }

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY)
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}

// 浮窗挂在 document.body 上，不在卡片节点里，所以画布缩放不改它的字号和宽度。
// 宽屏按卡片的屏幕位置贴在卡片下方（放不下就上方，再不行就夹在视口内）；窄屏贴在视口下半屏。
function DiscussDock({ cardId, bind }: { cardId: string; bind: DiscussBind }) {
  const dockRef = useRef<HTMLDivElement>(null)
  const narrow = useNarrow()
  const transform = useStore((state) => state.transform)
  const cardAt = useStore((state) => {
    const at = state.nodeLookup.get(cardId)?.internals.positionAbsolute
    return at ? `${at.x},${at.y}` : ''
  })
  const [place, setPlace] = useState<DockPlace | null>(null)

  useLayoutEffect(() => {
    if (narrow) return
    let dead = false
    const measure = () => {
      if (dead) return
      const node = document.querySelector<HTMLElement>(`.react-flow__node-snowCard[data-id="${CSS.escape(cardId)}"]`)
      const dock = dockRef.current
      if (!node || !dock) return
      const card = node.getBoundingClientRect()
      if (card.width < 1 || card.height < 1) return
      const vw = document.documentElement.clientWidth || window.innerWidth
      const vh = window.innerHeight
      const margin = 8
      const gap = 8
      const desired = 460
      const width = dock.offsetWidth || Math.min(380, vw - margin * 2)
      const spaceBelow = vh - card.bottom - gap - margin
      const spaceAbove = card.top - gap - margin
      let next: DockPlace
      if (spaceBelow >= desired) {
        next = { dir: 'down', top: card.bottom + gap, left: card.left, maxH: null }
      } else if (spaceAbove >= desired) {
        next = { dir: 'up', top: 0, left: card.left, maxH: null }
      } else if (spaceBelow >= spaceAbove && spaceBelow >= 220) {
        next = { dir: 'down', top: card.bottom + gap, left: card.left, maxH: Math.floor(spaceBelow) }
      } else if (spaceAbove >= 220) {
        next = { dir: 'up', top: 0, left: card.left, maxH: Math.floor(spaceAbove) }
      } else {
        const height = Math.min(desired, Math.max(180, vh - margin * 2))
        let top = card.bottom + gap
        if (top + height > vh - margin) top = vh - margin - height
        if (top < margin) top = margin
        next = { dir: 'clamp', top, left: card.left, maxH: Math.floor(height) }
      }
      next.left = Math.min(Math.max(margin, next.left), Math.max(margin, vw - width - margin))
      if (next.dir === 'up') {
        // 浮窗实际高度可能小于上限，往上展开时按实际高度让底边贴着卡片顶边。
        const popover = dock.querySelector<HTMLElement>('.discuss-popover')
        const height = Math.min(popover?.offsetHeight || desired, next.maxH ?? desired)
        next.top = card.top - gap - height
      }
      next.top += window.scrollY
      next.left += window.scrollX
      setPlace((prev) =>
        prev && prev.dir === next.dir && prev.top === next.top && prev.left === next.left && prev.maxH === next.maxH
          ? prev
          : next,
      )
    }
    measure()
    const frame = window.requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    if (dockRef.current) observer.observe(dockRef.current)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      dead = true
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [cardId, narrow, transform, cardAt])

  const style: CSSProperties & Record<string, string | number> = {}
  if (!narrow) {
    if (place) {
      style.top = place.top
      style.left = place.left
      if (place.maxH != null) style['--discuss-max'] = `${place.maxH}px`
    } else {
      style.visibility = 'hidden'
    }
  }
  const className = [
    'discuss-dock',
    narrow ? 'discuss-sheet' : '',
    !narrow && place?.dir === 'up' ? 'discuss-up' : '',
    !narrow && place?.dir === 'clamp' ? 'discuss-clamp' : '',
    !narrow && place?.maxH != null ? 'discuss-fit' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return createPortal(
    <div ref={dockRef} className={className} style={style} data-discuss-dock="">
      <CardDiscuss cardId={cardId} cardBody={bind.cardBody} onClose={bind.onClose} onCommitBody={bind.onCommitBody} />
    </div>,
    document.body,
  )
}

function SnowCard({ data }: NodeProps<Node<CardData, 'snowCard'>>) {
  const title = data.title.trim()
  const body = data.body.trim()
  return (
    <div className="snow-node">
      <div
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
          {body ? <div className="snow-body">{body}</div> : null}
        </div>
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
  discussId: string | null,
  flashId: string | null,
  conflict: boolean,
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
  const tall = face.body.trim().length > 0 || face.title.trim().length > 18
  const height = Math.max(node.height, tall ? 176 : node.height)
  return {
    id: node.id,
    type: 'snowCard',
    position: { x: node.x, y: node.y },
    width: node.width,
    height,
    selected: node.id === activeId,
    zIndex: discussId === node.id ? 20 : 1,
    data: {
      layerLabel: card ? layerLabel(card.layer) : '',
      color: node.color ?? '1',
      canGrow: card ? laterLayers(card.layer).length > 0 : false,
      flash: flashId === node.id,
      conflict,
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
  conflictIds,
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
  conflictIds?: ReadonlySet<string>
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
  const [dragged, setDragged] = useState<Record<string, { x: number; y: number }>>({})
  const draggedRef = useRef(dragged)
  draggedRef.current = dragged
  const flowNodes = nodes.map((node) => {
    const flow = toFlowNode(node, cards[node.id], activeId, discuss?.cardId ?? null, flashCardId, conflictIds?.has(node.id) ?? false)
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
  const onNodesChange = (changes: NodeChange[]) => {
    const moving: Record<string, { x: number; y: number }> = {}
    const released: { id: string; x: number; y: number }[] = []
    for (const change of changes) {
      if (change.type !== 'position') continue
      if (change.dragging) {
        if (change.position) moving[change.id] = { x: change.position.x, y: change.position.y }
        continue
      }
      const at = change.position ?? draggedRef.current[change.id]
      if (at) released.push({ id: change.id, x: at.x, y: at.y })
    }
    const done = new Set(released.map((item) => item.id))
    if (Object.keys(moving).length > 0 || done.size > 0) {
      const next = { ...draggedRef.current, ...moving }
      for (const id of done) delete next[id]
      draggedRef.current = next
      setDragged(next)
    }
    for (const item of released) onMove(item.id, item.x, item.y)
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
      {discuss ? <DiscussDock key={discuss.cardId} cardId={discuss.cardId} bind={discuss.bind} /> : null}
    </div>
  )
}
