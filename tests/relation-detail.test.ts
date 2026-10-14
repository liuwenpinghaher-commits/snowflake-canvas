import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { addEdge, createCard, createDocument, emptyArc, type Entity, type EntityType } from '../src/document.ts'
import RelationPage, {
  BRAIN_EDGE_CLASS,
  adjacentRelationEdges,
  applyFocusFade,
  bindRelationGraphEvents,
  focusRelationNode,
  mountRelationCy,
  relationDetailAfterKey,
  relationStylesheet,
  type RelationSelection,
} from '../src/RelationPage.tsx'
import { buildRelationGraph, defaultRelationFilter, type RelationFilter } from '../src/relations.ts'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

function entity(id: string, entityType: EntityType, name: string, slug?: string): Entity {
  const item: Entity = { id, entityType, name, views: {}, fields: {}, arc: emptyArc(), premise: false }
  if (slug) item.slug = slug
  return item
}

function styleOf(selector: string): Record<string, unknown> {
  const block = relationStylesheet(false).find((item) => item.selector === selector)
  if (!block || !('style' in block) || !block.style || typeof block.style !== 'object') return {}
  return block.style as Record<string, unknown>
}

const firstLine = '柳岸青是一个考古专家，常年沿着河岸寻找被河水冲出来的墓砖，直到看见完整的墓口才停下来。'
const restLine = '墓砖上的纹样还完整，没有被省略号截掉的后半句。'
const shoreBody = `${firstLine}\n${restLine}`
const brickTitle = '河边第二张卡片写的是墓砖纹样如何辨认，这整句要出现在相邻边里，不能只留四十个字就截断。'

function shoreState() {
  let state = createDocument('detail')
  state = createCard(state, { id: 'shore', layer: 'situation', x: 0, y: 0, body: shoreBody })
  state = createCard(state, { id: 'brick', layer: 'situation', x: 40, y: 0, body: brickTitle })
  state = createCard(state, { id: 'lane', layer: 'situation', x: 80, y: 0, body: '另一条河岸，不连到柳岸青这张卡。' })
  state = { ...state, entities: [entity('ned', 'person', '奈德')] }
  state = addEdge(state, 'shore', 'brick', 'relates', { relation: '冲突' })
  state = addEdge(state, 'brick', 'lane', 'relates', { relation: '互补' })
  state = addEdge(state, 'shore', 'ned', 'projects-onto')
  const filter: RelationFilter = { ...defaultRelationFilter(), ideaLayer: true }
  return { state, filter }
}

describe('关系图节点详情', () => {
  it('点卡片节点打开抽屉，里面是完整标题和未被截断的正文，相邻边条数与图一致，Esc 关闭', () => {
    const { state, filter } = shoreState()
    expect([...firstLine].length).toBeGreaterThan(40)
    expect([...brickTitle].length).toBeGreaterThan(40)
    expect(state.snowflake.cards.shore?.body).toBe(shoreBody)

    const graph = buildRelationGraph(state, filter)
    const connected = graph.edges.filter((edge) => edge.from === 'shore' || edge.to === 'shore')
    expect(connected.length).toBeGreaterThan(0)
    expect(graph.edges.length).toBeGreaterThan(connected.length)
    expect(adjacentRelationEdges(graph, 'shore')).toHaveLength(connected.length)

    const html = renderToStaticMarkup(
      createElement(RelationPage, {
        state,
        initialFilter: filter,
        initialSelection: { kind: 'node', id: 'shore' },
      }),
    )
    expect(html.match(/class="relation-side"/g)).toHaveLength(1)
    expect(html).toContain('aria-label="详情"')
    expect(html).toContain('aria-label="关闭"')
    expect(html).toContain(`<h2 class="relation-detail-title">${firstLine}</h2>`)
    expect(html).toContain(`<div class="relation-detail-body">${shoreBody}</div>`)
    expect(html).toContain(restLine)
    expect(html).toContain(brickTitle)
    expect(html).toContain('奈德')
    expect(html.match(/class="relation-neighbor"/g)).toHaveLength(connected.length)
    expect(html).not.toContain('undefined')
    const sliced = [...shoreBody.trim()].slice(0, 40).join('')
    expect(html).not.toContain(`<h2 class="relation-detail-title">${sliced}</h2>`)

    const brickHtml = renderToStaticMarkup(
      createElement(RelationPage, {
        state,
        initialFilter: filter,
        initialSelection: { kind: 'node', id: 'brick' },
      }),
    )
    expect(brickHtml.match(/class="relation-side"/g)).toHaveLength(1)
    expect(brickHtml).toContain(`<h2 class="relation-detail-title">${brickTitle}</h2>`)
    expect(brickHtml).not.toContain(restLine)

    const relate = state.canvas.edges.find((edge) => edge.kind === 'relates' && edge.fromNode === 'shore')
    expect(relate).toBeTruthy()
    const edgeHtml = renderToStaticMarkup(
      createElement(RelationPage, {
        state,
        initialFilter: filter,
        initialSelection: { kind: 'edge', id: relate?.id ?? '' },
      }),
    )
    expect(edgeHtml.match(/class="relation-side"/g)).toHaveLength(1)
    expect(edgeHtml).toContain('<h3>冲突</h3>')
    expect(edgeHtml).toContain(`从 ${firstLine} 到 ${brickTitle}`)

    const selected: RelationSelection = { kind: 'node', id: 'shore' }
    expect(relationDetailAfterKey(selected, 'Escape')).toBeNull()
    expect(relationDetailAfterKey(selected, 'Enter')).toEqual(selected)
    const source = read('src/RelationPage.tsx')
    expect(source).toContain("addEventListener('keydown'")
    expect(source).toContain('relationDetailAfterKey(open, event.key)')
    expect(source).toContain('setOpen(null)')

    const cy = mountRelationCy({ graph, viewport: { width: 960, height: 640 } })
    let open: RelationSelection | null = null
    let edgePicks = 0
    let hoverText = ''
    bindRelationGraphEvents(cy, {
      onSelectNode: (id) => {
        open = { kind: 'node', id }
      },
      onSelectEdge: (id) => {
        edgePicks += 1
        open = { kind: 'edge', id }
      },
      onClear: () => {
        open = null
      },
      onHover: (tip) => {
        hoverText = tip?.text ?? ''
      },
    })
    cy.getElementById('shore').emit('tap')
    expect(open).toEqual({ kind: 'node', id: 'shore' })
    expect(String(cy.getElementById('shore').data('title'))).toBe(firstLine)
    expect(String(cy.getElementById('shore').data('label'))).not.toBe(firstLine)
    expect([...String(cy.getElementById('shore').data('label'))].length).toBeLessThanOrEqual(40)

    cy.getElementById('shore').emit('mouseover')
    expect(hoverText).toBe(firstLine)

    const relateId = graph.edges.find((edge) => edge.kind === 'relates' && edge.from === 'shore')?.id ?? ''
    cy.getElementById(relateId).emit('tap')
    expect(open).toEqual({ kind: 'edge', id: relateId })
    expect(edgePicks).toBe(1)

    const brainId = 'brain:shore:ned:1'
    cy.add({ data: { id: brainId, source: 'shore', target: 'ned' }, classes: BRAIN_EDGE_CLASS })
    cy.getElementById(brainId).emit('tap')
    expect(edgePicks).toBe(1)
    expect(open).toEqual({ kind: 'edge', id: relateId })

    cy.getElementById('brick').emit('tap')
    expect(open).toEqual({ kind: 'node', id: 'brick' })
    cy.emit('tap')
    expect(open).toBeNull()

    expect(focusRelationNode(cy, 'ned')).toBe(true)
    expect(focusRelationNode(cy, 'missing-node')).toBe(false)

    applyFocusFade(cy, { kind: 'node', id: 'shore' })
    expect(cy.getElementById('shore').hasClass('picked')).toBe(true)
    expect(cy.getElementById('shore').hasClass('hover')).toBe(true)
    expect(cy.getElementById('brick').hasClass('faded')).toBe(false)
    expect(cy.getElementById('lane').hasClass('faded')).toBe(true)
    applyFocusFade(cy, { kind: 'edge', id: relateId })
    expect(cy.getElementById(relateId).hasClass('picked')).toBe(true)
    expect(cy.getElementById('shore').hasClass('picked')).toBe(false)
    expect(cy.getElementById(brainId).hasClass('picked')).toBe(false)

    expect(styleOf('node.picked')['border-width']).toBeGreaterThan(styleOf('node.hover')['border-width'] as number)
    expect(styleOf('node.picked')['border-color']).not.toBe(styleOf('node.hover')['border-color'])
    expect(styleOf('edge.picked')['overlay-color']).not.toBe(styleOf('edge.hover-edge')['overlay-color'])
    expect(read('src/index.css')).toContain('min(400px')
    cy.destroy()
  })

  it('有百科页名就给出打开资料库原页；没有回调时显示页名并可以复制', () => {
    const state = {
      ...createDocument('slug'),
      entities: [entity('ned', 'person', '奈德', 'world/ned-stark')],
    }
    const copied = renderToStaticMarkup(
      createElement(RelationPage, { state, initialSelection: { kind: 'node', id: 'ned' } }),
    )
    expect(copied).toContain('world/ned-stark')
    expect(copied).toContain('复制')
    expect(copied).not.toContain('打开资料库原页')
    expect(copied).not.toContain('undefined')

    const linked = renderToStaticMarkup(
      createElement(RelationPage, {
        state,
        initialSelection: { kind: 'node', id: 'ned' },
        onOpenEncyclopedia: () => {},
      }),
    )
    expect(linked).toContain('打开资料库原页')
    expect(linked).toContain('打开百科页')
    expect(linked).toContain('打开人物页')
    expect(linked).not.toContain('undefined')
  })
})
