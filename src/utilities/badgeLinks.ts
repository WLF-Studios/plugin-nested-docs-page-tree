import type { PayloadRequest, SanitizedCollectionConfig } from 'payload'

import { extractJWT } from 'payload'

import type {
  NestedDocsPageTreePluginBadgesLinks,
  PageTreeSourceDoc,
  PageTreeStatusLinks,
} from '../types.js'

import { getPageTreeDisplayStatus } from './status.js'

export async function resolvePageTreeBadgeLinks(args: {
  badgesLinks?: NestedDocsPageTreePluginBadgesLinks
  breadcrumbsFieldSlug: string
  collectionConfig: SanitizedCollectionConfig
  draftDoc: PageTreeSourceDoc
  publishedDoc?: PageTreeSourceDoc
  req: PayloadRequest
}): Promise<PageTreeStatusLinks> {
  const { badgesLinks, breadcrumbsFieldSlug, collectionConfig, draftDoc, publishedDoc, req } = args
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
        token: extractJWT(req),
      }),
    )
  }
  return links
}
