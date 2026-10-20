export interface GapScene {
  id: string
  step: string
  failure: boolean
}

export interface GapForeshadow {
  id: string
  name: string
  plant: string | null
  payoff: string | null
}

export interface GapView {
  kind: string
  steps: string[]
  points: string
  slug: string
  dismissed: string[]
  scenes: GapScene[]
  foreshadows: GapForeshadow[]
  outlineNames: string[]
  appearingNames: string[]
}

export interface GapItem {
  id: string
  message: string
}

export function gapReport(view: GapView): GapItem[] {
  const items: GapItem[] = []
  const used = new Set(view.scenes.map((scene) => scene.step).filter((step) => step))
  for (const step of view.steps) {
    if (!used.has(step)) items.push({ id: `missing:${step}`, message: step })
  }
  if (view.steps.includes('经过')) {
    const failures = view.scenes.filter((scene) => scene.step === '经过' && scene.failure).length
    if (failures < 3) items.push({ id: 'journey:failures', message: `经过段只有 ${failures} 次失败` })
  }
  for (const foreshadow of view.foreshadows) {
    if (foreshadow.plant && !foreshadow.payoff) {
      items.push({ id: `foreshadow:${foreshadow.id}`, message: `伏笔「${foreshadow.name}」只埋没回收` })
    }
  }
  const appearing = new Set(view.appearingNames)
  for (const name of view.outlineNames) {
    if (!appearing.has(name)) items.push({ id: `cast:${name}`, message: `${name}在大纲里出现，还没有出场的场` })
  }
  const dismissed = new Set(view.dismissed)
  return items.filter((item) => !dismissed.has(item.id))
}
