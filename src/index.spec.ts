import type { CollectionConfig, CollectionSlug, Config } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { describe, expect, it } from 'vitest'

import { nestedDocsPageTreePlugin } from './index.js'
import { getCollectionPageTreeConfig } from './utilities/pageTreeConfig.js'

type CollectionEndpoint = NonNullable<Exclude<CollectionConfig['endpoints'], false>>[number]

const pageTreeListViewPath = 'payload-nested-docs-page-tree/rsc#NestedDocsPageTreeListView'

type FieldContainer = 'collapsible' | 'namedGroup' | 'namedTab' | 'row' | 'tab' | 'unnamedGroup'

function wrapFields(
  fields: CollectionConfig['fields'],
  container: FieldContainer,
): CollectionConfig['fields'] {
  switch (container) {
    case 'collapsible':
      return [{ type: 'collapsible', fields, label: 'Editorial' }]
    case 'namedGroup':
      return [{ name: 'editorial', type: 'group', fields }]
    case 'namedTab':
      return [{ type: 'tabs', tabs: [{ name: 'editorial', fields, label: 'Editorial' }] }]
    case 'row':
      return [{ type: 'row', fields }]
    case 'tab':
      return [{ type: 'tabs', tabs: [{ fields, label: 'Editorial' }] }]
    case 'unnamedGroup':
      return [{ type: 'group', fields, label: 'Editorial' }]
  }
}

function buildCollection(args: {
  breadcrumbsFieldSlug?: string
  customListViewComponent?: string
  endpointPath?: string
  includeBreadcrumbs?: boolean
  includeParent?: boolean
  orderable?: boolean
  paginationDefaultLimit?: number
  parentFieldSlug?: string
  slug: CollectionSlug
  useAsTitle?: string
  wrapFieldsIn?: FieldContainer
}): CollectionConfig {
  const {
    breadcrumbsFieldSlug = 'breadcrumbs',
    customListViewComponent,
    endpointPath,
    includeBreadcrumbs = true,
    includeParent = true,
    orderable = false,
    paginationDefaultLimit,
    parentFieldSlug = 'parent',
    slug,
    useAsTitle = 'title',
    wrapFieldsIn,
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
            handler: () => new Response(null, { status: 204 }),
            method: 'post',
            path: endpointPath,
          },
        ]
      : undefined,
    fields: wrapFieldsIn ? wrapFields(fields, wrapFieldsIn) : fields,
    ...(orderable ? { orderable: true } : {}),
    slug,
  }
}

function buildConfig(collections: CollectionConfig[]): Config {
  return {
    collections,
    db: mongooseAdapter({ url: 'mongodb://127.0.0.1/page-tree-plugin-tests' }),
    secret: 'page-tree-plugin-test-secret',
  }
}

function getCollectionEndpoints(collection: CollectionConfig | undefined): CollectionEndpoint[] {
  return Array.isArray(collection?.endpoints) ? collection.endpoints : []
}

function findFieldDeep(
  fields: CollectionConfig['fields'] | undefined,
  fieldName: string,
): CollectionConfig['fields'][number] | undefined {
  for (const field of fields ?? []) {
    if ('name' in field && field.name === fieldName) {
      return field
    }

    const childFields =
      'fields' in field
        ? field.fields
        : 'tabs' in field
          ? field.tabs.flatMap((tab) => tab.fields)
          : undefined
    const match = findFieldDeep(childFields, fieldName)

    if (match) {
      return match
    }
  }

  return undefined
}

function getFieldHiddenValue(
  field: CollectionConfig['fields'][number] | undefined,
): boolean | undefined {
  if (!field || !('admin' in field)) {
    return undefined
  }

  return (field.admin as { hidden?: boolean } | undefined)?.hidden
}

describe('nestedDocsPageTreePlugin', () => {
  it('retains badge link options without replacing native preview', () => {
    const pages = buildCollection({ slug: 'pages' })
    const preview = () => 'https://preview.example.com'
    pages.admin!.preview = preview
    const badgesLinks = {
      draftHasPublishedVersion: 'preview' as const,
      liveURL: 'https://example.com',
    }
    const config = nestedDocsPageTreePlugin({ collections: ['pages'], badgesLinks })(
      buildConfig([pages]),
    )
    const collection = config.collections![0]
    expect(getCollectionPageTreeConfig(collection)?.badgesLinks).toEqual(badgesLinks)
    expect(collection.admin?.preview).toBe(preview)
  })
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
      collections: ['tabbed-pages'],
    })(buildConfig([buildCollection({ slug: 'tabbed-pages' })]))

    expect(config.collections?.[0]?.custom?.nestedDocsPageTreePlugin).toMatchObject({
      homeIndicator: {
        enabled: false,
      },
    })
  })

  it('uses configured home indicator collections as an exact allow-list', () => {
    const config = nestedDocsPageTreePlugin({
      collections: ['pages', 'tabbed-pages'],
      homeIndicator: {
        collections: ['tabbed-pages'],
      },
    })(buildConfig([buildCollection({ slug: 'pages' }), buildCollection({ slug: 'tabbed-pages' })]))

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

  it('keeps diagnostics off by default and appends an afterChange hook when enabled', () => {
    const disabledConfig = nestedDocsPageTreePlugin({
      collections: ['pages'],
    })(buildConfig([buildCollection({ slug: 'pages' })]))
    const enabledConfig = nestedDocsPageTreePlugin({
      collections: ['pages'],
      diagnostics: true,
    })(buildConfig([buildCollection({ orderable: true, slug: 'pages' })]))

    expect(disabledConfig.collections?.[0]?.hooks?.afterChange).toBeUndefined()
    expect(enabledConfig.collections?.[0]?.hooks?.afterChange).toHaveLength(1)
    expect(
      getCollectionEndpoints(enabledConfig.collections?.[0]).some(
        (endpoint) => endpoint.method === 'post' && endpoint.path === '/:id/reorder',
      ),
    ).toBe(true)
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

  it.each(['collapsible', 'row', 'tab', 'unnamedGroup'] as const)(
    'resolves and patches fields nested inside a presentational %s',
    (container) => {
      const config = nestedDocsPageTreePlugin({
        collections: ['pages'],
      })(
        buildConfig([
          buildCollection({
            slug: 'pages',
            wrapFieldsIn: container,
          }),
        ]),
      )

      const patchedPagesCollection = config.collections?.[0]

      expect(patchedPagesCollection?.admin?.components?.views?.list?.Component).toBe(
        pageTreeListViewPath,
      )
      expect(
        getFieldHiddenValue(findFieldDeep(patchedPagesCollection?.fields, 'breadcrumbs')),
      ).toBe(true)
      expect(findFieldDeep(patchedPagesCollection?.fields, 'title')).toBeDefined()
    },
  )

  it.each(['namedGroup', 'namedTab'] as const)(
    'throws when the useAsTitle field is nested inside a %s',
    (container) => {
      expect(() =>
        nestedDocsPageTreePlugin({
          collections: ['pages'],
        })(
          buildConfig([
            buildCollection({
              slug: 'pages',
              wrapFieldsIn: container,
            }),
          ]),
        ),
      ).toThrow('could not find the useAsTitle field "title" on "pages"')
    },
  )

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

    expect(() =>
      nestedDocsPageTreePlugin({
        collections: ['pages'],
      })(
        buildConfig([
          buildCollection({
            endpointPath: '/:id/reorder',
            orderable: true,
            slug: 'pages',
          }),
        ]),
      ),
    ).toThrow('cannot add the reorder endpoint to "pages"')
  })
})
