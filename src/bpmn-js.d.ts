declare module 'bpmn-js/lib/Modeler' {
  export default class Modeler {
    constructor(options: { container: HTMLElement; propertiesPanel?: { parent: HTMLElement }; additionalModules?: unknown[] })
    importXML(xml: string): Promise<unknown>
    saveXML(options?: { format?: boolean }): Promise<{ xml?: string }>
    get(name: 'elementRegistry'): { get(id: string): unknown }
    get(name: 'selection'): { select(element: unknown): void }
    get(name: 'canvas'): { addMarker(id: string, marker: string): void; zoom(fit: 'fit-viewport'): void }
    destroy(): void
  }
}

declare module 'bpmn-js/lib/Viewer' {
  export default class Viewer {
    constructor(options: { container: HTMLElement; additionalModules?: unknown[] })
    importXML(xml: string): Promise<unknown>
    saveXML(options?: { format?: boolean }): Promise<{ xml?: string }>
    get(name: 'elementRegistry'): { get(id: string): unknown }
    get(name: 'selection'): { select(element: unknown): void }
    get(name: 'canvas'): { addMarker(id: string, marker: string): void; zoom(fit: 'fit-viewport'): void }
    destroy(): void
  }
}

declare module 'bpmn-js-properties-panel' {
  export const BpmnPropertiesPanelModule: unknown
  export const BpmnPropertiesProviderModule: unknown
}
