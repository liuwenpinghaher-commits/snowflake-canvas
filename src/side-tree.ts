import type { AppState } from './document.ts'

export type WorkPage = 'canvas' | 'cast' | 'relation' | 'chapter' | 'encyclopedia' | 'scenes' | 'flow' | 'bitemporal'

export type TreeTarget =
  | { kind: 'book' }
  | { kind: 'page'; page: WorkPage }
  | { kind: 'person'; entityId: string }
  | { kind: 'entity'; entityId: string }
  | { kind: 'chapter'; chapterId: string }

export interface TreeNode {
  id: string
  label: string
  target: TreeTarget
  children?: TreeNode[]
}

export interface TreeJump {
  page: WorkPage
  entityId?: string
  chapterId?: string
}

export function bookTree(bookName: string, state: AppState): TreeNode {
  const people = (state.entities ?? []).filter((entity) => entity.entityType === 'person')
  const others = (state.entities ?? []).filter((entity) => entity.entityType !== 'person')
  const chapters = state.chapters ?? []
  return {
    id: 'book',
    label: bookName.trim() || '未命名书',
    target: { kind: 'book' },
    children: [
      { id: 'page:canvas', label: '画布', target: { kind: 'page', page: 'canvas' } },
      {
        id: 'page:cast',
        label: '人物',
        target: { kind: 'page', page: 'cast' },
        children: people.map((entity) => ({
          id: `person:${entity.id}`,
          label: entity.name.trim() || entity.id,
          target: { kind: 'person', entityId: entity.id },
        })),
      },
      { id: 'page:relation', label: '关系', target: { kind: 'page', page: 'relation' } },
      {
        id: 'page:chapter',
        label: '章节',
        target: { kind: 'page', page: 'chapter' },
        children: chapters.map((chapter) => ({
          id: `chapter:${chapter.id}`,
          label: chapter.title.trim() || chapter.id,
          target: { kind: 'chapter', chapterId: chapter.id },
        })),
      },
      {
        id: 'page:encyclopedia',
        label: '百科',
        target: { kind: 'page', page: 'encyclopedia' },
        children: others.map((entity) => ({
          id: `entity:${entity.id}`,
          label: entity.name.trim() || entity.id,
          target: { kind: 'entity', entityId: entity.id },
        })),
      },
      { id: 'page:scenes', label: '场次', target: { kind: 'page', page: 'scenes' } },
      { id: 'page:flow', label: '流程', target: { kind: 'page', page: 'flow' } },
    ],
  }
}

export function treeJump(node: TreeNode): TreeJump {
  const target = node.target
  if (target.kind === 'person') return { page: 'cast', entityId: target.entityId }
  if (target.kind === 'entity') return { page: 'encyclopedia', entityId: target.entityId }
  if (target.kind === 'chapter') return { page: 'chapter', chapterId: target.chapterId }
  if (target.kind === 'page') return { page: target.page }
  return { page: 'canvas' }
}
