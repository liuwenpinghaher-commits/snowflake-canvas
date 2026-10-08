import { useRef } from 'react'
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
import { laterLayers, layerLabel, type CanvasEdge, type CanvasNode, type Card } from './document.ts'

type DiscussBind = {
  cardBody: string
  onClose: () => void
  onCommitBody: (cardId: string, body: string) => Promise<void>
}

type CardData = {
  text: string
  layerLabel: string
  color: string
  canGrow: boolean
  flash: boolean
  discuss: DiscussBind | null
}
type GroupData = { text: string }

function SnowCard({ id, data }: NodeProps<Node<CardData, 'snowCard'>>) {
  return (
    <div className="snow-node">
      <div className={data.flash ? 'snow-card adopt-flash' : 'snow-card'} data-color={data.color}>
        <div className="snow-layer">{data.layerLabel}</div>
        <div className="snow-text">{data.text || '（空）'}</div>
        <Handle type="target" position={Position.Left} />
        {data.canGrow ? <Handle type="source" position={Position.Right} /> : null}
      </div>
      {data.discuss ? (
        <div className="discuss-dock nodrag nopan nowheel" data-discuss-dock="">
          <CardDiscuss
            cardId={id}
            cardBody={data.discuss.cardBody}
            onClose={data.discuss.onClose}
            onCommitBody={data.discuss.onCommitBody}
          />
        </div>
      ) : null}
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
  return {
    id: node.id,
    type: 'snowCard',
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    selected: node.id === activeId,
    zIndex: discuss?.cardId === node.id ? 20 : 1,
    data: {
      text: node.text ?? '',
      layerLabel: card ? layerLabel(card.layer) : '',
      color: node.color ?? '1',
      canGrow: card ? laterLayers(card.layer).length > 0 : false,
      flash: flashId === node.id,
      discuss: discuss?.cardId === node.id ? discuss.bind : null,
    },
    style: { width: node.width, height: node.height },
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
