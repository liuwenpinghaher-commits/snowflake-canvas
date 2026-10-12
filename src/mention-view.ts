import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { findMentionMarks, type MentionKind } from './mention-mark.ts'

export const bumpMentionLabels = StateEffect.define<string>()

const mentionEpoch = StateField.define<string>({
  create: () => '',
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) {
      if (effect.is(bumpMentionLabels)) next = effect.value
    }
    return next
  },
})

class MentionWidget extends WidgetType {
  readonly label: string
  readonly missing: boolean

  constructor(label: string, missing: boolean) {
    super()
    this.label = label
    this.missing = missing
  }

  eq(other: WidgetType): boolean {
    return other instanceof MentionWidget && other.label === this.label && other.missing === this.missing
  }

  ignoreEvent(): boolean {
    return false
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = this.missing ? 'sf-mention is-missing' : 'sf-mention'
    span.textContent = this.label
    return span
  }
}

function build(text: string, labelOf: (kind: MentionKind, id: string) => string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const mark of findMentionMarks(text)) {
    const label = labelOf(mark.kind, mark.id)
    builder.add(
      mark.start,
      mark.end,
      Decoration.replace({
        widget: new MentionWidget(label, label === '找不到'),
      }),
    )
  }
  return builder.finish()
}

/** 编辑器里把 [[sf:...]] 画成当前名字。文档里仍是标记。组字期间不重画。 */
export function mentionExtensions(labelOf: { current: (kind: MentionKind, id: string) => string }): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view.state.doc.toString(), labelOf.current)
      }
      update(update: ViewUpdate) {
        if (update.view.composing) return
        const bumped = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(bumpMentionLabels)))
        if (!update.docChanged && !update.viewportChanged && !bumped) return
        this.decorations = build(update.view.state.doc.toString(), labelOf.current)
      }
    },
    { decorations: (value) => value.decorations },
  )
  return [
    mentionEpoch,
    plugin,
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  ]
}
