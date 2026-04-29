import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  PayloadRequest,
} from 'payload'

import { pageTreeMoveContextKey } from 'payload-nested-docs-page-tree'

const postDeployHook = async (source: string, req: PayloadRequest): Promise<void> => {
  const url = process.env.CLOUDFLARE_DEPLOY_HOOK_URL

  if (!url) {
    return
  }

  try {
    await fetch(url, {
      body: JSON.stringify({ source }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  } catch (error) {
    req.payload.logger.error(error)
  }
}

/**
 * Trigger a deploy when a doc crosses the published boundary:
 *   draft     → published   (publish / republish)
 *   published → draft       (unpublish)
 *
 * Skips tree-only parent moves and autosave noise.
 */
export const revalidatePublishedChange =
  (source: string): CollectionAfterChangeHook =>
  async ({ doc, previousDoc, req }) => {
    if (req.context?.[pageTreeMoveContextKey]) return
    if (req.url?.includes('autosave=true')) return

    if (doc._status === 'published' || previousDoc?._status === 'published') {
      await postDeployHook(source, req)
    }
  }

/** Trigger a deploy when a published doc is deleted. */
export const revalidateOnDelete =
  (source: string): CollectionAfterDeleteHook =>
  async ({ doc, req }) => {
    if (doc?._status !== 'published') return

    await postDeployHook(source, req)
  }
