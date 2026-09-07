import type { PayloadRequest } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import type { NestedDocsPageTreePluginDiagnosticEvent } from '../types.js'

import { pageTreeMoveContextKey } from '../types.js'
import { resolveDiagnostics } from '../utilities/diagnostics.js'
import { createReorderPageEndpoint } from './createReorderPageEndpoint.js'

type CollectionConfig = {
  access?: { update?: unknown }
  versions?: { drafts?: { autosave?: unknown } | boolean }
}

function makeReq(args?: {
  body?: Record<string, unknown>
  collectionConfig?: CollectionConfig
  docs?: Record<string, unknown>[]
  latestDraftVersion?: Record<string, unknown>
  mainDoc?: Record<string, unknown>
}) {
  const updateCalls: Record<string, unknown>[] = []
  const versionUpdateCalls: Record<string, unknown>[] = []
  const context: Record<string, unknown> = {}
  const body = args?.body ?? {
    docsToMove: ['abc'],
    newKeyWillBe: 'greater',
    orderableFieldName: '_order',
    target: {
      id: 'target-id',
      key: 'a1',
    },
  }
  const collection = {
    config: args?.collectionConfig ?? { versions: undefined },
    customIDType: undefined,
  }
  const docs = args?.docs ?? [
    { id: 'abc', _order: 'a0', _status: 'published', parent: null },
    { id: 'target-id', _order: 'a1', _status: 'published', parent: null },
  ]
  const mainDoc = args?.mainDoc ?? docs[0]
  const fakeRequest = new Request('http://localhost:3000/api/pages/abc/reorder', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  const req = {
    context,
    data: body,
    headers: fakeRequest.headers,
    i18n: { t: (key: string) => key },
    json: () => fakeRequest.clone().json(),
    payload: {
      collections: { pages: collection },
      config: { custom: { allowPageMoves: true } },
      db: {
        defaultIDType: 'text',
        findVersions: vi.fn(() =>
          Promise.resolve({
            docs: args?.latestDraftVersion ? [args.latestDraftVersion] : [],
          }),
        ),
        updateOne: vi.fn((input: Record<string, unknown>) => {
          updateCalls.push(input)

          return Promise.resolve(null)
        }),
        updateVersion: vi.fn((input: Record<string, unknown>) => {
          versionUpdateCalls.push(input)

          return Promise.resolve(null)
        }),
      },
      find: vi.fn((input: { where?: Record<string, unknown> }) => {
        if ('id' in (input.where ?? {})) {
          return Promise.resolve({
            docs,
            totalDocs: docs.length,
          })
        }

        return Promise.resolve({ docs: [] })
      }),
      findByID: vi.fn(() => Promise.resolve(mainDoc)),
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      update: vi.fn(),
    },
    query: { tenant: 'tenant-1' },
    routeParams: { id: 'abc' },
    text: () => fakeRequest.clone().text(),
    user: { id: 'tester' },
  } as unknown as PayloadRequest

  return { req, updateCalls, versionUpdateCalls }
}

describe('createReorderPageEndpoint', () => {

  it.each(['request fields', 'pagination metadata'] as const)(
    'supports collection access checks using %s',
    async (check) => {
      const endpoint = createReorderPageEndpoint({
        collectionSlug: 'pages',
        diagnostics: resolveDiagnostics(false),
        orderableFieldName: '_order',
        parentFieldSlug: 'parent',
      })
      const { req } = makeReq({
        collectionConfig: {
          access: {
            update: async ({ req }: { req: PayloadRequest }) => {
              if (check === 'request fields') {
                return req.payload.config.custom?.allowPageMoves === true &&
                  req.query.tenant === 'tenant-1'
              }

              const result = await req.payload.find({
                collection: 'pages',
                where: { id: { equals: 'abc' } },
              })
              return result.totalDocs > 0
            },
          },
        },
      })

      const response = await endpoint.handler(req)

      expect(response.status).toBe(200)
    },
  )
  it('updates the order key silently without using payload.update', async () => {
    const endpoint = createReorderPageEndpoint({
      collectionSlug: 'pages',
      diagnostics: resolveDiagnostics(false),
      orderableFieldName: '_order',
      parentFieldSlug: 'parent',
    })
    const { req, updateCalls, versionUpdateCalls } = makeReq()

    const response = await endpoint.handler(req)
    const body = (await response.json()) as { orderValues?: string[]; success?: boolean }

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.orderValues).toHaveLength(1)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]).toMatchObject({
      id: 'abc',
      collection: 'pages',
      data: {
        _order: body.orderValues?.[0],
        updatedAt: null,
      },
      returning: false,
    })
    expect(versionUpdateCalls).toHaveLength(0)
    expect(req.payload.update).not.toHaveBeenCalled()
    expect(req.context?.[pageTreeMoveContextKey]).toBe(true)
  })

  it('regenerates the order key when the native boundary result would be a no-op', async () => {
    const endpoint = createReorderPageEndpoint({
      collectionSlug: 'pages',
      diagnostics: resolveDiagnostics(false),
      orderableFieldName: '_order',
      parentFieldSlug: 'parent',
    })
    const { req, updateCalls } = makeReq({
      body: {
        docsToMove: ['abc'],
        newKeyWillBe: 'less',
        orderableFieldName: '_order',
        target: {
          id: 'target-id',
          key: 'ae5',
        },
      },
      docs: [
        { id: 'abc', _order: 'ae', _status: 'published', parent: 'parent-id' },
        { id: 'target-id', _order: 'ae5', _status: 'published', parent: 'parent-id' },
      ],
    })

    const response = await endpoint.handler(req)
    const body = (await response.json()) as { orderValues?: string[] }
    const orderValue = body.orderValues?.[0]

    expect(response.status).toBe(200)
    expect(orderValue).toBeTruthy()
    expect(orderValue).not.toBe('ae')
    expect(String(orderValue) > 'ae').toBe(true)
    expect(String(orderValue) < 'ae5').toBe(true)
    expect(updateCalls[0]?.data).toMatchObject({
      _order: orderValue,
      updatedAt: null,
    })
  })

  it('uses the main row order key for no-op detection when draft order is different', async () => {
    const endpoint = createReorderPageEndpoint({
      collectionSlug: 'pages',
      diagnostics: resolveDiagnostics(false),
      orderableFieldName: '_order',
      parentFieldSlug: 'parent',
    })
    const { req, updateCalls } = makeReq({
      body: {
        docsToMove: ['abc'],
        newKeyWillBe: 'less',
        orderableFieldName: '_order',
        target: {
          id: 'target-id',
          key: 'ab95',
        },
      },
      docs: [
        { id: 'abc', _order: 'ab99', _status: 'published', parent: 'parent-id' },
        { id: 'target-id', _order: 'ab95', _status: 'published', parent: 'parent-id' },
      ],
      mainDoc: { id: 'abc', _order: 'ab', _status: 'published', parent: 'parent-id' },
    })

    const response = await endpoint.handler(req)
    const body = (await response.json()) as { orderValues?: string[] }
    const orderValue = body.orderValues?.[0]

    expect(response.status).toBe(200)
    expect(orderValue).toBeTruthy()
    expect(orderValue).not.toBe('ab')
    expect(String(orderValue) > 'ab').toBe(true)
    expect(String(orderValue) < 'ab95').toBe(true)
    expect(updateCalls[0]?.data).toMatchObject({
      _order: orderValue,
      updatedAt: null,
    })
  })

  it('updates the latest draft version in place when one exists', async () => {
    const endpoint = createReorderPageEndpoint({
      collectionSlug: 'pages',
      diagnostics: resolveDiagnostics(false),
      orderableFieldName: '_order',
      parentFieldSlug: 'parent',
    })
    const { req, versionUpdateCalls } = makeReq({
      collectionConfig: { versions: { drafts: true } },
      latestDraftVersion: {
        id: 'version-id',
        createdAt: '2026-01-01T00:00:00.000Z',
        latest: true,
        parent: 'abc',
        updatedAt: '2026-01-02T00:00:00.000Z',
        version: {
          _order: 'a0',
          _status: 'draft',
          title: 'Draft title',
        },
      },
    })

    const response = await endpoint.handler(req)
    const body = (await response.json()) as { orderValues?: string[] }

    expect(response.status).toBe(200)
    expect(versionUpdateCalls).toHaveLength(1)
    expect(versionUpdateCalls[0]).toMatchObject({
      id: 'version-id',
      collection: 'pages',
      returning: false,
      versionData: {
        createdAt: '2026-01-01T00:00:00.000Z',
        latest: true,
        parent: 'abc',
        updatedAt: '2026-01-02T00:00:00.000Z',
        version: {
          _order: body.orderValues?.[0],
          _status: 'draft',
          title: 'Draft title',
        },
      },
    })
  })

  it('updates the latest published version in place for draft-aware list reads', async () => {
    const endpoint = createReorderPageEndpoint({
      collectionSlug: 'pages',
      diagnostics: resolveDiagnostics(false),
      orderableFieldName: '_order',
      parentFieldSlug: 'parent',
    })
    const { req, versionUpdateCalls } = makeReq({
      collectionConfig: { versions: { drafts: true } },
      docs: [
        { id: 'abc', _order: 'aei', _status: 'published', parent: 'parent-id' },
        { id: 'target-id', _order: 'ae5', _status: 'published', parent: 'parent-id' },
      ],
      latestDraftVersion: {
        id: 'published-version-id',
        latest: true,
        parent: 'abc',
        version: {
          slug: 'enterprise',
          _order: 'aei',
          _status: 'published',
          title: 'For Enterprise',
        },
      },
      mainDoc: { id: 'abc', _order: 'ae', _status: 'published', parent: 'parent-id' },
    })

    const response = await endpoint.handler(req)
    const body = (await response.json()) as { orderValues?: string[] }

    expect(response.status).toBe(200)
    expect(versionUpdateCalls).toHaveLength(1)
    expect(versionUpdateCalls[0]).toMatchObject({
      id: 'published-version-id',
      collection: 'pages',
      returning: false,
      versionData: {
        latest: true,
        parent: 'abc',
        version: {
          slug: 'enterprise',
          _order: body.orderValues?.[0],
          _status: 'published',
          title: 'For Enterprise',
        },
      },
    })
  })

  it('emits diagnostics for reorder enter and ok events', async () => {
    const events: NestedDocsPageTreePluginDiagnosticEvent[] = []
    const endpoint = createReorderPageEndpoint({
      collectionSlug: 'pages',
      diagnostics: resolveDiagnostics({
        enabled: true,
        logger: (event) => events.push(event),
      }),
      orderableFieldName: '_order',
      parentFieldSlug: 'parent',
    })
    const { req } = makeReq({
      body: {
        docsToMove: ['abc'],
        frontendOrder: {
          activeSlug: 'moved',
          after: [
            { slug: 'target', index: 0, orderKey: 'a1' },
            { slug: 'moved', index: 1, orderKey: 'a0' },
          ],
          before: [
            { slug: 'moved', index: 0, orderKey: 'a0' },
            { slug: 'target', index: 1, orderKey: 'a1' },
          ],
          moveFromIndex: 0,
          moveToIndex: 1,
          newAfterRowSlug: null,
          newBeforeRowSlug: 'target',
          sort: '_order',
          targetSlug: 'target',
        },
        newKeyWillBe: 'greater',
        orderableFieldName: '_order',
        target: {
          id: 'target-id',
          key: 'a1',
        },
      },
    })

    const response = await endpoint.handler(req)

    expect(response.status).toBe(200)

    const enterEvent = events.find((event) => event.source === 'reorder-endpoint:enter')
    const okEvent = events.find((event) => event.source === 'reorder-endpoint:ok')

    expect(enterEvent).toBeDefined()
    expect(okEvent).toBeDefined()
    expect(enterEvent?.flow).toBe(okEvent?.flow)
    expect(enterEvent?.data).toHaveProperty('mainRowBefore')
    expect(enterEvent?.data).toHaveProperty('frontendOrder')
    expect(okEvent?.data).toHaveProperty('mainRowAfter')
  })
})
