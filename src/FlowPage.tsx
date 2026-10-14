import { useEffect, useRef, useState } from 'react'
import type { AppState, Flow, FlowIssue, FlowValidation } from './document.ts'

const EMPTY_VALIDATION: FlowValidation = { ranAt: '', valid: true, errors: [], warnings: [] }

const BLANK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_blank" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_blank" isExecutable="false">
    <bpmn:startEvent id="start" name="开始" />
    <bpmn:endEvent id="end" name="结束" />
    <bpmn:sequenceFlow id="flow_start_end" sourceRef="start" targetRef="end" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_blank">
    <bpmndi:BPMNPlane id="Plane_blank" bpmnElement="Process_blank">
      <bpmndi:BPMNShape id="start_di" bpmnElement="start">
        <dc:Bounds x="160" y="160" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="end_di" bpmnElement="end">
        <dc:Bounds x="320" y="160" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="flow_start_end_di" bpmnElement="flow_start_end">
        <di:waypoint x="196" y="178" />
        <di:waypoint x="320" y="178" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

/** 预览样例：任务连回自己。不是真起草。 */
export const SAMPLE_DRAFT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_sample" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_sample" isExecutable="false">
    <bpmn:startEvent id="start" name="开始" />
    <bpmn:task id="loop" name="这一步连回了自己" />
    <bpmn:endEvent id="end" name="结束" />
    <bpmn:sequenceFlow id="to_loop" sourceRef="start" targetRef="loop" />
    <bpmn:sequenceFlow id="loop_self" sourceRef="loop" targetRef="loop" />
    <bpmn:sequenceFlow id="to_end" sourceRef="loop" targetRef="end" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_sample">
    <bpmndi:BPMNPlane id="Plane_sample" bpmnElement="Process_sample">
      <bpmndi:BPMNShape id="start_di" bpmnElement="start"><dc:Bounds x="160" y="180" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="loop_di" bpmnElement="loop"><dc:Bounds x="280" y="158" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="end_di" bpmnElement="end"><dc:Bounds x="460" y="180" width="36" height="36" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

export const SAMPLE_DRAFT_VALIDATION: FlowValidation = {
  ranAt: '',
  valid: false,
  errors: [{ ruleId: 'self-loop', message: '这一步连回了自己', elementId: 'loop' }],
  warnings: [],
}

const GROUPS = [
  ['book', '整本'],
  ['chapter', '章'],
  ['scene', '场'],
] as const

interface DraftPreview {
  title: string
  xml: string
  validation: FlowValidation
}

interface BpmnCanvas {
  importXML(xml: string): Promise<unknown>
  saveXML(options?: { format?: boolean }): Promise<{ xml?: string }>
  get(name: 'elementRegistry'): { get(id: string): unknown }
  get(name: 'selection'): { select(element: unknown): void }
  get(name: 'canvas'): { addMarker(id: string, marker: string): void; zoom(fit: 'fit-viewport'): void }
  destroy(): void
}

function nextFlowId(flows: Flow[]): string {
  const used = new Set(flows.map((flow) => flow.id))
  let n = flows.length + 1
  while (used.has(`flow-${n}`)) n += 1
  return `flow-${n}`
}

function issueText(issue: FlowIssue): string {
  return issue.ruleId ? `${issue.ruleId}：${issue.message}` : issue.message
}

export function FlowPage({
  state,
  canEdit,
  onApply,
}: {
  state: AppState
  canEdit: boolean
  onApply: (recipe: (current: AppState) => AppState) => void
}) {
  const flows = state.flows ?? []
  const [activeId, setActiveId] = useState<string | null>(flows[0]?.id ?? null)
  const [draft, setDraft] = useState<DraftPreview | null>(null)
  const active = flows.find((flow) => flow.id === activeId) ?? null
  const viewing = draft ?? active
  const readOnly = draft !== null || !canEdit

  function createBlank() {
    if (!canEdit) return
    const id = nextFlowId(flows)
    onApply((current) => ({
      ...current,
      flows: [
        ...(current.flows ?? []),
        {
          id,
          title: '未命名流程',
          scope: { kind: 'book' },
          xml: BLANK_XML,
          beta: '',
          origin: 'human',
          sourceRefs: [],
          validation: EMPTY_VALIDATION,
        },
      ],
    }))
    setDraft(null)
    setActiveId(id)
  }

  function keepDraft() {
    if (!draft || !canEdit) return
    const id = nextFlowId(flows)
    const xml = draft.xml
    const validation = draft.validation
    const title = draft.title
    onApply((current) => ({
      ...current,
      flows: [
        ...(current.flows ?? []),
        {
          id,
          title,
          scope: { kind: 'book' },
          xml,
          beta: '',
          origin: 'human',
          sourceRefs: [],
          validation,
        },
      ],
    }))
    setDraft(null)
    setActiveId(id)
  }

  return (
    <div className="flow-page">
      <aside className="flow-list" aria-label="流程列表">
        <div className="flow-list-actions">
          <button type="button" disabled={!canEdit} onClick={createBlank}>
            新建空白流程
          </button>
          <button type="button" disabled title="起草还没接上">
            从本书起草
          </button>
          <button
            type="button"
            onClick={() =>
              setDraft({
                title: '预览样例（不会自动留下）',
                xml: SAMPLE_DRAFT_XML,
                validation: SAMPLE_DRAFT_VALIDATION,
              })
            }
          >
            打开预览样例
          </button>
        </div>
        <p className="flow-list-note">预览样例不是真起草。点「留下」才写入这本书。</p>
        {GROUPS.map(([kind, label]) => {
          const items = flows.filter((flow) => flow.scope.kind === kind)
          return (
            <section key={kind}>
              <h2>{label}</h2>
              {items.length === 0 ? <p className="flow-list-empty">没有</p> : null}
              <ul>
                {items.map((flow) => (
                  <li key={flow.id}>
                    <button
                      type="button"
                      className={draft === null && flow.id === active?.id ? 'on' : ''}
                      onClick={() => {
                        setDraft(null)
                        setActiveId(flow.id)
                      }}
                    >
                      {flow.title || '未命名流程'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </aside>
      <div className="flow-stage">
        {viewing ? (
          <FlowEditor
            xml={viewing.xml}
            validation={'validation' in viewing ? viewing.validation : EMPTY_VALIDATION}
            readOnly={readOnly}
            onSave={
              draft || !active
                ? undefined
                : (xml) => {
                    const id = active.id
                    onApply((current) => ({
                      ...current,
                      flows: (current.flows ?? []).map((flow) => (flow.id === id ? { ...flow, xml } : flow)),
                    }))
                  }
            }
          />
        ) : (
          <p className="flow-list-empty">还没有流程。可以新建一张空白的。</p>
        )}
        <p className="flow-legend">开始、结束、任务、排他、并行、默认流</p>
        {draft ? (
          <div className="flow-draft-bar">
            <span>这是预览，还没写入这本书。</span>
            <button type="button" disabled={!canEdit} onClick={keepDraft}>
              留下
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              不留
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function FlowEditor({
  xml,
  validation,
  readOnly,
  onSave,
}: {
  xml: string
  validation: FlowValidation
  readOnly: boolean
  onSave?: (xml: string) => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<BpmnCanvas | null>(null)
  const [importError, setImportError] = useState('')
  const [selectedIssue, setSelectedIssue] = useState('')

  useEffect(() => {
    const canvasHost = canvasRef.current
    const panelHost = panelRef.current
    if (!canvasHost || !panelHost) return
    let stopped = false
    let editor: BpmnCanvas | null = null
    void (async () => {
      const [{ default: Modeler }, { default: Viewer }, panel] = await Promise.all([
        import('bpmn-js/lib/Modeler'),
        import('bpmn-js/lib/Viewer'),
        import('bpmn-js-properties-panel'),
      ])
      if (stopped) return
      const instance = (readOnly
        ? new Viewer({ container: canvasHost })
        : new Modeler({
            container: canvasHost,
            propertiesPanel: { parent: panelHost },
            additionalModules: [panel.BpmnPropertiesPanelModule, panel.BpmnPropertiesProviderModule],
          })) as BpmnCanvas
      editor = instance
      editorRef.current = instance
      try {
        await instance.importXML(xml)
        if (stopped) return
        setImportError('')
        paintIssues(instance, validation.errors)
        instance.get('canvas').zoom('fit-viewport')
      } catch (error) {
        if (!stopped) setImportError(error instanceof Error ? error.message : '这张图打不开')
      }
    })()
    return () => {
      stopped = true
      editor?.destroy()
      if (editorRef.current === editor) editorRef.current = null
    }
  }, [xml, readOnly, validation])

  function focusIssue(issue: FlowIssue) {
    const editor = editorRef.current
    if (!editor || !issue.elementId) return
    const element = editor.get('elementRegistry').get(issue.elementId)
    if (!element) {
      setSelectedIssue('图上找不到这一步')
      return
    }
    editor.get('selection').select(element)
    editor.get('canvas').addMarker(issue.elementId, 'flow-issue')
    setSelectedIssue('')
  }

  async function save() {
    const editor = editorRef.current
    if (!editor || !onSave) return
    const saved = await editor.saveXML({ format: true })
    if (saved.xml) onSave(saved.xml)
  }

  const errors = validation.errors ?? []
  const warnings = validation.warnings ?? []

  return (
    <div className={readOnly ? 'flow-editor is-readonly' : 'flow-editor'}>
      <div className="flow-canvas-wrap">
        <div ref={canvasRef} className="flow-canvas" />
        {!readOnly && onSave ? (
          <button type="button" className="flow-save" onClick={() => void save()}>
            保存这张流程
          </button>
        ) : null}
      </div>
      <aside ref={panelRef} className="flow-properties" aria-label="属性" />
      {importError ? (
        <p className="flow-banner is-error" role="alert">
          {importError}
        </p>
      ) : null}
      {errors.map((issue, index) => (
        <button key={`e-${index}`} type="button" className="flow-banner is-error" onClick={() => focusIssue(issue)}>
          {issueText(issue)}
        </button>
      ))}
      {warnings.map((issue, index) => (
        <p key={`w-${index}`} className="flow-banner is-warn">
          {issueText(issue)}
        </p>
      ))}
      {selectedIssue ? <p className="flow-banner is-warn">{selectedIssue}</p> : null}
    </div>
  )
}

function paintIssues(editor: BpmnCanvas, errors: FlowIssue[]) {
  const canvas = editor.get('canvas')
  for (const issue of errors) {
    if (!issue.elementId) continue
    if (!editor.get('elementRegistry').get(issue.elementId)) continue
    canvas.addMarker(issue.elementId, 'flow-issue')
  }
}
