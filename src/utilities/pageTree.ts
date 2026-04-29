import type { PageTreeSourceDoc } from '../types.js'
export type { PageTreeSourceDoc } from '../types.js'

export type PageTreeMeta = {
  __pageTreeAncestorIDs: string[]
  __pageTreeDepth: number
  __pageTreeHasChildren: boolean
  __pageTreeID: string
  __pageTreeOrderIndex: number
  __pageTreeParentID: null | string
  __pageTreeShadeLevel: number
}

export type PageTreeDoc = PageTreeMeta & PageTreeSourceDoc

type SortToken = {
  descending: boolean
  path: string[]
}

type SortValue = null | number | string

type TreeNode = {
  doc: PageTreeSourceDoc
  id: string
  originalIndex: number
  parentID: null | string
}

const dateLikePattern = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/

export type BuildPageTreeDocsOptions = {
  parentFieldSlug?: string
  sort?: string
}

export function stringifyDocID(id: number | string | undefined): string {
  return String(id ?? '')
}

export function getRelationshipID(value: unknown): null | string {
  if (typeof value === 'number' || typeof value === 'string') {
    return stringifyDocID(value)
  }

  if (value && typeof value === 'object' && 'id' in value) {
    const relationshipID = (value as { id?: number | string }).id

    if (typeof relationshipID === 'number' || typeof relationshipID === 'string') {
      return stringifyDocID(relationshipID)
    }
  }

  return null
}

export function getDocParentID(
  doc: PageTreeSourceDoc,
  parentFieldSlug = 'parent',
): null | string {
  return getRelationshipID(doc[parentFieldSlug])
}

export function getDocDisplayLabel(doc: PageTreeDoc): string {
  const title = doc.title

  if (typeof title === 'string' && title.trim().length > 0) {
    return title
  }

  if (typeof doc.slug === 'string' && doc.slug.trim().length > 0) {
    return doc.slug
  }

  return doc.__pageTreeID
}

export function getDocSlugSegment(doc: PageTreeDoc): string {
  if (typeof doc.slug === 'string' && doc.slug.trim().length > 0) {
    return doc.slug.trim().replace(/^\/+|\/+$/g, '')
  }

  return doc.__pageTreeID
}

export function buildDocSlugPath(args: {
  doc: PageTreeDoc
  docsByID: Map<string, PageTreeDoc>
}): string {
  const { doc, docsByID } = args
  const segments = doc.__pageTreeAncestorIDs
    .map((ancestorID) => docsByID.get(ancestorID))
    .filter((ancestorDoc): ancestorDoc is PageTreeDoc => Boolean(ancestorDoc))
    .map(getDocSlugSegment)

  segments.push(getDocSlugSegment(doc))

  return `/${segments.filter(Boolean).join('/')}`
}

export function buildProspectiveDocSlugPath(args: {
  activeDoc: PageTreeDoc
  docsByID: Map<string, PageTreeDoc>
  targetDoc?: PageTreeDoc
}): string {
  const { activeDoc, docsByID, targetDoc } = args

  if (!targetDoc) {
    return `/${getDocSlugSegment(activeDoc)}`
  }

  const segments = targetDoc.__pageTreeAncestorIDs
    .map((ancestorID) => docsByID.get(ancestorID))
    .filter((ancestorDoc): ancestorDoc is PageTreeDoc => Boolean(ancestorDoc))
    .map(getDocSlugSegment)

  segments.push(getDocSlugSegment(targetDoc), getDocSlugSegment(activeDoc))

  return `/${segments.filter(Boolean).join('/')}`
}

export function buildChildrenByParentID(args: {
  docs: PageTreeSourceDoc[]
  parentFieldSlug?: string
}): Map<null | string, string[]> {
  const { docs, parentFieldSlug = 'parent' } = args
  const childrenByParentID = new Map<null | string, string[]>()

  for (const doc of docs) {
    const docID = stringifyDocID(doc.id)
    const parentID = getDocParentID(doc, parentFieldSlug)
    const existingChildren = childrenByParentID.get(parentID) ?? []

    existingChildren.push(docID)
    childrenByParentID.set(parentID, existingChildren)
  }

  return childrenByParentID
}

export function collectDescendantIDs(
  rootID: string,
  childrenByParentID: Map<null | string, string[]>,
): string[] {
  const descendantIDs: string[] = []
  const stack = [...(childrenByParentID.get(rootID) ?? [])]

  while (stack.length > 0) {
    const currentID = stack.pop()

    if (!currentID) {
      continue
    }

    descendantIDs.push(currentID)
    stack.push(...(childrenByParentID.get(currentID) ?? []))
  }

  return descendantIDs
}

function getCycleNodeIDs(nodes: TreeNode[], nodesByID: Map<string, TreeNode>): Set<string> {
  const cycleNodeIDs = new Set<string>()
  const pathStack: string[] = []
  const visitState = new Map<string, 'done' | 'visiting'>()

  const walk = (node: TreeNode) => {
    const currentState = visitState.get(node.id)

    if (currentState === 'done') {
      return
    }

    if (currentState === 'visiting') {
      const cycleStartIndex = pathStack.lastIndexOf(node.id)
      const cycleIDs = cycleStartIndex >= 0 ? pathStack.slice(cycleStartIndex) : [node.id]

      for (const cycleID of cycleIDs) {
        cycleNodeIDs.add(cycleID)
      }

      return
    }

    visitState.set(node.id, 'visiting')
    pathStack.push(node.id)

    if (node.parentID !== null) {
      const parentNode = nodesByID.get(node.parentID)

      if (parentNode) {
        walk(parentNode)
      }
    }

    pathStack.pop()
    visitState.set(node.id, 'done')
  }

  for (const node of nodes) {
    walk(node)
  }

  return cycleNodeIDs
}

function parseSortTokens(sort?: string): SortToken[] {
  if (typeof sort !== 'string' || sort.trim().length === 0) {
    return []
  }

  return sort
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => {
      const descending = token.startsWith('-')
      const normalizedToken = descending ? token.slice(1) : token

      return {
        descending,
        path: normalizedToken.split('.').filter(Boolean),
      }
    })
    .filter((token) => token.path.length > 0)
}

function resolveSortValue(source: unknown, path: string[]): SortValue | undefined {
  let currentValue = source

  for (const segment of path) {
    if (!currentValue || typeof currentValue !== 'object' || Array.isArray(currentValue)) {
      return undefined
    }

    if (!(segment in currentValue)) {
      return undefined
    }

    currentValue = (currentValue as Record<string, unknown>)[segment]
  }

  if (currentValue === null || currentValue === undefined) {
    return null
  }

  if (currentValue instanceof Date) {
    const timestamp = currentValue.getTime()

    return Number.isNaN(timestamp) ? undefined : timestamp
  }

  if (typeof currentValue === 'boolean') {
    return currentValue ? 1 : 0
  }

  if (typeof currentValue === 'number') {
    return Number.isFinite(currentValue) ? currentValue : undefined
  }

  if (typeof currentValue !== 'string') {
    return undefined
  }

  const normalizedValue = currentValue.trim()

  if (dateLikePattern.test(normalizedValue)) {
    const timestamp = Date.parse(normalizedValue)

    if (!Number.isNaN(timestamp)) {
      return timestamp
    }
  }

  return normalizedValue
}

function compareSortValues(leftValue: SortValue, rightValue: SortValue): number {
  if (leftValue === null && rightValue === null) {
    return 0
  }

  if (leftValue === null) {
    return -1
  }

  if (rightValue === null) {
    return 1
  }

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    if (leftValue === rightValue) {
      return 0
    }

    return leftValue < rightValue ? -1 : 1
  }

  // Plain lexicographic comparison. Required for fractional-indexing keys (e.g. `_order`
  // values like `a5`, `a53`, `a5i`), which encode position as raw lex order — using
  // `localeCompare` with `numeric: true` would interpret digit runs as numbers and
  // produce a different ordering than the database (e.g. `a53 > a5i` numerically vs
  // `a53 < a5i` lexicographically). It also matches MongoDB's default string ordering,
  // so children sort consistently between server-side and client-side.
  const leftString = String(leftValue)
  const rightString = String(rightValue)

  if (leftString === rightString) {
    return 0
  }

  return leftString < rightString ? -1 : 1
}

function createTreeNodeComparator(sort?: string) {
  const sortTokens = parseSortTokens(sort)

  if (sortTokens.length === 0) {
    return null
  }

  return (leftNode: TreeNode, rightNode: TreeNode): number => {
    for (const sortToken of sortTokens) {
      const leftValue = resolveSortValue(leftNode.doc, sortToken.path)
      const rightValue = resolveSortValue(rightNode.doc, sortToken.path)

      if (leftValue === undefined || rightValue === undefined) {
        continue
      }

      const comparison = compareSortValues(leftValue, rightValue)

      if (comparison !== 0) {
        return sortToken.descending ? -comparison : comparison
      }
    }

    return leftNode.originalIndex - rightNode.originalIndex
  }
}

export function buildPageTreeDocs(
  docs: PageTreeSourceDoc[],
  options: BuildPageTreeDocsOptions = {},
): PageTreeDoc[] {
  const parentFieldSlug = options.parentFieldSlug ?? 'parent'
  const nodes: TreeNode[] = docs.map((doc, index) => ({
    doc,
    id: stringifyDocID(doc.id),
    originalIndex: index,
    parentID: getDocParentID(doc, parentFieldSlug),
  }))
  const nodesByID = new Map(nodes.map((node) => [node.id, node]))
  const cycleNodeIDs = getCycleNodeIDs(nodes, nodesByID)
  const effectiveParentIDByNodeID = new Map<string, null | string>()
  const childrenByParentID = new Map<null | string, TreeNode[]>()
  const compareTreeNodes = createTreeNodeComparator(options.sort)

  for (const node of nodes) {
    const parentExists = node.parentID !== null && nodesByID.has(node.parentID)
    const effectiveParentID =
      parentExists && !cycleNodeIDs.has(node.id) ? node.parentID : null

    effectiveParentIDByNodeID.set(node.id, effectiveParentID)

    const currentChildren = childrenByParentID.get(effectiveParentID) ?? []
    currentChildren.push(node)
    childrenByParentID.set(effectiveParentID, currentChildren)
  }

  if (compareTreeNodes) {
    for (const children of childrenByParentID.values()) {
      children.sort(compareTreeNodes)
    }
  }

  const orderedDocs: PageTreeDoc[] = []
  const subtreeDepthByID = new Map<string, number>()
  const visitedNodeIDs = new Set<string>()

  const getShadeLevel = (rootMaxDepth: number, depth: number): number => {
    if (rootMaxDepth === 0) {
      return 0
    }

    return Math.max(rootMaxDepth - depth + 1, 1)
  }

  const getSubtreeDepth = (node: TreeNode): number => {
    const cachedDepth = subtreeDepthByID.get(node.id)

    if (typeof cachedDepth === 'number') {
      return cachedDepth
    }

    const children = childrenByParentID.get(node.id) ?? []

    if (children.length === 0) {
      subtreeDepthByID.set(node.id, 0)
      return 0
    }

    const depth = Math.max(...children.map((child) => getSubtreeDepth(child) + 1))
    subtreeDepthByID.set(node.id, depth)
    return depth
  }

  const visit = (node: TreeNode, ancestorIDs: string[], rootMaxDepth: number) => {
    if (visitedNodeIDs.has(node.id)) {
      return
    }

    visitedNodeIDs.add(node.id)

    const children = childrenByParentID.get(node.id) ?? []
    const depth = ancestorIDs.length
    const shadeLevel = getShadeLevel(rootMaxDepth, depth)

    orderedDocs.push({
      ...(node.doc as PageTreeSourceDoc),
      __pageTreeAncestorIDs: ancestorIDs,
      __pageTreeDepth: depth,
      __pageTreeHasChildren: children.length > 0,
      __pageTreeID: node.id,
      __pageTreeOrderIndex: orderedDocs.length,
      __pageTreeParentID: effectiveParentIDByNodeID.get(node.id) ?? null,
      __pageTreeShadeLevel: shadeLevel,
    })

    for (const child of children) {
      visit(child, [...ancestorIDs, node.id], rootMaxDepth)
    }
  }

  const roots = [...(childrenByParentID.get(null) ?? [])]

  for (const root of roots) {
    visit(root, [], getSubtreeDepth(root))
  }

  const fallbackNodes = compareTreeNodes ? [...nodes].sort(compareTreeNodes) : nodes

  for (const node of fallbackNodes) {
    if (!visitedNodeIDs.has(node.id)) {
      visit(node, [], getSubtreeDepth(node))
    }
  }

  return orderedDocs
}

export function getVisibleTreeDocs(
  docs: PageTreeDoc[],
  collapsedIDs: ReadonlySet<string>,
): PageTreeDoc[] {
  return docs.filter((doc) =>
    doc.__pageTreeAncestorIDs.every((ancestorID) => !collapsedIDs.has(ancestorID)),
  )
}
