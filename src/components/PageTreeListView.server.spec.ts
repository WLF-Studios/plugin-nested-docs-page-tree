import type { PayloadRequest } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import { NestedDocsPageTreeListView } from './PageTreeListView.server.js'

vi.mock('@payloadcms/ui/rsc', () => ({
  getColumns: vi.fn(),
  renderTable: vi.fn(),
}))

vi.mock('@payloadcms/ui/utilities/getClientConfig', () => ({
  getClientConfig: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers({ cookie: 'payload-tenant=tenant-1' }))),
}))

vi.mock('./PageTreeListView.client.js', () => ({
  default: vi.fn(),
}))

describe('NestedDocsPageTreeListView', () => {
  it('passes the incoming request headers to the collection base filter', async () => {
    const baseFilter = ({ req }: { req: PayloadRequest }) => {
      throw new Error(req.headers.get('cookie') ?? '')
    }

    await expect(
      NestedDocsPageTreeListView({
        collectionConfig: {
          admin: {
            baseFilter,
            useAsTitle: 'title',
          },
          custom: {
            nestedDocsPageTreePlugin: {
              badges: {
                colors: {},
                labels: {},
              },
              breadcrumbsFieldSlug: 'breadcrumbs',
              defaultLimit: 100,
              hideBreadcrumbs: true,
              homeIndicator: {
                enabled: false,
              },
              parentFieldSlug: 'parent',
            },
          },
        },
        collectionSlug: 'pages',
        data: {
          page: 1,
        },
        listPreferences: {},
        payload: {},
        user: null,
      }),
    ).rejects.toThrow('payload-tenant=tenant-1')
  })
})
