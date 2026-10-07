import { useEffect, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import FlowCanvas from './FlowCanvas.tsx'
import SideEditor from './SideEditor.tsx'
import { createBrowserPorts, triggerDownload } from './persist-browser.ts'
import {
  MSG_SAVE_AS,
  SAVE_AS_WARNING,
  createPersistController,
  idleSnapshot,
  openDefaultRecoveryLog,
  type PersistController,
  type PersistSnapshot,
} from './persist.ts'
import {
  addGroup,
  changeToLaterLayer,
  createCard,
  deleteSelection,
  linkCards,
  moveNode,
  spawnChild,
  type Layer,
} from './document.ts'

type SaveDialog = {
  title: string
  fileName: string
  bytes: Uint8Array
  resolve: (accepted: boolean) => void
}

export default function App() {
  const [snap, setSnap] = useState<PersistSnapshot>(() => idleSnapshot())
  const [dialog, setDialog] = useState<SaveDialog | null>(null)
  const ctlRef = useRef<PersistController | null>(null)

  useEffect(() => {
    const ctl = createPersistController(
      createBrowserPorts({
        openLog: openDefaultRecoveryLog,
        askSaveAs: (fileName, bytes) =>
          new Promise((resolve) => {
            setDialog({ title: MSG_SAVE_AS, fileName, bytes, resolve })
          }),
        askFirstDownload: (fileName, bytes) =>
          new Promise((resolve) => {
            setDialog({ title: '选择正本', fileName, bytes, resolve })
          }),
      }),
      setSnap,
    )
    ctlRef.current = ctl
    void ctl.start()
    return () => {
      ctl.dispose()
      ctlRef.current = null
    }
  }, [])

  const { state, view } = snap
  const activeNode = state.canvas.nodes.find((node) => node.id === state.activeId) ?? null
  const activeCard = state.activeId ? (state.snowflake.cards[state.activeId] ?? null) : null
  const canEdit = view.canEdit

  const closeDialog = (accepted: boolean) => {
    if (!dialog) return
    if (accepted) triggerDownload(dialog.fileName, dialog.bytes)
    dialog.resolve(accepted)
    setDialog(null)
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>雪花画布</h1>
        <p>空白处双击放一张念头。从卡片右边拖出去，长出后面的层。</p>
        <div className="top-actions">
          {view.needChoice && !view.fileProtocol ? (
            <button type="button" onClick={() => void ctlRef.current?.selectDirectory()}>
              选择正本
            </button>
          ) : null}
          {view.needPermission ? (
            <button type="button" onClick={() => void ctlRef.current?.requestPermission()}>
              允许读写
            </button>
          ) : null}
          {view.readonlyOther ? (
            <button type="button" onClick={() => void ctlRef.current?.claimWrite()}>
              改由本页写入
            </button>
          ) : null}
          {view.downloadMode && !view.fileProtocol ? (
            <label className="file-pick">
              打开正本
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (!file) return
                  void file.arrayBuffer().then((buffer) => {
                    void ctlRef.current?.openLocalFile(new Uint8Array(buffer), file.name)
                  })
                }}
              />
            </label>
          ) : null}
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => {
              void ctlRef.current?.mutate((current) => {
                const shift = current.canvas.nodes.length * 28
                return createCard(current, { layer: 'situation', x: 80 + shift, y: 80 + shift, body: '' })
              })
            }}
          >
            新建念头
          </button>
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => {
              void ctlRef.current?.mutate((current) => {
                const shift = current.canvas.nodes.length * 24
                return addGroup(current, { x: 40 + shift, y: 40 + shift })
              })
            }}
          >
            新建分组
          </button>
          <button
            type="button"
            disabled={!canEdit || !state.activeId}
            onClick={() => {
              void ctlRef.current?.mutate((current) =>
                current.activeId ? deleteSelection(current, current.activeId) : current,
              )
            }}
          >
            删除
          </button>
        </div>
        {view.messages.map((message) => (
          <p key={message} className="status-line" role="status">
            {message}
          </p>
        ))}
      </header>
      <div className="workspace">
        <ReactFlowProvider>
          <FlowCanvas
            nodes={state.canvas.nodes}
            edges={state.canvas.edges}
            cards={state.snowflake.cards}
            activeId={state.activeId}
            onMove={(id, x, y) => {
              if (!canEdit) return
              void ctlRef.current?.mutate((current) => moveNode(current, id, x, y))
            }}
            onSelect={(id) => ctlRef.current?.select(id)}
            onSpawn={(fromId, x, y) => {
              if (!canEdit) return
              void ctlRef.current?.mutate((current) => spawnChild(current, fromId, undefined, x, y))
            }}
            onLink={(fromId, toId) => {
              if (!canEdit) return
              void ctlRef.current?.mutate((current) => linkCards(current, fromId, toId))
            }}
            onCreateAt={(x, y) => {
              if (!canEdit) return
              void ctlRef.current?.mutate((current) => createCard(current, { layer: 'situation', x, y, body: '' }))
            }}
          />
        </ReactFlowProvider>
        <SideEditor
          cardId={activeCard ? state.activeId : null}
          card={activeCard}
          groupSelected={activeNode?.type === 'group'}
          canType={canEdit}
          onCommit={(cardId, fieldKey, text) => {
            void ctlRef.current?.commitText(cardId, fieldKey, text)
          }}
          onChangeLayer={(cardId, layer: Layer) => {
            void ctlRef.current?.mutate((current) => changeToLaterLayer(current, cardId, layer))
          }}
        />
      </div>
      {dialog ? (
        <div className="modal-back" role="presentation">
          <div className="modal" role="dialog" aria-label={dialog.title}>
            <h2>{dialog.title}</h2>
            <p>{SAVE_AS_WARNING}</p>
            <div className="modal-actions">
              <button type="button" onClick={() => closeDialog(false)}>
                取消
              </button>
              <button type="button" onClick={() => closeDialog(true)}>
                下载
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
