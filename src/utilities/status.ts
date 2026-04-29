import type {
  PageTreeSourceDoc,
  NestedDocsPageTreePluginBadgeMap,
  NestedDocsPageTreePluginBadgeStatus,
} from '../types.js'

export type PageTreeDisplayStatus = 'changed' | 'draft' | 'published' | 'unknown'

function isBadgeStatus(status: PageTreeDisplayStatus): status is NestedDocsPageTreePluginBadgeStatus {
  return status === 'changed' || status === 'draft' || status === 'published'
}

export function getPageTreeDisplayStatus(
  doc: Pick<PageTreeSourceDoc, '_displayStatus' | '_status'>,
): PageTreeDisplayStatus {
  if (doc._displayStatus === 'changed') {
    return 'changed'
  }

  if (doc._displayStatus === 'draft') {
    return 'draft'
  }

  if (doc._displayStatus === 'published') {
    return 'published'
  }

  if (doc._status === 'draft') {
    return 'draft'
  }

  if (doc._status === 'published') {
    return 'published'
  }

  return 'unknown'
}

export function getPageTreeDisplayStatusLabelKey(status: PageTreeDisplayStatus):
  | 'version:draft'
  | 'version:changed'
  | 'version:published'
  | 'general:noValue' {
  if (status === 'changed') {
    return 'version:changed'
  }

  if (status === 'draft') {
    return 'version:draft'
  }

  if (status === 'published') {
    return 'version:published'
  }

  return 'general:noValue'
}

export function getPageTreeBadgeColor(args: {
  badgeColors: NestedDocsPageTreePluginBadgeMap
  status: PageTreeDisplayStatus
}): string | undefined {
  const { badgeColors, status } = args

  if (!isBadgeStatus(status)) {
    return undefined
  }

  const badgeColor = badgeColors[status]

  return typeof badgeColor === 'string' && badgeColor.trim().length > 0
    ? badgeColor.trim()
    : undefined
}

export function getPageTreeBadgeLabel(args: {
  badgeLabels: NestedDocsPageTreePluginBadgeMap
  status: PageTreeDisplayStatus
  t: (key: ReturnType<typeof getPageTreeDisplayStatusLabelKey>) => string
}): string {
  const { badgeLabels, status, t } = args

  if (isBadgeStatus(status)) {
    const badgeLabel = badgeLabels[status]

    if (typeof badgeLabel === 'string' && badgeLabel.trim().length > 0) {
      return badgeLabel.trim()
    }
  }

  return t(getPageTreeDisplayStatusLabelKey(status))
}

export function withPageTreeDisplayStatuses(args: {
  draftDocs: PageTreeSourceDoc[]
  publishedIDs: ReadonlySet<string>
}): PageTreeSourceDoc[] {
  const { draftDocs, publishedIDs } = args

  return draftDocs.map((doc) => {
    const docID = String(doc.id ?? '')
    const hasPublishedVersion = publishedIDs.has(docID)
    const displayStatus =
      doc._status === 'draft' && hasPublishedVersion
        ? 'changed'
        : doc._status === 'draft' || doc._status === 'published'
          ? doc._status
          : undefined

    if (doc._displayStatus === displayStatus) {
      return doc
    }

    return {
      ...doc,
      _displayStatus: displayStatus,
    }
  })
}
