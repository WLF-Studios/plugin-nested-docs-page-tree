import type { PayloadRequest } from 'payload'

import { stringifyDocID } from '../utilities/pageTree.js'

export function getPayloadCollection({
  collectionSlug,
  req,
}: {
  collectionSlug: string
  req: PayloadRequest
}) {
  return req.payload.collections[collectionSlug]
}

export function getRequestedLocale(req: PayloadRequest): string | undefined {
  return req.locale && req.locale !== 'all' ? req.locale : undefined
}

export function collectionHasDrafts(args: {
  collectionSlug: string
  req: PayloadRequest
}): boolean {
  return Boolean(getPayloadCollection(args)?.config?.versions?.drafts)
}

export function collectionHasAutosaveDrafts(args: {
  collectionSlug: string
  req: PayloadRequest
}): boolean {
  const drafts = getPayloadCollection(args)?.config?.versions?.drafts

  return Boolean(drafts && drafts.autosave)
}

export function normalizeID(value: unknown): null | string {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return stringifyDocID(value)
  }

  return null
}

export function respond(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status })
}

export function toCollectionID(args: {
  collectionSlug: string
  id: string
  req: PayloadRequest
}): number | string {
  const { id, collectionSlug, req } = args
  const collection = getPayloadCollection({ collectionSlug, req })
  const idType = collection?.customIDType ?? req.payload.db.defaultIDType

  return idType === 'number' ? Number(id) : id
}

export async function assertUpdateAccess(args: {
  collectionSlug: string
  data: Record<string, unknown>
  id: number | string
  req: PayloadRequest
}): Promise<null | Response> {
  const { id, collectionSlug, data, req } = args
  const collection = getPayloadCollection({ collectionSlug, req })
  const updateAccess = collection?.config?.access?.update

  if (!updateAccess) {
    return null
  }

  const accessResult = await updateAccess({
    id,
    data,
    req,
  })

  if (accessResult === false) {
    return respond(403, {
      message: req.i18n.t('error:unauthorized'),
    })
  }

  if (accessResult && typeof accessResult === 'object') {
    const matchingDocs = await req.payload.find({
      collection: collectionSlug,
      depth: 0,
      draft: collectionHasDrafts({ collectionSlug, req }) ? true : undefined,
      limit: 1,
      locale: getRequestedLocale(req),
      overrideAccess: true,
      req,
      where: {
        and: [
          {
            id: {
              equals: id,
            },
          },
          accessResult,
        ],
      },
    })

    if (matchingDocs.docs.length === 0) {
      return respond(403, {
        message: req.i18n.t('error:unauthorized'),
      })
    }
  }

  return null
}
