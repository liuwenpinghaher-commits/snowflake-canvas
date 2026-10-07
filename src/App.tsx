import { useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import FlowCanvas from './FlowCanvas.tsx'
import SideEditor from './SideEditor.tsx'
import {
  addGroup,
  changeToLaterLayer,
  commitCardText,
  createCard,
  createDocument,
  deleteSelection,
  linkCards,
  moveNode,
  spawnChild,
  type Layer,
} from './document.ts'

export default function App() {
  const [state, setState] = useState(() => createDocument(crypto.randomUUID()))
  const activeNode = state.canvas.nodes.find((node) => node.id === state.activeId) ?? null
  const activeCard = state.activeId ? (state.snowflake.cards[state.activeId] ?? null) : null

  return (
    <div className="app">
      <header className="topbar">
        <h1>雪花画布</h1>
        <p>空白处双击放一张念头。从卡片右边拖出去，长出后面的层。</p>
        <div className="top-actions">
          <button
            type="button"
            onClick={() => {
              setState((current) => {
                const shift = current.canvas.nodes.length * 28
                return createCard(current, {
                  layer: 'situation',
                  x: 80 + shift,
                  y: 80 + shift,
                  body: '',
                })
              })
            }}
          >
            新建念头
          </button>
          <button
            type="button"
            onClick={() => {
              setState((current) => {
                const shift = current.canvas.nodes.length * 24
                return addGroup(current, { x: 40 + shift, y: 40 + shift })
              })
            }}
          >
            新建分组
          </button>
          <button
            type="button"
            disabled={!state.activeId}
            onClick={() => {
              setState((current) => (current.activeId ? deleteSelection(current, current.activeId) : current))
            }}
          >
            删除
          </button>
        </div>
      </header>
      <div className="workspace">
        <ReactFlowProvider>
          <FlowCanvas
            nodes={state.canvas.nodes}
            edges={state.canvas.edges}
            cards={state.snowflake.cards}
            activeId={state.activeId}
            onMove={(id, x, y) => setState((current) => moveNode(current, id, x, y))}
            onSelect={(id) => setState((current) => (current.activeId === id ? current : { ...current, activeId: id }))}
            onSpawn={(fromId, x, y) => setState((current) => spawnChild(current, fromId, undefined, x, y))}
            onLink={(fromId, toId) => setState((current) => linkCards(current, fromId, toId))}
            onCreateAt={(x, y) =>
              setState((current) => createCard(current, { layer: 'situation', x, y, body: '' }))
            }
          />
        </ReactFlowProvider>
        <SideEditor
          cardId={activeCard ? state.activeId : null}
          card={activeCard}
          groupSelected={activeNode?.type === 'group'}
          onCommit={(cardId, fieldKey, text) => {
            setState((current) => commitCardText(current, cardId, text, fieldKey, false))
          }}
          onChangeLayer={(cardId, layer: Layer) => {
            setState((current) => changeToLaterLayer(current, cardId, layer))
          }}
        />
      </div>
    </div>
  )
}
