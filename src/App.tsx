import { useEffect, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import FlowCanvas from './FlowCanvas.tsx'
import SideEditor from './SideEditor.tsx'
import { createBrowserPorts, triggerDownload } from './persist-browser.ts'
import {
  MSG_KEEP_SNAPSHOT,
  MSG_SAVE_AS,
  MSG_VERSION_MOVED,
  MSG_WRITE_FAILED,
  SAVE_AS_WARNING,
  SNAPSHOT_SAVE_HINT,
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
  adoptIntoCard,
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
  const [snapName, setSnapName] = useState('')
  const ctlRef = useRef<PersistController | null>(null)
  const flashTimer = useRef<number | null>(null)
  const [discussCardId, setDiscussCardId] = useState<string | null>(null)
  const [flashCardId, setFlashCardId] = useState<string | null>(null)
  const adoptFieldRef = useRef<string | null>(null)

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
        askSnapshotDownload: (fileName, bytes) =>
          new Promise((resolve) => {
            setDialog({ title: MSG_KEEP_SNAPSHOT, fileName, bytes, resolve })
          }),
      }),
      setSnap,
    )
    ctlRef.current = ctl
    const params = new URLSearchParams(window.location.search)
    const hook = window as Window & { __snowflakeReadLog?: () => Promise<string> }
    if (params.get('e2e-bind') === 'directory') {
      hook.__snowflakeReadLog = async () => {
        const bytes = await ctl.readRecoveryLog()
        if (bytes && bytes.byteLength > 0) return new TextDecoder().decode(bytes)
        const log = await openDefaultRecoveryLog()
        try {
          const fresh = await log.read()
          return fresh && fresh.byteLength > 0 ? new TextDecoder().decode(fresh) : ''
        } finally {
          await log.close?.()
        }
      }
    }
    void ctl.start()
    return () => {
      if (hook.__snowflakeReadLog) delete hook.__snowflakeReadLog
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
        <p className="top-hint">空白处双击放一张念头。双击卡片，讨论挂在这张卡片正下方。从卡片右边拖出去，长出后面的层。</p>
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
            className="primary"
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
          <button type="button" disabled={!canEdit} onClick={() => void ctlRef.current?.keepVersion()}>
            {MSG_KEEP_SNAPSHOT}
          </button>
          {view.downloadMode && !view.fileProtocol ? (
            <label className="file-pick">
              选快照回退
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (!file) return
                  void file.arrayBuffer().then((buffer) => {
                    void ctlRef.current?.rollbackToBytes(new Uint8Array(buffer))
                  })
                }}
              />
            </label>
          ) : (
            <>
              <select
                aria-label="已有快照"
                className="snap-select"
                value={snapName}
                onChange={(event) => setSnapName(event.currentTarget.value)}
              >
                <option value="">选择一份快照</option>
                {view.snapshotNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!canEdit || snapName.length === 0}
                onClick={() => void ctlRef.current?.rollbackTo(snapName)}
              >
                回退到这一版
              </button>
            </>
          )}
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
            onOpenDiscuss={(cardId) => setDiscussCardId(cardId)}
            discussCardId={discussCardId && state.snowflake.cards[discussCardId] ? discussCardId : null}
            flashCardId={flashCardId}
            onCloseDiscuss={() => setDiscussCardId(null)}
            onCommitBody={async (cardId, text) => {
              await ctlRef.current?.mutate((current) => {
                const next = adoptIntoCard(current, cardId, text, adoptFieldRef.current)
                return next === current ? { ...current } : next
              })
              const messages = ctlRef.current?.snapshot().view.messages ?? []
              if (messages.includes(MSG_VERSION_MOVED)) throw new Error(MSG_VERSION_MOVED)
              if (messages.includes(MSG_WRITE_FAILED)) throw new Error(MSG_WRITE_FAILED)
              setFlashCardId(cardId)
              if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
              flashTimer.current = window.setTimeout(() => {
                flashTimer.current = null
                setFlashCardId((current) => (current === cardId ? null : current))
              }, 1600)
            }}
          />
        </ReactFlowProvider>
        <SideEditor
          cardId={activeCard ? state.activeId : null}
          card={activeCard}
          documentState={state}
          groupSelected={activeNode?.type === 'group'}
          canType={canEdit}
          onCommit={(cardId, fieldKey, text) => {
            void ctlRef.current?.commitText(cardId, fieldKey, text)
          }}
          onAdoptField={(key) => {
            adoptFieldRef.current = key
          }}
          onChangeLayer={(cardId, layer: Layer) => {
            void ctlRef.current?.mutate((current) => changeToLaterLayer(current, cardId, layer))
          }}
          expandNotice={view.expandNotice}
          candidates={view.candidates}
          onExpand={(cardId, fieldKey) => {
            void ctlRef.current?.requestCandidates(cardId, fieldKey)
          }}
          onConfirmCandidate={(id) => {
            void ctlRef.current?.confirmCandidate(id)
          }}
          onDismissCandidates={() => ctlRef.current?.dismissCandidates()}
        />
      </div>
      {dialog ? (
        <div className="modal-back" role="presentation">
          <div className="modal" role="dialog" aria-label={dialog.title}>
            <h2>{dialog.title}</h2>
            <p>{dialog.title === MSG_KEEP_SNAPSHOT ? SNAPSHOT_SAVE_HINT : SAVE_AS_WARNING}</p>
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
