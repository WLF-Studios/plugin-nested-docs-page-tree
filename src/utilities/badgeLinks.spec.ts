import { describe, expect, it, vi } from 'vitest'

import { type BadgeLinkCollectionConfig, resolvePageTreeBadgeLinks } from './badgeLinks.js'

function fixture() {
  const req = {
    locale: 'en',
    payload: {
      logger: { error: vi.fn() },
    },
    url: 'https://cms.example.com/admin/collections/pages',
  }
  const collectionConfig: BadgeLinkCollectionConfig<typeof req> = {
    slug: 'pages',
    admin: {
      preview: (doc: Record<string, unknown>) => `https://preview.example.com/${String(doc.slug)}`,
    },
  }
  return {
    badgesLinks: { liveURL: 'https://example.com' },
    breadcrumbsFieldSlug: 'breadcrumbs',
    collectionConfig,
    draftDoc: { id: 1, slug: 'new-path', _displayStatus: 'changed', _status: 'draft' },
    publishedDoc: {
      id: 1,
      slug: 'old-path',
      _status: 'published',
      breadcrumbs: [{ url: '/parent' }, { url: '/old-path' }],
    },
    req,
    token: 'test-token',
  }
}

describe('resolvePageTreeBadgeLinks', () => {
  it('leaves all badges unlinked unless explicitly enabled', async () => {
    const args = fixture()
    args.collectionConfig.admin.preview = () => {
      throw new Error('must not run')
    }
    expect(await resolvePageTreeBadgeLinks({ ...args, badgesLinks: undefined })).toEqual({})
    expect(args.req.payload.logger.error).not.toHaveBeenCalled()
  })

  it.each([
    ['live', { publicURL: 'https://example.com/old-path' }],
    ['preview', { previewURL: 'https://preview.example.com/new-path' }],
    [
      'both',
      {
        previewURL: 'https://preview.example.com/new-path',
        publicURL: 'https://example.com/old-path',
      },
    ],
  ] as const)(
    'respects the %s mode for drafts with a published version',
    async (mode, expected) => {
      const args = fixture()
      expect(
        await resolvePageTreeBadgeLinks({
          ...args,
          badgesLinks: { ...args.badgesLinks, draftHasPublishedVersion: mode },
        }),
      ).toEqual(expected)
    },
  )

  it('uses the published path for live and the draft path for preview', async () => {
    expect(await resolvePageTreeBadgeLinks(fixture())).toEqual({
      previewURL: 'https://preview.example.com/new-path',
      publicURL: 'https://example.com/old-path',
    })
  })

  it.each(['draft', 'published', 'unknown'])(
    'resolves only destinations for %s',
    async (status) => {
      const args = fixture()
      args.draftDoc._displayStatus = status
      args.draftDoc._status = status
      const result = await resolvePageTreeBadgeLinks(args)
      expect(result).toEqual(
        status === 'draft'
          ? { previewURL: 'https://preview.example.com/new-path' }
          : status === 'published'
            ? { publicURL: 'https://example.com/old-path' }
            : {},
      )
    },
  )

  it('forwards request, locale and token to native async preview', async () => {
    const args = fixture()
    args.collectionConfig.admin.preview = (doc, { locale, req, token }) =>
      Promise.resolve(`${req.url}?locale=${locale}&token=${token}&slug=${String(doc.slug)}`)
    const links = await resolvePageTreeBadgeLinks(args)
    expect(links).toEqual({
      previewURL:
        'https://cms.example.com/admin/collections/pages?locale=en&token=test-token&slug=new-path',
      publicURL: 'https://example.com/old-path',
    })
  })

  it.each([null, '', '  ', 'javascript:alert(1)', 'data:text/html,test', 'https://['])(
    'omits invalid preview %s independently',
    async (url) => {
      const args = fixture()
      args.collectionConfig.admin.preview = () => url
      expect(await resolvePageTreeBadgeLinks(args)).toEqual({
        publicURL: 'https://example.com/old-path',
      })
    },
  )

  it('resolves relative URLs against the CMS request', async () => {
    const args = fixture()
    args.collectionConfig.admin.preview = () => '/preview?id=1'
    expect((await resolvePageTreeBadgeLinks(args)).previewURL).toBe(
      'https://cms.example.com/preview?id=1',
    )
  })

  it('retains preview when the live URL is invalid without logging its value', async () => {
    const args = fixture()
    const links = await resolvePageTreeBadgeLinks({
      ...args,
      badgesLinks: { liveURL: 'https://[secret-token' },
    })
    expect(links).toEqual({ previewURL: 'https://preview.example.com/new-path' })
    expect(JSON.stringify(vi.mocked(args.req.payload.logger.error).mock.calls)).not.toContain(
      'secret-token',
    )
  })

  it('retains live when preview resolution throws', async () => {
    const args = fixture()
    args.collectionConfig.admin.preview = () => {
      throw new Error('preview failed')
    }
    expect(await resolvePageTreeBadgeLinks(args)).toEqual({
      publicURL: 'https://example.com/old-path',
    })
  })

  it('does not substitute the draft when the published row is missing or unpublished', async () => {
    const args = fixture()
    for (const publishedDoc of [undefined, { ...args.publishedDoc, _status: 'draft' }]) {
      expect(await resolvePageTreeBadgeLinks({ ...args, publishedDoc })).toEqual({
        previewURL: 'https://preview.example.com/new-path',
      })
    }
  })

  it('does not fall back to live preview or invent missing destinations', async () => {
    const args = fixture()
    const collectionConfig = {
      ...args.collectionConfig,
      admin: {
        ...args.collectionConfig.admin,
        livePreview: { url: 'https://iframe.example.com' },
        preview: undefined,
      },
    }
    expect(await resolvePageTreeBadgeLinks({ ...args, badgesLinks: {}, collectionConfig })).toEqual(
      {},
    )
  })

  it('retains both actions even when their destinations match', async () => {
    const args = fixture()
    args.collectionConfig.admin.preview = () => 'https://example.com/old-path'
    expect(await resolvePageTreeBadgeLinks(args)).toEqual({
      previewURL: 'https://example.com/old-path',
      publicURL: 'https://example.com/old-path',
    })
  })

  it('keeps preview when liveURL is omitted', async () => {
    expect(await resolvePageTreeBadgeLinks({ ...fixture(), badgesLinks: {} })).toEqual({
      previewURL: 'https://preview.example.com/new-path',
    })
  })

  it('uses the configured breadcrumbs field', async () => {
    const args = fixture()
    expect(
      (
        await resolvePageTreeBadgeLinks({
          ...args,
          breadcrumbsFieldSlug: 'trail',
          publishedDoc: { ...args.publishedDoc, trail: [{ url: '/custom/path' }] },
        })
      ).publicURL,
    ).toBe('https://example.com/custom/path')
  })

  it.each(
    [undefined, [], [{ url: '' }], [{ url: '/parent' }, {}]].map((breadcrumbs) => [breadcrumbs]),
  )('does not invent a live path for missing breadcrumbs %j', async (breadcrumbs) => {
    const args = fixture()
    expect(
      (
        await resolvePageTreeBadgeLinks({
          ...args,
          publishedDoc: { ...args.publishedDoc, breadcrumbs },
        })
      ).publicURL,
    ).toBeUndefined()
  })

  it('resolves the homepage breadcrumb', async () => {
    const args = fixture()
    expect(
      (
        await resolvePageTreeBadgeLinks({
          ...args,
          publishedDoc: { ...args.publishedDoc, breadcrumbs: [{ url: '/' }] },
        })
      ).publicURL,
    ).toBe('https://example.com/')
  })
})
