import type { PayloadRequest } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import { NestedDocsPageTreeListView } from './PageTreeListView.server.js'

const uiMocks = vi.hoisted(() => ({
  getColumns: vi.fn(() => []),
  renderTable: vi.fn(() => Promise.resolve({ columnState: [], Table: null })),
}))

const configMocks = vi.hoisted(() => ({
  getClientConfig: vi.fn(),
}))

const payloadMocks = vi.hoisted(() => ({
  extractJWT: vi.fn(() => null),
}))

vi.mock('@payloadcms/ui/rsc', () => uiMocks)

vi.mock('@payloadcms/ui/utilities/getClientConfig', () => configMocks)

vi.mock('payload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('payload')>()),
  extractJWT: payloadMocks.extractJWT,
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers({ cookie: 'payload-tenant=tenant-1' }))),
}))

vi.mock('./PageTreeListView.client.js', () => ({
  default: vi.fn(),
}))

describe('NestedDocsPageTreeListView', () => {
  it('passes the incoming request headers to the collection base filter', async () => {
    let cookie: null | string = null
    const baseFilter = ({ req }: { req: PayloadRequest }) => {
      cookie = req.headers.get('cookie')

      return {}
    }
    const collectionConfig = {
      slug: 'pages',
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
    }
    configMocks.getClientConfig.mockReturnValue({ collections: [collectionConfig] })

    await NestedDocsPageTreeListView({
      collectionConfig,
      collectionSlug: 'pages',
      columnState: [],
      data: {
        page: 1,
      },
      i18n: { t: (key: string) => key },
      listPreferences: {},
      payload: {
        config: {
          i18n: { fallbackLanguage: 'en' },
        },
        find: vi.fn(() => Promise.resolve({ docs: [] })),
      },
      user: null,
    })

    expect(cookie).toBe('payload-tenant=tenant-1')
  })

  it('passes both version-specific URLs to the client using a single accessible current-row read', async () => {
    payloadMocks.extractJWT.mockClear()
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
    const secondCurrentDoc = {
      ...currentDoc,
      id: 2,
      slug: 'second-old',
      breadcrumbs: [{ url: '/second-old' }],
    }
    const secondDraftDoc = {
      ...draftDoc,
      id: 2,
      slug: 'second-new',
      breadcrumbs: [{ url: '/second-new' }],
    }
    const find = vi.fn(({ draft, fallbackLocale, locale, overrideAccess }) => {
      expect(overrideAccess).toBe(false)
      expect(locale).toBe('en')
      expect(fallbackLocale).toBe(false)
      return Promise.resolve({
        docs: draft ? [draftDoc, secondDraftDoc] : [currentDoc, secondCurrentDoc],
      })
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
          badgesLinks: { liveURL: 'https://example.com' },
          breadcrumbsFieldSlug: 'breadcrumbs',
          defaultLimit: 100,
          hideBreadcrumbs: true,
          homeIndicator: { enabled: false },
          parentFieldSlug: 'parent',
        },
      },
      versions: { drafts: true },
    }
    configMocks.getClientConfig.mockReturnValue({ collections: [collectionConfig] })
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
    expect(payloadMocks.extractJWT).toHaveBeenCalledTimes(1)
    expect(result.props.badgesLinks).toEqual({ liveURL: 'https://example.com' })
  })
})
