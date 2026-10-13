import { useState, type ChangeEvent } from 'react'
import { assetUrl, uploadAsset } from './asset-client.ts'
import { entityCoverAllowed, setEntityCover, type AppState, type Entity } from './document.ts'

export function CoverField({
  entity,
  canEdit,
  onApply,
}: {
  entity: Entity
  canEdit: boolean
  onApply: (recipe: (state: AppState) => AppState) => void | Promise<void>
}) {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  if (!entityCoverAllowed(entity.entityType)) return null
  const cover = entity.cover?.trim() ?? ''

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !canEdit || pending) return
    setPending(true)
    setError('')
    try {
      const stored = await uploadAsset(file)
      await onApply((state) => setEntityCover(state, entity.id, stored.relativePath))
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '封面没有收下')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="cover-field">
      {cover ? <img className="cover-field-image" src={assetUrl(cover)} alt={`${entity.name.trim() || '未命名'}的封面`} /> : null}
      <label>
        封面
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
          aria-label="从相册或本地选择封面"
          disabled={!canEdit || pending}
          onChange={(event) => void onPick(event)}
        />
      </label>
      {cover ? (
        <button type="button" disabled={!canEdit || pending} onClick={() => void onApply((state) => setEntityCover(state, entity.id, ''))}>
          去掉封面
        </button>
      ) : (
        <p className="hint">从相册或本地选一张图，只存在这本书的附件里。</p>
      )}
      {error ? (
        <p className="status-line is-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
