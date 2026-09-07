import type { CollectionConfig, Endpoint, Payload } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, createPayloadRequest, getPayload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { NestedDocsPageTreePluginDiagnosticEvent } from './types.js'

import { createMovePageEndpoint } from './endpoints/createMovePageEndpoint.js'
import { nestedDocsPageTreePlugin } from './index.js'
import { resolveDiagnostics } from './utilities/diagnostics.js'

let collectedEvents: NestedDocsPageTreePluginDiagnosticEvent[] = []
let memoryDB: MongoMemoryReplSet | undefined
let payload: Payload | undefined
let payloadConfig: Awaited<ReturnType<typeof buildConfig>>

function appendConnectionOption(uri: string, option: string): string {
  return `${uri}${uri.includes('?') ? '&' : '?'}${option}`
}

const Pages: CollectionConfig = {
  slug: 'pages',
  access: {
    create: () => true,
    delete: () => true,
    read: () => true,
    update: () => true,
  },
  admin: {
    useAsTitle: 'title',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'parent', relationTo: 'pages', type: 'relationship' },
    {
      fields: [{ name: 'label', type: 'text' }],
      name: 'breadcrumbs',
      type: 'array',
    },
  ],
  versions: {
    drafts: true,
  },
}

function getDocID(doc: { id?: unknown }): number | string {
  if (typeof doc.id === 'number' || typeof doc.id === 'string') {
    return doc.id
  }

  throw new Error('Expected document to have an ID.')
}

function getMoveEndpoint(): Endpoint {
  const endpoints = payload?.collections.pages.config.endpoints
  const endpoint = Array.isArray(endpoints)
    ? endpoints.find((candidate) => candidate.path === '/:id/move' && candidate.method === 'post')
    : undefined

  if (!endpoint) {
    throw new Error('Could not resolve the page-tree move endpoint.')
  }

  return endpoint
}

async function createPage(title: string) {
  if (!payload) {
    throw new Error('Payload was not initialized.')
  }

  return payload.create({
    collection: 'pages',
    data: { title },
    disableTransaction: true,
    overrideAccess: true,
  })
}

async function createPublishedPage(title: string) {
  if (!payload) {
    throw new Error('Payload was not initialized.')
  }

  return payload.create({
    collection: 'pages',
    data: { _status: 'published', title },
    disableTransaction: true,
    draft: false,
    overrideAccess: true,
  })
}

async function invokePageTreeMove(args: {
  endpoint?: Endpoint
  movedDoc: { id?: unknown }
  parentDoc: { id?: unknown }
}): Promise<Response> {
  const { endpoint, movedDoc, parentDoc } = args
  const movedID = getDocID(movedDoc)
  const body: Record<string, unknown> = { parentID: String(getDocID(parentDoc)) }
  const request = new Request(`http://localhost:3000/api/pages/${movedID}/move`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  const payloadRequest = await createPayloadRequest({
    config: payloadConfig,
    request,
  })

  payloadRequest.routeParams = { id: String(movedID) }

  return (endpoint ?? getMoveEndpoint()).handler(payloadRequest)
}

describe('page-tree diagnostics integration', () => {
  beforeAll(async () => {
    const dbName = `page_tree_diagnostics_${Date.now()}_${process.pid}`

    memoryDB = await MongoMemoryReplSet.create({
      replSet: { count: 1, dbName },
    })
    payloadConfig = await buildConfig({
      collections: [Pages],
      db: mongooseAdapter({
        url: appendConnectionOption(memoryDB.getUri(dbName), 'retryWrites=true'),
      }),
      plugins: [
        nestedDocsPageTreePlugin({
          collections: ['pages'],
          diagnostics: {
            enabled: true,
            logger: (event) => {
              collectedEvents.push(event)
            },
          },
        }),
      ],
      secret: 'test-secret',
    })
    payload = await getPayload({ config: payloadConfig })
  }, 120_000)

  beforeEach(() => {
    collectedEvents = []
  })

  afterAll(async () => {
    await payload?.destroy()
    await memoryDB?.stop()
  })

  it(
    'emits move-endpoint enter and ok events with snapshots and a flow id',
    { retry: 3 },
    async () => {
      const movedDoc = await createPage('Diag move')
      const parentDoc = await createPage('Diag parent')

      collectedEvents = []

      const response = await invokePageTreeMove({ movedDoc, parentDoc })

      expect(response.status).toBe(200)

      const enterEvent = collectedEvents.find((event) => event.source === 'move-endpoint:enter')
      const okEvent = collectedEvents.find((event) => event.source === 'move-endpoint:ok')

      expect(enterEvent).toBeDefined()
      expect(okEvent).toBeDefined()
      expect(enterEvent?.flow).toBe(okEvent?.flow)
      expect(enterEvent?.flow.startsWith('move-endpoint-')).toBe(true)
      expect(enterEvent?.data).toHaveProperty('publishedMainRowBefore')
      expect(okEvent?.data).toHaveProperty('publishedMainRowAfter')
      expect(enterEvent?.data.movedID).toBe(String(getDocID(movedDoc)))
    },
  )

  it('emits a page-tree-change:after event sharing the move flow id', { retry: 3 }, async () => {
    const movedDoc = await createPage('Diag chain move')
    const parentDoc = await createPage('Diag chain parent')

    collectedEvents = []

    await invokePageTreeMove({ movedDoc, parentDoc })

    const enterEvent = collectedEvents.find((event) => event.source === 'move-endpoint:enter')
    const changeEvent = collectedEvents.find((event) => event.source === 'page-tree-change:after')

    expect(enterEvent).toBeDefined()
    expect(changeEvent).toBeDefined()
    expect(changeEvent?.flow).toBe(enterEvent?.flow)
    expect(changeEvent?.data.docID).toBe(String(getDocID(movedDoc)))
    expect(Array.isArray(changeEvent?.data.changed)).toBe(true)
  })

  it(
    'still emits page-tree-change events when publishOnMove publishes the move',
    { retry: 3 },
    async () => {
      const movedDoc = await createPublishedPage('Diag publish move')
      const parentDoc = await createPublishedPage('Diag publish parent')

      collectedEvents = []

      const response = await invokePageTreeMove({
        endpoint: createMovePageEndpoint({
          collectionSlug: 'pages',
          diagnostics: resolveDiagnostics({
            enabled: true,
            logger: (event) => {
              collectedEvents.push(event)
            },
          }),
          parentFieldSlug: 'parent',
          publishOnMove: true,
        }),
        movedDoc,
        parentDoc,
      })

      expect(response.status).toBe(200)

      const enterEvent = collectedEvents.find((event) => event.source === 'move-endpoint:enter')
      const changeEvent = collectedEvents.find((event) => event.source === 'page-tree-change:after')

      expect(enterEvent?.data.publishMove).toBe(true)
      // The published move withholds the deploy opt-out flag; diagnostics is
      // gated on the separate write flag so it must still fire here.
      expect(changeEvent).toBeDefined()
      expect(changeEvent?.data.changed).toContain('parent')
    },
  )

  it('passes draft: true on plain-drafts collections', async () => {
    const movedDoc = await createPage('Diag drafts-only move')
    const parentDoc = await createPage('Diag drafts-only parent')

    collectedEvents = []

    await invokePageTreeMove({ movedDoc, parentDoc })

    const enterEvent = collectedEvents.find((event) => event.source === 'move-endpoint:enter')

    expect(enterEvent?.data.draft).toBe(true)
  })

  it('emits a move-endpoint:body-rejected event on a malformed body', async () => {
    const movedDoc = await createPage('Diag body reject move')
    const movedID = getDocID(movedDoc)
    const request = new Request(`http://localhost:3000/api/pages/${movedID}/move`, {
      body: JSON.stringify({ wrong: 'shape' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    const payloadRequest = await createPayloadRequest({
      config: payloadConfig,
      request,
    })

    payloadRequest.routeParams = { id: String(movedID) }

    collectedEvents = []

    const response = await getMoveEndpoint().handler(payloadRequest)

    expect(response.status).toBe(400)

    const rejectEvent = collectedEvents.find(
      (event) => event.source === 'move-endpoint:body-rejected',
    )

    expect(rejectEvent).toBeDefined()
    expect(rejectEvent?.level).toBe('warn')
    expect(rejectEvent?.data.rawBody).toEqual({ wrong: 'shape' })
  })
})
