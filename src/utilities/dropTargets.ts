import type { PageTreeDoc } from './pageTree.js'

export type PageTreeInsertDropTarget = {
  depth: number
  dropID: string
  dropType: 'insert'
  parentID: null | string
  referenceRowID: string
}

export type PageTreeRowDropTarget = {
  dropType: 'row'
  insertAfterDropID: string
  insertBeforeDropID: string
  rowID: string
}

export type PageTreeDropTarget = PageTreeInsertDropTarget | PageTreeRowDropTarget

export type PageTreeOrderPlacement = {
  nextSiblingID: null | string
  parentID: null | string
  previousSiblingID: null | string
}

function getInsertIndex(dropID: string): null | number {
  const insertIndex = Number.parseInt(dropID.split(':')[1] ?? '', 10)

  return Number.isNaN(insertIndex) ? null : insertIndex
}

function getMovingSubtreeIDs(docs: PageTreeDoc[], activeDoc: PageTreeDoc): Set<string> {
  return new Set(
    docs
      .filter(
        (doc) =>
          doc.__pageTreeID === activeDoc.__pageTreeID ||
          doc.__pageTreeAncestorIDs.includes(activeDoc.__pageTreeID),
      )
      .map((doc) => doc.__pageTreeID),
  )
}

function getSiblingID(doc: PageTreeDoc | undefined): null | string {
  return doc?.__pageTreeID ?? null
}

export function buildInsertDropTargets(docs: PageTreeDoc[]): PageTreeInsertDropTarget[] {
  if (docs.length === 0) {
    return []
  }

  return Array.from({ length: docs.length + 1 }, (_, index) => {
    const referenceDoc = docs[index] ?? docs[docs.length - 1]

    return {
      depth: referenceDoc.__pageTreeDepth,
      dropID: `page-insert:${index}`,
      dropType: 'insert',
      parentID: referenceDoc.__pageTreeParentID,
      referenceRowID: referenceDoc.__pageTreeID,
    }
  })
}

export function getDropTargetParentDoc(args: {
  docsByID: ReadonlyMap<string, PageTreeDoc>
  dropTarget: null | PageTreeDropTarget
}): null | PageTreeDoc {
  const { docsByID, dropTarget } = args

  if (!dropTarget) {
    return null
  }

  if (dropTarget.dropType === 'row') {
    return docsByID.get(dropTarget.rowID) ?? null
  }

  if (dropTarget.parentID === null) {
    return null
  }

  return docsByID.get(dropTarget.parentID) ?? null
}

export function getOrderPlacementFromDropTarget(args: {
  activeDoc: PageTreeDoc
  docs: PageTreeDoc[]
  docsByID: ReadonlyMap<string, PageTreeDoc>
  dropTarget: null | PageTreeDropTarget
}): null | PageTreeOrderPlacement {
  const { activeDoc, docs, docsByID, dropTarget } = args

  if (!dropTarget) {
    return null
  }

  const movingSubtreeIDs = getMovingSubtreeIDs(docs, activeDoc)

  if (dropTarget.dropType === 'row') {
    const targetDoc = docsByID.get(dropTarget.rowID)

    if (!targetDoc) {
      return null
    }

    const childSiblings = docs.filter(
      (doc) =>
        doc.__pageTreeParentID === targetDoc.__pageTreeID &&
        !movingSubtreeIDs.has(doc.__pageTreeID),
    )

    return {
      nextSiblingID: null,
      parentID: targetDoc.__pageTreeID,
      previousSiblingID: getSiblingID(childSiblings.at(-1)),
    }
  }

  const insertIndex = getInsertIndex(dropTarget.dropID)

  if (insertIndex === null) {
    return null
  }

  const parentID = dropTarget.parentID
  const beforeSiblings = docs
    .slice(0, insertIndex)
    .filter((doc) => doc.__pageTreeParentID === parentID && !movingSubtreeIDs.has(doc.__pageTreeID))
  const afterSiblings = docs
    .slice(insertIndex)
    .filter((doc) => doc.__pageTreeParentID === parentID && !movingSubtreeIDs.has(doc.__pageTreeID))

  return {
    nextSiblingID: getSiblingID(afterSiblings[0]),
    parentID,
    previousSiblingID: getSiblingID(beforeSiblings.at(-1)),
  }
}
