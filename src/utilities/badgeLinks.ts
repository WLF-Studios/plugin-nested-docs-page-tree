import type {
  NestedDocsPageTreePluginBadgesLinks,
  PageTreeSourceDoc,
  PageTreeStatusLinks,
} from '../types.js'

import { getPageTreeDisplayStatus } from './status.js'

export type BadgeLinkRequest = {
  locale?: null | string
  payload: {
    logger: {
      error(value: unknown): unknown
    }
  }
  url?: string
}

export type BadgeLinkCollectionConfig<TRequest extends BadgeLinkRequest> = {
  admin: {
    preview?: (
      doc: Record<string, unknown>,
      options: { locale: string; req: TRequest; token: null | string },
    ) => null | Promise<null | string> | string
  }
  slug: string
}

export async function resolvePageTreeBadgeLinks<TRequest extends BadgeLinkRequest>(args: {
  badgesLinks?: NestedDocsPageTreePluginBadgesLinks
  breadcrumbsFieldSlug: string
  collectionConfig: BadgeLinkCollectionConfig<TRequest>
  draftDoc: PageTreeSourceDoc
  publishedDoc?: PageTreeSourceDoc
  req: TRequest
  token: null | string
}): Promise<PageTreeStatusLinks> {
  const {
    badgesLinks,
    breadcrumbsFieldSlug,
    collectionConfig,
    draftDoc,
    publishedDoc,
    req,
    token,
  } = args
  if (!badgesLinks) {
    return {}
  }
  const mode = badgesLinks.draftHasPublishedVersion ?? 'both'
  const status = getPageTreeDisplayStatus(draftDoc)
  const links: PageTreeStatusLinks = {}

  async function resolve(kind: keyof PageTreeStatusLinks, generate: () => unknown) {
    try {
      const value = await generate()
      if (typeof value !== 'string' || !value.trim()) {
        return
      }
      const url = new URL(value.trim(), req.url)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        links[kind] = url.href
      }
    } catch {
      req.payload.logger.error({
        collection: collectionConfig.slug,
        destination: kind,
        docID: draftDoc.id,
        msg: 'Could not resolve page tree badge URL',
      })
    }
  }

  if (
    (status === 'published' || (status === 'changed' && mode !== 'preview')) &&
    badgesLinks.liveURL &&
    publishedDoc?._status === 'published'
  ) {
    const breadcrumbs = publishedDoc[breadcrumbsFieldSlug]
    const path: unknown = Array.isArray(breadcrumbs) ? breadcrumbs.at(-1)?.url : undefined
    if (typeof path === 'string' && path.trim()) {
      await resolve('publicURL', () => new URL(path.trim(), badgesLinks.liveURL).href)
    }
  }
  if (
    (status === 'draft' || (status === 'changed' && mode !== 'live')) &&
    collectionConfig.admin.preview
  ) {
    const preview = collectionConfig.admin.preview
    await resolve('previewURL', () =>
      preview(draftDoc, {
        locale: req.locale!,
        req,
        token,
      }),
    )
  }
  return links
}
