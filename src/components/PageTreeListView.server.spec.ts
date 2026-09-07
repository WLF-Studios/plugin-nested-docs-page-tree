import type { PayloadRequest } from 'payload'

import { getColumns, renderTable } from '@payloadcms/ui/rsc'
import { getClientConfig } from '@payloadcms/ui/utilities/getClientConfig'
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
        i18n: { t: (key: string) => key },
        listPreferences: {},
        payload: { config: { i18n: { fallbackLanguage: 'en' } } },
        user: null,
      }),
    ).rejects.toThrow('payload-tenant=tenant-1')
  })

  it('passes both version-specific URLs to the client using a single accessible current-row read', async () => {
    const currentDoc = {
      id: 1,
      slug: 'old',
      _status: 'published',
      breadcrumbs: [{ url: '/parent/old' }],
    }
    const draftDoc = {
      id: 1,
      slug: 'new',
      _status: 'draft',
      breadcrumbs: [{ url: '/new-parent/new' }],
    }
    const find = vi.fn(({ draft, fallbackLocale, locale, overrideAccess }) => {
      expect(overrideAccess).toBe(false)
      expect(locale).toBe('en')
      expect(fallbackLocale).toBe(false)
      return Promise.resolve({ docs: draft ? [draftDoc] : [currentDoc] })
    })
    const collectionConfig = {
      slug: 'pages',
      admin: {
        preview: (doc: typeof draftDoc, { req }: { req: PayloadRequest }) =>
          `${req.protocol}//${req.host}/preview${doc.breadcrumbs[0].url}`,
        useAsTitle: 'title',
      },
      custom: {
        nestedDocsPageTreePlugin: {
          badges: { colors: {}, labels: {} },
          breadcrumbsFieldSlug: 'breadcrumbs',
          defaultLimit: 100,
          badgesLinks: { liveURL: 'https://example.com' },
          hideBreadcrumbs: true,
          homeIndicator: { enabled: false },
          parentFieldSlug: 'parent',
        },
      },
      versions: { drafts: true },
    }
    vi.mocked(getClientConfig).mockReturnValue({ collections: [collectionConfig] } as never)
    vi.mocked(getColumns).mockReturnValue([])
    vi.mocked(renderTable).mockResolvedValue({ columnState: [] } as never)
    const result = await NestedDocsPageTreeListView({
      collectionConfig,
      collectionSlug: 'pages',
      columnState: [],
      data: { page: 1 },
      i18n: { t: (key: string) => key },
      locale: { code: 'en' },
      payload: {
        config: {
          auth: { jwtOrder: ['cookie'] },
          cookiePrefix: 'payload',
          csrf: [],
          serverURL: 'https://cms.example.com',
        },
        find,
        logger: { error: vi.fn() },
      },
    })
    expect(result.props.sourceDocs[0]).toMatchObject({
      slug: 'new',
      __pageTreeStatusLinks: {
        previewURL: 'https://cms.example.com/preview/new-parent/new',
        publicURL: 'https://example.com/parent/old',
      },
      _displayStatus: 'changed',
    })
    expect(result.props.allDocs[0].__pageTreeStatusLinks).toEqual(
      result.props.sourceDocs[0].__pageTreeStatusLinks,
    )
    expect(find).toHaveBeenCalledTimes(2)
    expect(result.props.badgesLinks).toEqual({ liveURL: 'https://example.com' })
  })
})
