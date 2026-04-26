import type { Payload, PayloadRequest } from 'payload'

import config from '@payload-config'
import { createPayloadRequest, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { devUser } from './helpers/credentials.js'
import { getRelationshipID } from '../src/utilities/pageTree.js'

const pageTreeListViewPath = 'payload-nested-docs-page-tree/rsc#NestedDocsPageTreeListView'
const pageSlugs = [
  'about',
  'blog',
  'careers',
  'company-news',
  'contact',
  'design',
  'engineering-notes',
  'home',
  'leadership',
  'legal',
  'pricing',
  'services',
  'strategy',
  'team',
]

let payload: Payload

afterAll(async () => {
  await payload?.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

async function getPageTreeMoveEndpoint() {
  const moveEndpoint = payload.collections['page-tree'].config.endpoints?.find(
    (endpoint) => endpoint.path === '/:id/move' && endpoint.method === 'post',
  )

  if (!moveEndpoint) {
    throw new Error('Could not resolve the page-tree move endpoint')
  }

  return moveEndpoint
}

async function getSeedUser() {
  const { docs } = await payload.find({
    collection: 'users',
    limit: 1,
    overrideAccess: true,
    pagination: false,
    where: {
      email: {
        equals: devUser.email,
      },
    },
  })

  if (!docs[0]) {
    throw new Error('Could not resolve the seeded dev user')
  }

  return docs[0]
}

async function createPageTreeDoc(args: {
  locale?: string
  parent?: null | string
  slug: string
  title: string
}) {
  const { locale, parent = null, slug, title } = args

  return payload.create({
    collection: 'page-tree',
    data: {
      parent,
      slug,
      title,
    },
    draft: true,
    locale,
    overrideAccess: true,
  })
}

async function readPageTreeDoc(id: number | string, locale: string) {
  return payload.findByID({
    collection: 'page-tree',
    depth: 0,
    draft: true,
    id,
    locale,
    overrideAccess: true,
  })
}

async function invokeMove(args: {
  locale?: string
  movedID: number | string
  parentID: null | string
  user?: Record<string, unknown>
}) {
  const { locale, movedID, parentID, user } = args
  const moveEndpoint = await getPageTreeMoveEndpoint()
  const request = new Request(
    `http://localhost:3000/api/page-tree/${movedID}/move${locale ? `?locale=${locale}` : ''}`,
    {
      body: JSON.stringify({ parentID }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  )
  const payloadRequest = (await createPayloadRequest({
    config,
    request,
  })) as PayloadRequest & {
    routeParams?: Record<string, string>
  }

  payloadRequest.routeParams = { id: String(movedID) }

  if (user) {
    payloadRequest.user = user as never
  }

  return moveEndpoint.handler(payloadRequest)
}

function expectPageTreeCollection(
  collection: Payload['collections'][string]['config'],
  options: { homeIndicatorEnabled: boolean; orderable: boolean },
) {
  expect(collection.admin.components?.views?.list?.Component).toBe(pageTreeListViewPath)
  expect(collection.orderable === true).toBe(options.orderable)
  expect(collection.custom?.nestedDocsPageTreePlugin).toMatchObject({
    badges: {
      colors: {},
      labels: {},
    },
    breadcrumbsFieldSlug: 'breadcrumbs',
    defaultLimit: 100,
    hideBreadcrumbs: true,
    homeIndicator: {
      enabled: options.homeIndicatorEnabled,
    },
    parentFieldSlug: 'parent',
  })
}

function expectDefaultListCollection(
  collection: Payload['collections'][string]['config'],
  options: { orderable: boolean },
) {
  expect(collection.admin.components?.views?.list?.Component).toBeUndefined()
  expect(collection.orderable === true).toBe(options.orderable)
  expect(collection.custom?.nestedDocsPageTreePlugin).toBeUndefined()
}

function expectMoveEndpoint(collection: Payload['collections'][string]['config']) {
  expect(
    collection.endpoints?.some(
      (endpoint) => endpoint.method === 'post' && endpoint.path === '/:id/move',
    ),
  ).toBe(true)
}

describe('nestedDocsPageTreePlugin integration', () => {
  test('patches the testing admin collection matrix', async () => {
    const pageTreeOrderableCollection = payload.collections['page-tree-orderable'].config
    const pageTreeCollection = payload.collections['page-tree'].config
    const pageOrderableCollection = payload.collections['page-orderable'].config
    const pagesCollection = payload.collections.pages.config
    const categoriesCollection = payload.collections.categories.config

    expectPageTreeCollection(pageTreeOrderableCollection, {
      homeIndicatorEnabled: true,
      orderable: true,
    })
    expectPageTreeCollection(pageTreeCollection, {
      homeIndicatorEnabled: true,
      orderable: false,
    })
    expectDefaultListCollection(pageOrderableCollection, { orderable: true })
    expectDefaultListCollection(pagesCollection, { orderable: false })
    expectPageTreeCollection(categoriesCollection, {
      homeIndicatorEnabled: false,
      orderable: true,
    })

    expectMoveEndpoint(pageTreeOrderableCollection)
    expectMoveEndpoint(pageTreeCollection)

    const breadcrumbsField = pageTreeCollection.fields.find(
      (field) => 'name' in field && field.name === 'breadcrumbs',
    )
    const orderableBreadcrumbsField = pageTreeOrderableCollection.fields.find(
      (field) => 'name' in field && field.name === 'breadcrumbs',
    )

    expect(
      breadcrumbsField && 'admin' in breadcrumbsField ? breadcrumbsField.admin?.hidden : undefined,
    ).toBe(true)
    expect(
      orderableBreadcrumbsField && 'admin' in orderableBreadcrumbsField
        ? orderableBreadcrumbsField.admin?.hidden
        : undefined,
    ).toBe(true)
  })

  test('seeds matching page fixtures and 12 nested categories', async () => {
    const pageTreeOrderableResult = await payload.find({
      collection: 'page-tree-orderable',
      depth: 0,
      draft: true,
      limit: 100,
      overrideAccess: true,
      pagination: false,
    })
    const pageTreeResult = await payload.find({
      collection: 'page-tree',
      depth: 0,
      draft: true,
      limit: 100,
      overrideAccess: true,
      pagination: false,
    })
    const pageOrderableResult = await payload.find({
      collection: 'page-orderable',
      depth: 0,
      draft: true,
      limit: 100,
      overrideAccess: true,
      pagination: false,
    })
    const pagesResult = await payload.find({
      collection: 'pages',
      depth: 0,
      draft: true,
      limit: 100,
      overrideAccess: true,
      pagination: false,
    })
    const categoriesResult = await payload.find({
      collection: 'categories',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      pagination: false,
    })

    for (const result of [
      pageTreeOrderableResult,
      pageTreeResult,
      pageOrderableResult,
      pagesResult,
    ]) {
      expect(result.docs).toHaveLength(pageSlugs.length)
      expect(result.docs.map((doc) => doc.slug).sort()).toEqual(pageSlugs)
    }

    const pageTreeOrderableBySlug = new Map(
      pageTreeOrderableResult.docs.map((doc) => [doc.slug, doc] as const),
    )
    const pageTreeBySlug = new Map(pageTreeResult.docs.map((doc) => [doc.slug, doc] as const))

    for (const pagesBySlug of [pageTreeOrderableBySlug, pageTreeBySlug]) {
      expect(getRelationshipID(pagesBySlug.get('team')?.parent)).toBe(
        String(pagesBySlug.get('about')?.id),
      )
      expect(getRelationshipID(pagesBySlug.get('leadership')?.parent)).toBe(
        String(pagesBySlug.get('team')?.id),
      )
      expect(getRelationshipID(pagesBySlug.get('strategy')?.parent)).toBe(
        String(pagesBySlug.get('services')?.id),
      )
      expect(getRelationshipID(pagesBySlug.get('company-news')?.parent)).toBe(
        String(pagesBySlug.get('blog')?.id),
      )
    }

    expect(pageOrderableResult.docs.every((doc) => !('parent' in doc))).toBe(true)
    expect(pagesResult.docs.every((doc) => !('parent' in doc))).toBe(true)

    expect(categoriesResult.docs).toHaveLength(12)

    const categoriesBySlug = new Map(
      categoriesResult.docs.map((doc) => [doc.slug, doc] as const),
    )

    expect(
      getRelationshipID(categoriesBySlug.get('getting-started')?.parent),
    ).toBe(String(categoriesBySlug.get('documentation')?.id))
    expect(getRelationshipID(categoriesBySlug.get('automation')?.parent)).toBe(
      String(categoriesBySlug.get('features')?.id),
    )
    expect(getRelationshipID(categoriesBySlug.get('cms')?.parent)).toBe(
      String(categoriesBySlug.get('integrations')?.id),
    )
  })

  test('rejects moves when the request does not have update access', async () => {
    const root = await createPageTreeDoc({
      slug: 'access-root',
      title: 'Access Root',
    })
    const child = await createPageTreeDoc({
      parent: String(root.id),
      slug: 'access-child',
      title: 'Access Child',
    })
    const otherRoot = await createPageTreeDoc({
      slug: 'access-other',
      title: 'Access Other',
    })
    const response = await invokeMove({
      locale: 'en',
      movedID: child.id,
      parentID: String(otherRoot.id),
    })

    expect(response.status).toBe(403)
  })

  test('moves only the active locale draft state and does not fan out localized breadcrumbs', async () => {
    const user = await getSeedUser()
    const about = await createPageTreeDoc({
      slug: 'locale-about',
      title: 'About Locale',
    })
    const contact = await createPageTreeDoc({
      slug: 'locale-contact',
      title: 'Contact Locale',
    })
    const team = await createPageTreeDoc({
      parent: String(about.id),
      slug: 'locale-team',
      title: 'Team Locale',
    })

    await payload.update({
      collection: 'page-tree',
      data: {
        title: 'Ueber Lokal',
      },
      draft: true,
      id: about.id,
      locale: 'de',
      overrideAccess: true,
    })
    await payload.update({
      collection: 'page-tree',
      data: {
        title: 'Team Lokal',
      },
      draft: true,
      id: team.id,
      locale: 'de',
      overrideAccess: true,
    })

    const teamDeBeforeMove = await readPageTreeDoc(team.id, 'de')
    const teamDeBeforeBreadcrumbLabels = teamDeBeforeMove.breadcrumbs?.map((crumb) => crumb.label)

    const response = await invokeMove({
      locale: 'en',
      movedID: team.id,
      parentID: String(contact.id),
      user,
    })

    expect(response.status).toBe(200)

    const teamEn = await readPageTreeDoc(team.id, 'en')
    const teamDe = await readPageTreeDoc(team.id, 'de')

    expect(getRelationshipID(teamEn.parent)).toBe(String(contact.id))
    expect(getRelationshipID(teamDe.parent)).toBe(String(contact.id))
    expect(teamEn.breadcrumbs?.map((crumb) => crumb.label)).toEqual(['Contact Locale', 'Team Locale'])
    expect(teamDe.breadcrumbs?.map((crumb) => crumb.label)).toEqual(teamDeBeforeBreadcrumbLabels)
  })

  test('rejects self, descendant, missing-parent, and no-op moves', async () => {
    const user = await getSeedUser()
    const root = await createPageTreeDoc({
      slug: 'rule-root',
      title: 'Rule Root',
    })
    const child = await createPageTreeDoc({
      parent: String(root.id),
      slug: 'rule-child',
      title: 'Rule Child',
    })
    const grandchild = await createPageTreeDoc({
      parent: String(child.id),
      slug: 'rule-grandchild',
      title: 'Rule Grandchild',
    })

    const selfResponse = await invokeMove({
      locale: 'en',
      movedID: child.id,
      parentID: String(child.id),
      user,
    })
    expect(selfResponse.status).toBe(400)

    const descendantResponse = await invokeMove({
      locale: 'en',
      movedID: child.id,
      parentID: String(grandchild.id),
      user,
    })
    expect(descendantResponse.status).toBe(400)

    const missingParentResponse = await invokeMove({
      locale: 'en',
      movedID: child.id,
      parentID: 'missing-parent',
      user,
    })
    expect(missingParentResponse.status).toBe(400)

    const noopResponse = await invokeMove({
      locale: 'en',
      movedID: child.id,
      parentID: String(root.id),
      user,
    })
    expect(noopResponse.status).toBe(400)
  })
})
