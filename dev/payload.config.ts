import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig, slugField, type CollectionConfig } from 'payload'
import { nestedDocsPageTreePlugin } from '../src/index.js'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

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

const buildPageLikeCollection = (args: {
  orderable?: boolean
  showParentColumn?: boolean
  slug: string
}): CollectionConfig => ({
  slug: args.slug,
  ...(args.orderable ? { orderable: true } : {}),
  access: {
    create: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
    read: () => true,
    update: ({ req }) => Boolean(req.user),
  },
  admin: {
    defaultColumns: args.showParentColumn
      ? ['title', 'publishedAt', 'updatedAt', 'parent', 'slug', '_status']
      : ['title', 'publishedAt', 'updatedAt', 'slug', '_status'],
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
  versions: {
    drafts: {
      autosave: {
        interval: 100,
      },
    },
    maxPerDoc: 20,
  },
})

const PageTreeOrderable = buildPageLikeCollection({
  orderable: true,
  showParentColumn: true,
  slug: 'page-tree-orderable',
})

const PageTree = buildPageLikeCollection({
  showParentColumn: true,
  slug: 'page-tree',
})

const PageOrderable = buildPageLikeCollection({
  orderable: true,
  slug: 'page-orderable',
})

const Pages = buildPageLikeCollection({
  slug: 'pages',
})

const Categories: CollectionConfig = {
  slug: 'categories',
  orderable: true,
  access: {
    create: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
    read: () => true,
    update: ({ req }) => Boolean(req.user),
  },
  admin: {
    pagination: {
      defaultLimit: 100,
    },
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    slugField(),
  ],
}

const buildNestedDocURL = (docs: Array<Record<string, unknown>>): string =>
  docs.reduce((url, doc) => {
    const slug = typeof doc.slug === 'string' ? doc.slug.replace(/^\/+|\/+$/g, '') : ''
    return slug ? `${url}/${slug}` : url
  }, '')

const buildConfigWithMemoryDB = async () => {
  if (process.env.NODE_ENV === 'test') {
    const memoryDB = await MongoMemoryReplSet.create({
      replSet: {
        count: 3,
        dbName: 'payloadmemory',
      },
    })

    process.env.DATABASE_URL = `${memoryDB.getUri()}&retryWrites=true`
  }

  return buildConfig({
    admin: {
      importMap: {
        baseDir: path.resolve(dirname),
      },
      user: Users.slug,
    },
    collections: [Users, PageTreeOrderable, PageTree, PageOrderable, Pages, Categories],
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
      await seed(payload)
    },
    plugins: [
      nestedDocsPlugin({
        collections: ['page-tree-orderable', 'page-tree', 'categories'],
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
      nestedDocsPageTreePlugin({
        collections: ['page-tree-orderable', 'page-tree', 'categories'],
        homeIndicator: {
          collections: ['page-tree-orderable', 'page-tree'],
        },
      }),
    ],
    secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
    sharp,
    typescript: {
      outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
  })
}

export default buildConfigWithMemoryDB()
