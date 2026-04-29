import type { Endpoint, PayloadRequest, Where } from 'payload'

import { CANCEL_DRAG_MESSAGE } from '../utilities/moveValidation.js'
import {
  buildChildrenByParentID,
  collectDescendantIDs,
  getDocParentID,
  stringifyDocID,
} from '../utilities/pageTree.js'
import { pageTreeMoveContextKey, type PageTreeSourceDoc } from '../types.js'

type MoveDocumentRequestBody = {
  parentID: null | string
}

type PayloadCollectionLike = {
  config?: {
    access?: {
      update?: ((args: Record<string, unknown>) => Promise<Record<string, unknown> | boolean> | Record<string, unknown> | boolean) | undefined
    }
    versions?: {
      drafts?: unknown
    }
  }
  customIDType?: string
}

function respond(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status })
}

function hasOwnProperty(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizeID(value: unknown): null | string {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return stringifyDocID(value)
  }

  return null
}

function normalizeMoveDocumentBody(value: unknown): MoveDocumentRequestBody | null {
  const incomingData =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown
          } catch {
            return null
          }
        })()
      : value

  if (!incomingData || typeof incomingData !== 'object' || Array.isArray(incomingData)) {
    return null
  }

  if (!hasOwnProperty(incomingData, 'parentID')) {
    return null
  }

  const parentID = normalizeID((incomingData as { parentID?: unknown }).parentID)

  if (
    (incomingData as { parentID?: unknown }).parentID !== null &&
    (incomingData as { parentID?: unknown }).parentID !== undefined &&
    parentID === null
  ) {
    return null
  }

  return {
    parentID,
  }
}

async function readBodyFromRequest(req: PayloadRequest): Promise<MoveDocumentRequestBody | null> {
  const directBody = normalizeMoveDocumentBody(req.data)

  if (directBody) {
    return directBody
  }

  if (typeof req.json === 'function') {
    try {
      const jsonBody = normalizeMoveDocumentBody(await req.json())

      if (jsonBody) {
        return jsonBody
      }
    } catch {
      // Fall through to the text-based fallback when the runtime does not hydrate req.data.
    }
  }

  if (typeof req.text === 'function') {
    try {
      return normalizeMoveDocumentBody(await req.text())
    } catch {
      return null
    }
  }

  return null
}

function getPayloadCollection({
  collectionSlug,
  req,
}: {
  collectionSlug: string
  req: PayloadRequest
}): PayloadCollectionLike | undefined {
  return (req.payload.collections as unknown as Record<string, PayloadCollectionLike | undefined>)[
    collectionSlug
  ]
}

function usesNumericID({
  collectionSlug,
  req,
}: {
  collectionSlug: string
  req: PayloadRequest
}): boolean {
  const collection = getPayloadCollection({ collectionSlug, req })

  if (!collection) {
    return false
  }

  const idType = collection.customIDType ?? req.payload.db.defaultIDType

  return idType === 'number'
}

function toCollectionID(args: {
  collectionSlug: string
  id: string
  req: PayloadRequest
}): number | string {
  const { collectionSlug, id, req } = args

  if (!usesNumericID({ collectionSlug, req })) {
    return id
  }

  return Number(id)
}

function getRequestedLocale(req: PayloadRequest): string | undefined {
  return req.locale && req.locale !== 'all' ? req.locale : undefined
}

function collectionHasDrafts(args: {
  collectionSlug: string
  req: PayloadRequest
}): boolean {
  return Boolean(getPayloadCollection(args)?.config?.versions?.drafts)
}

async function assertUpdateAccess(args: {
  collectionSlug: string
  movedID: number | string
  nextParentID: null | number | string
  parentFieldSlug: string
  req: PayloadRequest
}): Promise<Response | null> {
  const { collectionSlug, movedID, nextParentID, parentFieldSlug, req } = args
  const collection = getPayloadCollection({ collectionSlug, req })
  const updateAccess = collection?.config?.access?.update

  if (!updateAccess) {
    return null
  }

  const accessResult = await updateAccess({
    data: { [parentFieldSlug]: nextParentID } as never,
    id: movedID as never,
    req,
  })

  if (accessResult === false) {
    return respond(403, {
      message: req.i18n.t('error:unauthorized'),
    })
  }

  if (accessResult && typeof accessResult === 'object') {
    const matchingDocs = await req.payload.find({
      collection: collectionSlug as never,
      depth: 0,
      draft: collectionHasDrafts({ collectionSlug, req }) ? true : undefined,
      limit: 1,
      locale: getRequestedLocale(req) as never,
      overrideAccess: true,
      req,
      where: {
        and: [
          {
            id: {
              equals: movedID,
            },
          },
          accessResult as Where,
        ],
      },
    } as never)

    if (matchingDocs.docs.length === 0) {
      return respond(403, {
        message: req.i18n.t('error:unauthorized'),
      })
    }
  }

  return null
}

export function createMovePageEndpoint(args: {
  collectionSlug: string
  parentFieldSlug: string
}): Endpoint {
  const { collectionSlug, parentFieldSlug } = args

  return {
    handler: async (req) => {
      const movedIDFromRoute = normalizeID(req.routeParams?.id)

      if (!movedIDFromRoute) {
        return respond(400, {
          message: 'Document ID was not specified.',
        })
      }

      const body = await readBodyFromRequest(req)

      if (!body) {
        return respond(400, {
          message: 'A valid parentID is required.',
        })
      }

      const movedID = toCollectionID({
        collectionSlug,
        id: movedIDFromRoute,
        req,
      })
      const nextParentID =
        body.parentID === null
          ? null
          : toCollectionID({
              collectionSlug,
              id: body.parentID,
              req,
            })
      const accessError = await assertUpdateAccess({
        collectionSlug,
        movedID,
        nextParentID,
        parentFieldSlug,
        req,
      })

      if (accessError) {
        return accessError
      }

      const docsResult = await req.payload.find({
        collection: collectionSlug as never,
        depth: 0,
        draft: collectionHasDrafts({ collectionSlug, req }) ? true : undefined,
        fallbackLocale: false as never,
        limit: 0,
        locale: getRequestedLocale(req) as never,
        overrideAccess: true,
        req,
      } as never)
      const docs = docsResult.docs as unknown as PageTreeSourceDoc[]
      const docsByID = new Map(docs.map((doc) => [stringifyDocID(doc.id), doc]))
      const movedDoc = docsByID.get(movedIDFromRoute)

      if (!movedDoc) {
        return respond(404, {
          message: 'Document not found.',
        })
      }

      if (body.parentID !== null && !docsByID.has(body.parentID)) {
        return respond(400, {
          message: 'Parent document not found.',
        })
      }

      const currentParentID = getDocParentID(movedDoc, parentFieldSlug)

      if (currentParentID === body.parentID) {
        return respond(400, {
          message: 'Document already has that parent.',
        })
      }

      if (body.parentID === movedIDFromRoute) {
        return respond(400, {
          message: CANCEL_DRAG_MESSAGE,
        })
      }

      const childrenByParentID = buildChildrenByParentID({
        docs,
        parentFieldSlug,
      })
      const descendantIDs = collectDescendantIDs(movedIDFromRoute, childrenByParentID)

      if (body.parentID !== null && descendantIDs.includes(body.parentID)) {
        return respond(400, {
          message: 'A document cannot be moved under one of its descendants.',
        })
      }

      await req.payload.update({
        collection: collectionSlug as never,
        context: {
          [pageTreeMoveContextKey]: true,
        },
        data: {
          [parentFieldSlug]:
            body.parentID === null
              ? null
              : toCollectionID({
                  collectionSlug,
                  id: body.parentID,
                  req,
                }),
        } as never,
        depth: 0,
        draft: collectionHasDrafts({ collectionSlug, req }) ? true : undefined,
        id: movedID as never,
        locale: getRequestedLocale(req) as never,
        overrideAccess: true,
        req,
      } as never)

      return respond(200, {
        movedID: movedIDFromRoute,
        ok: true,
        parentID: body.parentID,
      })
    },
    method: 'post',
    path: '/:id/move',
  }
}
