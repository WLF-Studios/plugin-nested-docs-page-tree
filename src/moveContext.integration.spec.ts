import type { CollectionConfig, Endpoint, Payload, PayloadRequest } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, createPayloadRequest, getPayload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { nestedDocsPageTreePlugin } from './index.js'
import {
  pageTreeMoveContextKey,
  pageTreeMoveRequestHeader,
  pageTreeMoveRequestHeaderValue,
} from './types.js'

let deployHookCalls = 0
let memoryDB: MongoMemoryReplSet | undefined
let payload: Payload | undefined
let payloadConfig: Awaited<ReturnType<typeof buildConfig>>

const Pages: CollectionConfig = {
  slug: 'pages',
  orderable: true,
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
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'parent',
      relationTo: 'pages',
      type: 'relationship',
    },
    {
      fields: [
        {
          name: 'label',
          type: 'text',
        },
      ],
      name: 'breadcrumbs',
      type: 'array',
    },
  ],
  hooks: {
    afterChange: [
      ({ req }) => {
        if (req.context?.[pageTreeMoveContextKey]) {
          return
        }

        deployHookCalls += 1
      },
    ],
  },
}

function getDocID(doc: Record<string, unknown>): number | string {
  if (typeof doc.id === 'number' || typeof doc.id === 'string') {
    return doc.id
  }

  throw new Error('Expected document to have an ID.')
}

function getOrderKey(doc: Record<string, unknown>): string {
  if (typeof doc._order === 'string') {
    return doc._order
  }

  throw new Error('Expected orderable document to have an _order value.')
}

function getReorderEndpoint(): Endpoint {
  const endpoint = payload?.config.endpoints?.find(
    (candidate) => candidate.path === '/reorder' && candidate.method === 'post',
  )

  if (!endpoint) {
    throw new Error('Could not resolve the Payload reorder endpoint.')
  }

  return endpoint
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

async function createPage(title: string): Promise<Record<string, unknown>> {
  if (!payload) {
    throw new Error('Payload was not initialized.')
  }

  return payload.create({
    collection: 'pages',
    data: {
      title,
    },
    disableTransaction: true,
    overrideAccess: true,
  } as never) as Promise<Record<string, unknown>>
}

async function invokePageTreeMove(args: {
  movedDoc: Record<string, unknown>
  parentDoc: Record<string, unknown>
}): Promise<Response> {
  const { movedDoc, parentDoc } = args
  const movedID = getDocID(movedDoc)
  const request = new Request(`http://localhost:3000/api/pages/${movedID}/move`, {
    body: JSON.stringify({
      parentID: String(getDocID(parentDoc)),
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })
  const payloadRequest = (await createPayloadRequest({
    config: payloadConfig,
    request,
  })) as PayloadRequest & {
    routeParams?: Record<string, string>
  }

  payloadRequest.routeParams = { id: String(movedID) }

  return getMoveEndpoint().handler(payloadRequest)
}

async function invokePayloadReorder(args: {
  includePageTreeMoveSignal: boolean
  movedDoc: Record<string, unknown>
  targetDoc: Record<string, unknown>
}): Promise<Response> {
  const { includePageTreeMoveSignal, movedDoc, targetDoc } = args
  const headers = new Headers({
    'Content-Type': 'application/json',
  })

  if (includePageTreeMoveSignal) {
    headers.set(pageTreeMoveRequestHeader, pageTreeMoveRequestHeaderValue)
  }

  const request = new Request('http://localhost:3000/api/reorder', {
    body: JSON.stringify({
      collectionSlug: 'pages',
      docsToMove: [getDocID(movedDoc)],
      newKeyWillBe: 'less',
      orderableFieldName: '_order',
      target: {
        id: getDocID(targetDoc),
        key: getOrderKey(targetDoc),
      },
    }),
    headers,
    method: 'POST',
  })
  const payloadRequest = (await createPayloadRequest({
    config: payloadConfig,
    request,
  })) as PayloadRequest

  // Bridge hook requires an authenticated request; tests stub a user directly
  // since this suite does not exercise Payload's auth flow.
  ;(payloadRequest as { user?: unknown }).user = { id: 'test-user' }

  return getReorderEndpoint().handler(payloadRequest)
}

describe('page-tree move context integration', () => {
  beforeAll(async () => {
    memoryDB = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        dbName: `page-tree-move-context-${Date.now()}`,
      },
    })
    payloadConfig = await buildConfig({
      collections: [Pages],
      db: mongooseAdapter({
        url: `${memoryDB.getUri()}&retryWrites=true`,
      }),
      plugins: [
        nestedDocsPageTreePlugin({
          collections: ['pages'],
        }),
      ],
      secret: 'test-secret',
    })
    payload = await getPayload({ config: payloadConfig })
  }, 120_000)

  beforeEach(() => {
    deployHookCalls = 0
  })

  afterAll(async () => {
    await payload?.destroy()
    await memoryDB?.stop()
  })

  it('does not call rebuild hooks for plugin-owned parent moves', async () => {
    const movedDoc = await createPage('Move me')
    const parentDoc = await createPage('New parent')

    deployHookCalls = 0

    const response = await invokePageTreeMove({
      movedDoc,
      parentDoc,
    })

    expect(response.status).toBe(200)
    expect(deployHookCalls).toBe(0)
  })

  it('does not call rebuild hooks for page-tree reorder requests', async () => {
    const movedDoc = await createPage('Reorder me')
    const targetDoc = await createPage('Reorder target')

    deployHookCalls = 0

    const response = await invokePayloadReorder({
      includePageTreeMoveSignal: true,
      movedDoc,
      targetDoc,
    })

    expect(response.status).toBe(200)
    expect(deployHookCalls).toBe(0)
  })

  it('would call rebuild hooks for the same reorder without the page-tree signal', async () => {
    const movedDoc = await createPage('Ordinary reorder')
    const targetDoc = await createPage('Ordinary target')

    deployHookCalls = 0

    const response = await invokePayloadReorder({
      includePageTreeMoveSignal: false,
      movedDoc,
      targetDoc,
    })

    expect(response.status).toBe(200)
    expect(deployHookCalls).toBe(1)
  })
})
