import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { createBreadcrumbsField, createParentField, nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { cloudflareBuildStatusPlugin } from 'payload-cloudflare-build-status'
import { buildConfig, slugField, type CollectionConfig } from 'payload'
import { nestedDocsPageTreePlugin } from '../src/index.js'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { devUser } from './helpers/credentials.js'
import { revalidateOnDelete, revalidatePublishedChange } from './lib/rebuild.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  fields: [],
}

const Pages: CollectionConfig = {
  slug: 'pages',
  orderable: true,
  access: {
    create: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
    read: () => true,
    update: ({ req }) => Boolean(req.user),
  },
  admin: {
    defaultColumns: ['title', 'publishedAt', 'updatedAt', 'parent', 'slug', '_status'],
    preview: (doc) => {
      const slug = String(doc.slug ?? '')
      return slug.includes('public-only')
        ? null : `https://preview.example.com/${slug}`
    },
    pagination: {
      defaultLimit: 100,
    },
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      localized: true,
      required: true,
    },
    {
      name: 'publishedAt',
      label: 'Published',
      type: 'date',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
        position: 'sidebar',
        readOnly: true,
      },
    },
    slugField(),
  ],
  hooks: {
    afterChange: [revalidatePublishedChange('pages')],
    afterDelete: [revalidateOnDelete('pages')],
  },
  versions: {
    drafts: {
      autosave: {
        interval: 100,
      },
    },
    maxPerDoc: 20,
  },
}

// Regression coverage for https://github.com/WLF-Studios/payload-nested-docs-page-tree/issues/3 -
// useAsTitle, parent, and breadcrumbs each live inside a different presentational
// container (unnamed tab, row, collapsible) instead of at the top level of `fields`.
const TabbedPages: CollectionConfig = {
  slug: 'tabbed-pages',
  orderable: true,
  access: {
    create: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
    read: () => true,
    update: ({ req }) => Boolean(req.user),
  },
  admin: {
    defaultColumns: ['title', 'publishedAt', 'updatedAt', 'parent', 'slug', '_status'],
    pagination: {
      defaultLimit: 100,
    },
    useAsTitle: 'title',
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Content',
          fields: [
            {
              name: 'title',
              type: 'text',
              localized: true,
              required: true,
            },
            slugField(),
            {
              name: 'publishedAt',
              label: 'Published',
              type: 'date',
              admin: {
                date: {
                  pickerAppearance: 'dayAndTime',
                },
                readOnly: true,
              },
            },
          ],
        },
      ],
    },
    {
      type: 'row',
      fields: [createParentField('tabbed-pages')],
    },
    {
      type: 'collapsible',
      label: 'Breadcrumbs',
      fields: [createBreadcrumbsField('tabbed-pages')],
    },
  ],
  hooks: {
    afterChange: [revalidatePublishedChange('tabbed-pages')],
    afterDelete: [revalidateOnDelete('tabbed-pages')],
  },
  versions: {
    drafts: {
      autosave: {
        interval: 100,
      },
    },
    maxPerDoc: 20,
  },
}

const buildNestedDocURL = (docs: Array<Record<string, unknown>>): string =>
  docs.reduce((url, doc) => {
    const slug = typeof doc.slug === 'string' ? doc.slug.replace(/^\/+|\/+$/g, '') : ''
    return slug ? `${url}/${slug}` : url
  }, '')

const buildConfigWithMemoryDB = async () => {
  if (process.env.NODE_ENV === 'test' || process.env.PAYLOAD_TEST_DATABASE === 'true') {
    const memoryDB = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        dbName: 'payloadmemory',
      },
    })

    process.env.DATABASE_URL = `${memoryDB.getUri()}&retryWrites=true`
  }

  return buildConfig({
    admin: {
      components: {
        beforeDashboard: ['./components/BeforeDashboard'],
      },
      importMap: {
        baseDir: path.resolve(dirname),
      },
      user: Users.slug,
    },
    collections: [Users, Pages, TabbedPages],
    db: mongooseAdapter({
      ensureIndexes: true,
      url: process.env.DATABASE_URL || '',
    }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    localization: {
      defaultLocale: 'en',
      fallback: false,
      locales: ['en', 'de'],
    },
    onInit: async (payload) => {
      const { totalDocs } = await payload.count({
        collection: 'users',
        where: {
          email: {
            equals: devUser.email,
          },
        },
      } as never)

      if (!totalDocs) {
        await payload.create({
          collection: 'users',
          data: devUser,
          overrideAccess: true,
        } as never)
      }
    },
    plugins: [
      nestedDocsPlugin({
        collections: ['pages'],
        generateLabel: (_, doc) => {
          if (typeof doc.title === 'string' && doc.title.trim()) {
            return doc.title
          }

          if (typeof doc.slug === 'string' && doc.slug.trim()) {
            return doc.slug
          }

          return String(doc.id ?? '')
        },
        generateURL: (docs) => buildNestedDocURL(docs),
      }),
      // parentFieldSlug/breadcrumbsFieldSlug are set so this instance trusts the
      // parent/breadcrumbs fields already defined on TabbedPages (nested inside a
      // row and a collapsible) instead of auto-appending flat top-level ones.
      nestedDocsPlugin({
        breadcrumbsFieldSlug: 'breadcrumbs',
        collections: ['tabbed-pages'],
        generateLabel: (_, doc) => {
          if (typeof doc.title === 'string' && doc.title.trim()) {
            return doc.title
          }

          if (typeof doc.slug === 'string' && doc.slug.trim()) {
            return doc.slug
          }

          return String(doc.id ?? '')
        },
        generateURL: (docs) => buildNestedDocURL(docs),
        parentFieldSlug: 'parent',
      }),
      nestedDocsPageTreePlugin({
        badges: {
          colors: {
            published: '#bbf3b0',
            changed: '#b9eaf3',
            draft: '#f8d5a7',
          },
        },
        collections: ['pages', 'tabbed-pages'],
        badgesLinks: {
          draftHasPublishedVersion: 'both',
          liveURL: 'https://www.example.com',
        },
        diagnostics: true,
      }),
      cloudflareBuildStatusPlugin(),
    ],
    secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
    sharp,
    typescript: {
      outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
  })
}

export default buildConfigWithMemoryDB()
