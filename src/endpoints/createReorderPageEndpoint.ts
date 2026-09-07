import type { Endpoint, PayloadRequest, Where } from 'payload'

import { combineWhereConstraints, generateNKeysBetween } from 'payload/shared'

import {
  pageTreeMoveContextKey,
  type PageTreeSourceDoc,
  pageTreeWriteContextKey,
} from '../types.js'
import {
  createFlowID,
  type Diagnostics,
  DIAGNOSTICS_FLOW_CONTEXT_KEY,
  readMainRowSnapshot,
} from '../utilities/diagnostics.js'
import { getDocParentID, stringifyDocID } from '../utilities/pageTree.js'
import {
  assertUpdateAccess,
  collectionHasDrafts,
  getRequestedLocale,
  normalizeID,
  respond,
  toCollectionID,
} from './shared.js'

type ReorderDocumentRequestBody = {
  docsToMove: string[]
  frontendOrder?: ReorderFrontendOrderDiagnostic
  newKeyWillBe: 'greater' | 'less'
  orderableFieldName: string
  target: {
    id: string
    key: null | string
  }
}

type ReorderFrontendOrderDiagnostic = {
  activeSlug: null | string
  after: ReorderFrontendOrderEntry[]
  before: ReorderFrontendOrderEntry[]
  moveFromIndex: number
  moveToIndex: number
  newAfterRowSlug: null | string
  newBeforeRowSlug: null | string
  sort: null | string
  targetSlug: null | string
}

type ReorderFrontendOrderEntry = {
  index: number
  orderKey: null | string
  slug: null | string
}

type ReorderBackendOrderEntry = {
  index: number
  orderKey: null | string
  slug: null | string
  status: null | string
}

type RawBodyAttempt = {
  raw: unknown
  source: 'req.data' | 'req.json' | 'req.text'
}

type VersionRecord = {
  createdAt?: string
  id?: number | string
  latest?: boolean
  parent?: number | string
  publishedLocale?: string
  updatedAt?: string
  version?: Record<string, unknown>
} & Record<string, unknown>

const SNAPSHOT_FIELDS = ['_status'] as const

function hasOwnProperty(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizeOptionalString(value: unknown): null | string {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeFrontendOrderEntry(
  value: unknown,
  fallbackIndex: number,
): null | ReorderFrontendOrderEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const data = value as Record<string, unknown>

  return {
    slug: normalizeOptionalString(data.slug),
    index: typeof data.index === 'number' && Number.isFinite(data.index) ? data.index : fallbackIndex,
    orderKey: normalizeOptionalString(data.orderKey),
  }
}

function normalizeFrontendOrder(value: unknown): ReorderFrontendOrderDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const data = value as Record<string, unknown>

  if (!Array.isArray(data.before) || !Array.isArray(data.after)) {
    return undefined
  }

  const before = data.before
    .slice(0, 250)
    .map((entry, index) => normalizeFrontendOrderEntry(entry, index))
    .filter((entry): entry is ReorderFrontendOrderEntry => Boolean(entry))
  const after = data.after
    .slice(0, 250)
    .map((entry, index) => normalizeFrontendOrderEntry(entry, index))
    .filter((entry): entry is ReorderFrontendOrderEntry => Boolean(entry))

  return {
    activeSlug: normalizeOptionalString(data.activeSlug),
    after,
    before,
    moveFromIndex:
      typeof data.moveFromIndex === 'number' && Number.isFinite(data.moveFromIndex)
        ? data.moveFromIndex
        : -1,
    moveToIndex:
      typeof data.moveToIndex === 'number' && Number.isFinite(data.moveToIndex)
        ? data.moveToIndex
        : -1,
    newAfterRowSlug: normalizeOptionalString(data.newAfterRowSlug),
    newBeforeRowSlug: normalizeOptionalString(data.newBeforeRowSlug),
    sort: normalizeOptionalString(data.sort),
    targetSlug: normalizeOptionalString(data.targetSlug),
  }
}

function normalizeReorderDocumentBody(value: unknown): null | ReorderDocumentRequestBody {
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

  const data = incomingData as Record<string, unknown>
  const target = data.target

  if (!Array.isArray(data.docsToMove) || data.docsToMove.length !== 1) {
    return null
  }

  if (data.newKeyWillBe !== 'greater' && data.newKeyWillBe !== 'less') {
    return null
  }

  if (typeof data.orderableFieldName !== 'string' || data.orderableFieldName.length === 0) {
    return null
  }

  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return null
  }

  const targetData = target as Record<string, unknown>
  const movedID = normalizeID(data.docsToMove[0])
  const targetID = normalizeID(targetData.id)

  if (!movedID || !targetID) {
    return null
  }

  const key = hasOwnProperty(targetData, 'key') ? targetData.key : null

  if (key !== null && key !== undefined && typeof key !== 'string') {
    return null
  }

  return {
    docsToMove: [movedID],
    frontendOrder: normalizeFrontendOrder(data.frontendOrder),
    newKeyWillBe: data.newKeyWillBe,
    orderableFieldName: data.orderableFieldName,
    target: {
      id: targetID,
      key: key || null,
    },
  }
}

async function readBodyFromRequest(
  req: PayloadRequest,
): Promise<{ body: null | ReorderDocumentRequestBody; lastAttempt: null | RawBodyAttempt }> {
  let lastAttempt: null | RawBodyAttempt = null

  if (req.data !== undefined && req.data !== null) {
    lastAttempt = { raw: req.data, source: 'req.data' }
    const directBody = normalizeReorderDocumentBody(req.data)

    if (directBody) {
      return { body: directBody, lastAttempt }
    }
  }

  if (typeof req.json === 'function') {
    try {
      const raw = await req.json()
      lastAttempt = { raw, source: 'req.json' }
      const jsonBody = normalizeReorderDocumentBody(raw)

      if (jsonBody) {
        return { body: jsonBody, lastAttempt }
      }
    } catch {
      // Fall through to the text-based fallback when the runtime does not hydrate req.data.
    }
  }

  if (typeof req.text === 'function') {
    try {
      const raw = await req.text()
      lastAttempt = { raw, source: 'req.text' }
      const textBody = normalizeReorderDocumentBody(raw)

      if (textBody) {
        return { body: textBody, lastAttempt }
      }
    } catch {
      return { body: null, lastAttempt }
    }
  }

  return { body: null, lastAttempt }
}

function getParentScopeWhere(args: {
  parentFieldSlug: string
  parentID: null | number | string
}): Where {
  const { parentFieldSlug, parentID } = args

  return {
    [parentFieldSlug]: {
      equals: parentID,
    },
  } as Where
}

function getOrderableKey(doc: PageTreeSourceDoc | undefined, orderableFieldName: string) {
  const value = doc?.[orderableFieldName]

  return typeof value === 'string' && value.length > 0 ? value : null
}

function getDiagnosticDocString(value: unknown, locale?: string): null | string {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const localizedValue = value as Record<string, unknown>
  const localeValue = locale ? localizedValue[locale] : undefined

  if (typeof localeValue === 'string' && localeValue.length > 0) {
    return localeValue
  }

  const firstString = Object.values(localizedValue).find(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  )

  return firstString ?? null
}

function getBackendOrderEntry(args: {
  doc: PageTreeSourceDoc
  index: number
  locale?: string
  orderableFieldName: string
}): ReorderBackendOrderEntry {
  const { doc, index, locale, orderableFieldName } = args

  return {
    slug: getDiagnosticDocString(doc.slug, locale),
    index,
    orderKey: getOrderableKey(doc, orderableFieldName),
    status: getDiagnosticDocString(doc._status, locale),
  }
}

function getMainRowOrderSnapshot(
  snapshot: null | Record<string, unknown>,
  orderableFieldName: string,
): { orderKey: null | string; status: null | string } | null {
  if (!snapshot) {
    return null
  }

  return {
    orderKey: normalizeOptionalString(snapshot[orderableFieldName]),
    status: normalizeOptionalString(snapshot._status),
  }
}

async function readBackendSiblingOrder(args: {
  collectionSlug: string
  draft?: boolean
  orderableFieldName: string
  parentScopeWhere: Where
  req: PayloadRequest
}): Promise<ReorderBackendOrderEntry[]> {
  const { collectionSlug, draft, orderableFieldName, parentScopeWhere, req } = args
  const locale = getRequestedLocale(req)

  try {
    const result = await req.payload.find({
      collection: collectionSlug,
      depth: 0,
      draft,
      limit: 250,
      locale,
      overrideAccess: true,
      pagination: false,
      req,
      sort: orderableFieldName,
      where: parentScopeWhere,
    })

    return (result.docs as unknown as PageTreeSourceDoc[]).map((doc, index) =>
      getBackendOrderEntry({
        doc,
        index,
        locale,
        orderableFieldName,
      }),
    )
  } catch {
    return []
  }
}

function getOrderValuesBetween(args: {
  adjacentDocKey: null | string
  docsToMoveLength: number
  movedBoundaryKey: null | string
  newKeyWillBe: ReorderDocumentRequestBody['newKeyWillBe']
  targetKey: string
}): { orderValues: string[]; usedMovedKeyBoundary: boolean } {
  const { adjacentDocKey, docsToMoveLength, movedBoundaryKey, newKeyWillBe, targetKey } = args
  const orderValues =
    newKeyWillBe === 'greater'
      ? generateNKeysBetween(targetKey, adjacentDocKey, docsToMoveLength)
      : generateNKeysBetween(adjacentDocKey, targetKey, docsToMoveLength)

  if (orderValues[0] !== movedBoundaryKey) {
    return { orderValues, usedMovedKeyBoundary: false }
  }

  if (newKeyWillBe === 'greater' && movedBoundaryKey && movedBoundaryKey > targetKey) {
    return {
      orderValues: generateNKeysBetween(targetKey, movedBoundaryKey, docsToMoveLength),
      usedMovedKeyBoundary: true,
    }
  }

  if (newKeyWillBe === 'less' && movedBoundaryKey && movedBoundaryKey < targetKey) {
    return {
      orderValues: generateNKeysBetween(movedBoundaryKey, targetKey, docsToMoveLength),
      usedMovedKeyBoundary: true,
    }
  }

  return { orderValues, usedMovedKeyBoundary: false }
}

async function readLatestVersion(args: {
  collectionSlug: string
  id: number | string
  req: PayloadRequest
}): Promise<null | VersionRecord> {
  const { id, collectionSlug, req } = args
  const versions = await req.payload.db.findVersions({
    collection: collectionSlug,
    limit: 1,
    pagination: false,
    req,
    sort: '-updatedAt',
    where: {
      latest: {
        equals: true,
      },
      parent: {
        equals: id,
      },
    },
  })
  const latestVersion = versions.docs[0] as undefined | VersionRecord

  if (!latestVersion?.version) {
    return null
  }

  return latestVersion
}

async function updateLatestVersionOrder(args: {
  collectionSlug: string
  id: number | string
  orderableFieldName: string
  orderValue: string
  req: PayloadRequest
}): Promise<boolean> {
  const { id, collectionSlug, orderableFieldName, orderValue, req } = args
  const latestVersion = await readLatestVersion({
    id,
    collectionSlug,
    req,
  })

  if (!latestVersion?.id || !latestVersion.version) {
    return false
  }

  await req.payload.db.updateVersion({
    id: latestVersion.id,
    collection: collectionSlug,
    locale: getRequestedLocale(req),
    req,
    returning: false,
    versionData: {
      createdAt: latestVersion.createdAt,
      latest: latestVersion.latest,
      parent: id,
      publishedLocale: latestVersion.publishedLocale,
      updatedAt: latestVersion.updatedAt,
      version: {
        ...latestVersion.version,
        [orderableFieldName]: orderValue,
      },
    },
  })

  return true
}

async function updateOrderValueSilently(args: {
  collectionSlug: string
  hasDrafts: boolean
  id: number | string
  orderableFieldName: string
  orderValue: string
  req: PayloadRequest
}): Promise<{ updatedDraftVersion: boolean }> {
  const { id, collectionSlug, hasDrafts, orderableFieldName, orderValue, req } = args

  await req.payload.db.updateOne({
    id,
    collection: collectionSlug,
    data: {
      [orderableFieldName]: orderValue,
      updatedAt: null,
    },
    locale: getRequestedLocale(req),
    req,
    returning: false,
  })

  const updatedDraftVersion = hasDrafts
    ? await updateLatestVersionOrder({
        id,
        collectionSlug,
        orderableFieldName,
        orderValue,
        req,
      })
    : false

  return {
    updatedDraftVersion,
  }
}

async function initializeMissingOrderKeys(args: {
  collectionSlug: string
  diagnostics: Diagnostics
  flow: string
  hasDrafts: boolean
  orderableFieldName: string
  parentScopeWhere: Where
  req: PayloadRequest
}): Promise<Response> {
  const { collectionSlug, diagnostics, flow, hasDrafts, orderableFieldName, parentScopeWhere, req } =
    args
  const existingOrderedDocs = await req.payload.find({
    collection: collectionSlug,
    depth: 0,
    draft: hasDrafts ? true : undefined,
    limit: 1,
    locale: getRequestedLocale(req),
    overrideAccess: true,
    pagination: false,
    req,
    select: { [orderableFieldName]: true },
    sort: `-${orderableFieldName}`,
    where: combineWhereConstraints([
      {
        [orderableFieldName]: {
          exists: true,
        },
      },
      parentScopeWhere,
    ]),
  })
  const missingOrderDocs = await req.payload.find({
    collection: collectionSlug,
    depth: 0,
    draft: hasDrafts ? true : undefined,
    limit: 0,
    locale: getRequestedLocale(req),
    overrideAccess: true,
    pagination: false,
    req,
    select: { [orderableFieldName]: true },
    where: combineWhereConstraints([
      {
        [orderableFieldName]: {
          exists: false,
        },
      },
      parentScopeWhere,
    ]),
  })
  const lastOrderValue = getOrderableKey(
    existingOrderedDocs.docs[0] as unknown as PageTreeSourceDoc | undefined,
    orderableFieldName,
  )
  const orderValues = generateNKeysBetween(lastOrderValue, null, missingOrderDocs.docs.length)

  for (const [index, doc] of (missingOrderDocs.docs as unknown as PageTreeSourceDoc[]).entries()) {
    const docID = doc.id
    const orderValue = orderValues[index]

    if (
      orderValue &&
      (typeof docID === 'number' || typeof docID === 'string')
    ) {
      await updateOrderValueSilently({
        id: docID,
        collectionSlug,
        hasDrafts,
        orderableFieldName,
        orderValue,
        req,
      })
    }
  }

  diagnostics.log({
    collection: collectionSlug,
    data: {
      initializedCount: missingOrderDocs.docs.length,
      orderableFieldName,
    },
    flow,
    level: 'info',
    message: 'reorder endpoint initialized missing order keys',
    source: 'reorder-endpoint:initial-migration',
  })

  return respond(200, {
    message: 'initial migration',
    success: true,
  })
}

export function createReorderPageEndpoint(args: {
  collectionSlug: string
  diagnostics: Diagnostics
  orderableFieldName: string
  parentFieldSlug: string
}): Endpoint {
  const { collectionSlug, diagnostics, orderableFieldName, parentFieldSlug } = args
  const snapshotFields = [...SNAPSHOT_FIELDS, parentFieldSlug, orderableFieldName]

  return {
    handler: async (req) => {
      const movedIDFromRoute = normalizeID(req.routeParams?.id)

      if (!movedIDFromRoute) {
        return respond(400, {
          message: 'Document ID was not specified.',
        })
      }

      const { body, lastAttempt } = await readBodyFromRequest(req)

      if (
        !body ||
        body.orderableFieldName !== orderableFieldName ||
        body.docsToMove[0] !== movedIDFromRoute
      ) {
        if (diagnostics.enabled) {
          diagnostics.log({
            collection: collectionSlug,
            data: {
              movedID: movedIDFromRoute,
              rawBody: lastAttempt?.raw ?? null,
              rawBodySource: lastAttempt?.source ?? null,
            },
            flow: createFlowID('reorder-endpoint'),
            level: 'warn',
            message: 'reorder endpoint rejected request body',
            source: 'reorder-endpoint:body-rejected',
          })
        }

        return respond(400, {
          message: 'A valid reorder request is required.',
        })
      }

      if (body.target.id === movedIDFromRoute) {
        return respond(400, {
          message: 'Document is already in that position.',
        })
      }

      const movedID = toCollectionID({
        id: movedIDFromRoute,
        collectionSlug,
        req,
      })
      const targetID = toCollectionID({
        id: body.target.id,
        collectionSlug,
        req,
      })
      const accessError = await assertUpdateAccess({
        id: movedID,
        collectionSlug,
        data: {},
        req,
      })

      if (accessError) {
        return accessError
      }

      const flow = createFlowID('reorder-endpoint')
      const reorderStart = Date.now()
      const hasDrafts = collectionHasDrafts({ collectionSlug, req })

      if (!req.context) {
        req.context = {}
      }

      // A reorder only writes the order key, never publishing state, so it
      // always carries the deploy opt-out flag.
      req.context[pageTreeMoveContextKey] = true
      req.context[pageTreeWriteContextKey] = true
      req.context[DIAGNOSTICS_FLOW_CONTEXT_KEY] = flow

      const relatedDocsResult = await req.payload.find({
        collection: collectionSlug,
        depth: 0,
        draft: hasDrafts ? true : undefined,
        limit: 2,
        locale: getRequestedLocale(req),
        overrideAccess: true,
        req,
        where: {
          id: {
            in: [movedID, targetID],
          },
        },
      })
      const docsByID = new Map(
        (relatedDocsResult.docs as unknown as PageTreeSourceDoc[]).map((doc) => [
          stringifyDocID(doc.id),
          doc,
        ]),
      )
      const movedDoc = docsByID.get(movedIDFromRoute)
      const targetDoc = docsByID.get(body.target.id)

      if (!movedDoc) {
        return respond(404, {
          message: 'Document not found.',
        })
      }

      if (!targetDoc) {
        return respond(400, {
          message: 'Target document not found.',
        })
      }

      const movedParentID = getDocParentID(movedDoc, parentFieldSlug)
      const targetParentID = getDocParentID(targetDoc, parentFieldSlug)

      if (movedParentID !== targetParentID) {
        return respond(400, {
          message: 'Documents can only be reordered within the same parent.',
        })
      }

      const parentScopeWhere = getParentScopeWhere({
        parentFieldSlug,
        parentID:
          movedParentID === null
            ? null
            : toCollectionID({
                id: movedParentID,
                collectionSlug,
                req,
              }),
      })

      if (!body.target.key) {
        return initializeMissingOrderKeys({
          collectionSlug,
          diagnostics,
          flow,
          hasDrafts,
          orderableFieldName,
          parentScopeWhere,
          req,
        })
      }

      const beforeSnapshot = await readMainRowSnapshot({
        id: movedID,
        collectionSlug,
        fields: snapshotFields,
        req,
      })
      const backendDraftOrderBefore = diagnostics.enabled
        ? await readBackendSiblingOrder({
            collectionSlug,
            draft: hasDrafts ? true : undefined,
            orderableFieldName,
            parentScopeWhere,
            req,
          })
        : null
      const backendMainOrderBefore = diagnostics.enabled
        ? await readBackendSiblingOrder({
            collectionSlug,
            draft: false,
            orderableFieldName,
            parentScopeWhere,
            req,
          })
        : null
      const adjacentDoc = await req.payload.find({
        collection: collectionSlug,
        depth: 0,
        draft: hasDrafts ? true : undefined,
        limit: 1,
        locale: getRequestedLocale(req),
        overrideAccess: true,
        pagination: false,
        req,
        select: { [orderableFieldName]: true },
        sort: body.newKeyWillBe === 'greater' ? orderableFieldName : `-${orderableFieldName}`,
        where: combineWhereConstraints([
          {
            [orderableFieldName]: {
              [body.newKeyWillBe === 'greater' ? 'greater_than' : 'less_than']: body.target.key,
            },
          },
          parentScopeWhere,
        ]),
      })
      const adjacentDocKey = getOrderableKey(
        adjacentDoc.docs[0] as unknown as PageTreeSourceDoc | undefined,
        orderableFieldName,
      )
      const movedDocKey = getOrderableKey(movedDoc, orderableFieldName)
      const movedSlug = getDiagnosticDocString(movedDoc.slug, getRequestedLocale(req))
      const targetSlug = getDiagnosticDocString(targetDoc.slug, getRequestedLocale(req))
      const movedMainRowKey =
        typeof beforeSnapshot?.[orderableFieldName] === 'string' &&
        beforeSnapshot[orderableFieldName].length > 0
          ? beforeSnapshot[orderableFieldName]
          : movedDocKey
      const { orderValues, usedMovedKeyBoundary } = getOrderValuesBetween({
        adjacentDocKey,
        docsToMoveLength: body.docsToMove.length,
        movedBoundaryKey: movedMainRowKey,
        newKeyWillBe: body.newKeyWillBe,
        targetKey: body.target.key,
      })
      const orderValue = orderValues[0]

      if (!orderValue) {
        return respond(500, {
          message: 'Could not generate a new order key.',
        })
      }

      if (diagnostics.enabled) {
        diagnostics.log({
          collection: collectionSlug,
          data: {
            adjacentDocKey,
            backendOrderBefore: {
              draft: backendDraftOrderBefore,
              main: backendMainOrderBefore,
            },
            frontendOrder: body.frontendOrder ?? null,
            mainRowBefore: getMainRowOrderSnapshot(beforeSnapshot, orderableFieldName),
            movedDocKey,
            movedMainRowKey,
            movedSlug,
            newKeyWillBe: body.newKeyWillBe,
            orderableFieldName,
            orderValue,
            target: {
              slug: targetSlug,
              key: body.target.key,
            },
            usedMovedKeyBoundary,
          },
          flow,
          level: 'info',
          message: 'reorder endpoint entering: order key update only',
          source: 'reorder-endpoint:enter',
        })
      }

      try {
        const updateResult = await updateOrderValueSilently({
          id: movedID,
          collectionSlug,
          hasDrafts,
          orderableFieldName,
          orderValue,
          req,
        })

        if (diagnostics.enabled) {
          const afterSnapshot = await readMainRowSnapshot({
            id: movedID,
            collectionSlug,
            fields: snapshotFields,
            req,
          })
          const backendDraftOrderAfter = await readBackendSiblingOrder({
            collectionSlug,
            draft: hasDrafts ? true : undefined,
            orderableFieldName,
            parentScopeWhere,
            req,
          })
          const backendMainOrderAfter = await readBackendSiblingOrder({
            collectionSlug,
            draft: false,
            orderableFieldName,
            parentScopeWhere,
            req,
          })

          diagnostics.log({
            collection: collectionSlug,
            data: {
              backendOrderAfter: {
                draft: backendDraftOrderAfter,
                main: backendMainOrderAfter,
              },
              durMs: Date.now() - reorderStart,
              mainRowAfter: getMainRowOrderSnapshot(afterSnapshot, orderableFieldName),
              movedSlug,
              orderValue,
              updatedDraftVersion: updateResult.updatedDraftVersion,
            },
            flow,
            level: 'info',
            message: 'reorder endpoint order key update succeeded',
            source: 'reorder-endpoint:ok',
          })
        }
      } catch (err) {
        const error = err as { data?: unknown; message?: string; name?: string } & Error

        diagnostics.log({
          collection: collectionSlug,
            data: {
              name: error?.name,
              data: error?.data ?? null,
              durMs: Date.now() - reorderStart,
              message: error?.message,
              movedSlug,
            },
          flow,
          level: 'error',
          message: `reorder endpoint order key update failed: ${error?.message ?? 'unknown error'}`,
          source: 'reorder-endpoint:error',
        })

        throw err
      }

      return respond(200, {
        movedID: movedIDFromRoute,
        orderValues,
        success: true,
      })
    },
    method: 'post',
    path: '/:id/reorder',
  }
}
