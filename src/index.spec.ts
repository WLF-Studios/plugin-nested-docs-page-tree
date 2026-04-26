import type { CollectionConfig, Config } from 'payload'

import { describe, expect, it } from 'vitest'

import { nestedDocsPageTreePlugin } from './index.js'

type CollectionEndpoint = NonNullable<Exclude<CollectionConfig['endpoints'], false>>[number]

const pageTreeListViewPath = 'payload-nested-docs-page-tree/rsc#NestedDocsPageTreeListView'

function buildCollection(args: {
  breadcrumbsFieldSlug?: string
  customListViewComponent?: string
  endpointPath?: string
  includeBreadcrumbs?: boolean
  includeParent?: boolean
  paginationDefaultLimit?: number
  parentFieldSlug?: string
  slug: string
  useAsTitle?: string
}): CollectionConfig {
  const {
    breadcrumbsFieldSlug = 'breadcrumbs',
    customListViewComponent,
    endpointPath,
    includeBreadcrumbs = true,
    includeParent = true,
    paginationDefaultLimit,
    parentFieldSlug = 'parent',
    slug,
    useAsTitle = 'title',
  } = args
  const fields: CollectionConfig['fields'] = [
    {
      name: 'title',
      type: 'text',
    },
  ]

  if (includeParent) {
    fields.push({
      name: parentFieldSlug,
      relationTo: slug,
      type: 'relationship',
    })
  }

  if (includeBreadcrumbs) {
    fields.push({
      fields: [
        {
          name: 'label',
          type: 'text',
        },
      ],
      name: breadcrumbsFieldSlug,
      type: 'array',
    })
  }

  return {
    admin: {
      components: customListViewComponent
        ? {
            views: {
              list: {
                Component: customListViewComponent,
              },
            },
          }
        : undefined,
      pagination:
        paginationDefaultLimit === undefined
          ? undefined
          : {
              defaultLimit: paginationDefaultLimit,
            },
      useAsTitle,
    },
    endpoints: endpointPath
      ? [
          {
            handler: (() => new Response(null, { status: 204 })) as never,
            method: 'post',
            path: endpointPath,
          },
        ]
      : undefined,
    fields,
    slug,
  }
}

function buildConfig(collections: CollectionConfig[]): Config {
  return {
    collections,
  } as Config
}

function getCollectionEndpoints(
  collection: CollectionConfig | undefined,
): CollectionEndpoint[] {
  return Array.isArray(collection?.endpoints) ? collection.endpoints : []
}

function getFieldHiddenValue(field: CollectionConfig['fields'][number] | undefined): boolean | undefined {
  if (!field || !('admin' in field)) {
    return undefined
  }

  return (field.admin as { hidden?: boolean } | undefined)?.hidden
}

describe('nestedDocsPageTreePlugin', () => {
  it('patches targeted collections with the tree list view, endpoint, and custom config', () => {
    const pagesCollection = buildCollection({
      slug: 'pages',
    })
    const postsCollection = buildCollection({
      slug: 'posts',
    })
    const config = nestedDocsPageTreePlugin({
      badges: {
        colors: {
          changed: '#d97706',
        },
        labels: {
          draft: 'Unpublished',
        },
      },
      collections: ['pages'],
      defaultLimit: 50,
      hideBreadcrumbs: false,
    })(buildConfig([pagesCollection, postsCollection]))

    const patchedPagesCollection = config.collections?.[0]
    const untouchedPostsCollection = config.collections?.[1]
    const breadcrumbsField = patchedPagesCollection?.fields.find(
      (field) => 'name' in field && field.name === 'breadcrumbs',
    )

    expect(patchedPagesCollection?.admin?.components?.views?.list?.Component).toBe(
      pageTreeListViewPath,
    )
    expect(patchedPagesCollection?.admin?.pagination?.defaultLimit).toBe(50)
    expect(patchedPagesCollection?.custom?.nestedDocsPageTreePlugin).toMatchObject({
      badges: {
        colors: {
          changed: '#d97706',
        },
        labels: {
          draft: 'Unpublished',
        },
      },
      breadcrumbsFieldSlug: 'breadcrumbs',
      defaultLimit: 50,
      hideBreadcrumbs: false,
      homeIndicator: {
        enabled: true,
      },
      parentFieldSlug: 'parent',
    })
    expect(
      getCollectionEndpoints(patchedPagesCollection).some(
        (endpoint) => endpoint.method === 'post' && endpoint.path === '/:id/move',
      ),
    ).toBe(true)
    expect(getFieldHiddenValue(breadcrumbsField)).toBe(false)
    expect(untouchedPostsCollection?.admin?.components?.views?.list?.Component).toBeUndefined()
  })

  it('does not enable the home indicator for non-pages collections by default', () => {
    const config = nestedDocsPageTreePlugin({
      collections: ['categories'],
    })(buildConfig([buildCollection({ slug: 'categories' })]))

    expect(config.collections?.[0]?.custom?.nestedDocsPageTreePlugin).toMatchObject({
      homeIndicator: {
        enabled: false,
      },
    })
  })

  it('uses configured home indicator collections as an exact allow-list', () => {
    const config = nestedDocsPageTreePlugin({
      collections: ['pages', 'page-tree'],
      homeIndicator: {
        collections: ['page-tree'],
      },
    })(
      buildConfig([
        buildCollection({ slug: 'pages' }),
        buildCollection({ slug: 'page-tree' }),
      ]),
    )

    expect(config.collections?.[0]?.custom?.nestedDocsPageTreePlugin).toMatchObject({
      homeIndicator: {
        enabled: false,
      },
    })
    expect(config.collections?.[1]?.custom?.nestedDocsPageTreePlugin).toMatchObject({
      homeIndicator: {
        enabled: true,
      },
    })
  })

  it('disables the home indicator everywhere when configured false', () => {
    const config = nestedDocsPageTreePlugin({
      collections: ['pages'],
      homeIndicator: false,
    })(buildConfig([buildCollection({ slug: 'pages' })]))

    expect(config.collections?.[0]?.custom?.nestedDocsPageTreePlugin).toMatchObject({
      homeIndicator: {
        enabled: false,
      },
    })
  })

  it('preserves an existing pagination default limit on targeted collections', () => {
    const config = nestedDocsPageTreePlugin({
      collections: ['pages'],
      defaultLimit: 50,
    })(
      buildConfig([
        buildCollection({
          paginationDefaultLimit: 25,
          slug: 'pages',
        }),
      ]),
    )

    expect(config.collections?.[0]?.admin?.pagination?.defaultLimit).toBe(25)
  })

  it('returns the original config when the plugin is disabled', () => {
    const config = buildConfig([
      buildCollection({
        slug: 'pages',
      }),
    ])

    expect(
      nestedDocsPageTreePlugin({
        collections: ['pages'],
        disabled: true,
      })(config),
    ).toBe(config)
  })

  it('throws when no collection slugs are configured', () => {
    expect(() =>
      nestedDocsPageTreePlugin({
        collections: [],
      })(buildConfig([buildCollection({ slug: 'pages' })])),
    ).toThrow('requires at least one collection slug')
  })

  it('throws when a targeted collection is missing from the config', () => {
    expect(() =>
      nestedDocsPageTreePlugin({
        collections: ['pages'],
      })(buildConfig([buildCollection({ slug: 'posts' })])),
    ).toThrow('could not find the following collections: pages')
  })

  it('throws when the useAsTitle field is not top-level and resolvable', () => {
    expect(() =>
      nestedDocsPageTreePlugin({
        collections: ['pages'],
      })(
        buildConfig([
          buildCollection({
            slug: 'pages',
            useAsTitle: 'seo.title',
          }),
        ]),
      ),
    ).toThrow('requires "pages" to define a top-level admin.useAsTitle field')

    expect(() =>
      nestedDocsPageTreePlugin({
        collections: ['pages'],
      })(
        buildConfig([
          buildCollection({
            slug: 'pages',
            useAsTitle: 'headline',
          }),
        ]),
      ),
    ).toThrow('could not find the useAsTitle field "headline" on "pages"')
  })

  it('throws when required nested-docs fields are missing', () => {
    expect(() =>
      nestedDocsPageTreePlugin({
        collections: ['pages'],
      })(
        buildConfig([
          buildCollection({
            includeParent: false,
            slug: 'pages',
          }),
        ]),
      ),
    ).toThrow('requires "pages" to already define the nested docs parent field "parent"')

    expect(() =>
      nestedDocsPageTreePlugin({
        collections: ['pages'],
      })(
        buildConfig([
          buildCollection({
            includeBreadcrumbs: false,
            slug: 'pages',
          }),
        ]),
      ),
    ).toThrow('requires "pages" to already define the nested docs breadcrumbs field "breadcrumbs"')
  })

  it('throws when the collection already owns the list view or move endpoint', () => {
    expect(() =>
      nestedDocsPageTreePlugin({
        collections: ['pages'],
      })(
        buildConfig([
          buildCollection({
            customListViewComponent: 'custom/path#ListView',
            slug: 'pages',
          }),
        ]),
      ),
    ).toThrow('cannot own the "pages" list view')

    expect(() =>
      nestedDocsPageTreePlugin({
        collections: ['pages'],
      })(
        buildConfig([
          buildCollection({
            endpointPath: '/:id/move',
            slug: 'pages',
          }),
        ]),
      ),
    ).toThrow('cannot add the move endpoint to "pages"')
  })
})
