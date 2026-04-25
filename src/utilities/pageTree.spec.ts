import { describe, expect, it } from 'vitest'

import { buildPageTreeDocs, getVisibleTreeDocs, type PageTreeSourceDoc } from './pageTree.js'

type DocInput = {
  _order?: string
  createdAt?: string
  folder?: number | null
  id: number
  parent?: number | null
  slug?: string
  title: string
}

const buildDocs = (docs: DocInput[]): PageTreeSourceDoc[] =>
  docs.map((doc) => ({
    _order: doc._order,
    createdAt: doc.createdAt ?? '2026-01-01T00:00:00.000Z',
    folder: doc.folder ?? null,
    id: doc.id,
    parent: doc.parent ?? null,
    slug:
      doc.slug ??
      doc.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    title: doc.title,
  }))

const flatDocs = buildDocs([
  { id: 1, title: 'Home' },
  { id: 2, title: 'FAQ' },
  { id: 3, title: 'Contact' },
])

const nestedDocs = buildDocs([
  { id: 10, title: 'About' },
  { id: 11, parent: 10, title: 'Team' },
  { id: 12, parent: 10, title: 'Careers' },
  { id: 13, title: 'Home' },
  { id: 14, parent: 11, title: 'Leadership' },
])

describe('buildPageTreeDocs', () => {
  it('keeps the incoming order when sort is not provided', () => {
    expect(buildPageTreeDocs(flatDocs).map((doc) => doc.title)).toEqual([
      'Home',
      'FAQ',
      'Contact',
    ])
  })

  it('sorts nested siblings while preserving hierarchy', () => {
    expect(buildPageTreeDocs(nestedDocs, { sort: 'title' }).map((doc) => doc.title)).toEqual([
      'About',
      'Careers',
      'Team',
      'Leadership',
      'Home',
    ])
  })

  it('sorts nested siblings by manual order while preserving hierarchy', () => {
    const docs = buildDocs([
      { _order: 'b', id: 40, title: 'Root B' },
      { _order: 'b', id: 41, parent: 40, title: 'Child B' },
      { _order: 'a', id: 42, parent: 40, title: 'Child A' },
      { _order: 'a', id: 43, title: 'Root A' },
      { _order: 'a', id: 44, parent: 41, title: 'Grandchild A' },
    ])

    const ordered = buildPageTreeDocs(docs, { sort: '_order' })

    expect(ordered.map((doc) => doc.title)).toEqual([
      'Root A',
      'Root B',
      'Child A',
      'Child B',
      'Grandchild A',
    ])
    expect(ordered.map((doc) => doc.__pageTreeDepth)).toEqual([0, 0, 1, 1, 2])
    expect(ordered.map((doc) => doc.__pageTreeParentID)).toEqual([
      null,
      null,
      '40',
      '40',
      '41',
    ])
  })

  it('supports custom parent field slugs', () => {
    const docs = buildDocs([
      { folder: null, id: 20, title: 'Guides' },
      { folder: 20, id: 21, title: 'Getting Started' },
    ])

    expect(
      buildPageTreeDocs(docs, {
        parentFieldSlug: 'folder',
      }).map((doc) => doc.__pageTreeParentID),
    ).toEqual([null, '20'])
  })

  it('breaks cycles by promoting cyclic nodes to the root', () => {
    const docs = buildDocs([
      { id: 30, parent: 31, title: 'Alpha' },
      { id: 31, parent: 30, title: 'Beta' },
      { id: 32, title: 'Gamma' },
    ])

    const ordered = buildPageTreeDocs(docs, { sort: 'title' })

    expect(ordered).toHaveLength(3)
    expect(ordered.every((doc) => doc.__pageTreeDepth === 0)).toBe(true)
  })
})

describe('getVisibleTreeDocs', () => {
  it('hides descendants of collapsed nodes', () => {
    const docs = buildPageTreeDocs(nestedDocs)
    const hidden = getVisibleTreeDocs(docs, new Set(['10']))

    expect(hidden.map((doc) => doc.title)).toEqual(['About', 'Home'])
  })
})
