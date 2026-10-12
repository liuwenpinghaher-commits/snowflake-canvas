import type { AppState } from './document.ts'
import { bookTree, treeJump, type TreeNode, type WorkPage } from './side-tree.ts'

export default function SideTree({
  bookName,
  state,
  page,
  onOpen,
  onToggle,
}: {
  bookName: string
  state: AppState
  page: WorkPage | 'books'
  onOpen: (node: TreeNode) => void
  onToggle: () => void
}) {
  const tree = bookTree(bookName, state)
  return (
    <aside className="side-tree" aria-label="目录">
      <div className="side-tree-head">
        <strong>{tree.label}</strong>
        <button type="button" onClick={onToggle}>
          收起
        </button>
      </div>
      <ul>
        {(tree.children ?? []).map((node) => (
          <TreeBranch key={node.id} node={node} page={page} onOpen={onOpen} />
        ))}
      </ul>
    </aside>
  )
}

function TreeBranch({
  node,
  page,
  onOpen,
}: {
  node: TreeNode
  page: WorkPage | 'books'
  onOpen: (node: TreeNode) => void
}) {
  const jump = treeJump(node)
  const current = node.target.kind === 'page' && jump.page === page
  return (
    <li>
      <button
        type="button"
        className={current ? 'tree-current' : undefined}
        aria-current={current ? 'page' : undefined}
        onClick={() => onOpen(node)}
      >
        {node.label}
      </button>
      {node.children && node.children.length > 0 ? (
        <ul className="tree-children">
          {node.children.map((child) => (
            <li key={child.id}>
              <button type="button" onClick={() => onOpen(child)}>
                {child.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}
