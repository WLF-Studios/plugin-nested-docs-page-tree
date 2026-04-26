import type {
  ColumnPreference,
  ListQuery,
  ListViewClientProps,
  PaginatedDocs,
  Params,
} from 'payload'

import React from 'react'
import { getColumns, renderTable } from '@payloadcms/ui/rsc'
import { getClientConfig } from '@payloadcms/ui/utilities/getClientConfig'
import { applyLocaleFiltering, combineWhereConstraints, mergeListSearchAndWhere } from 'payload/shared'

import PageTreeListViewClient from './PageTreeListView.client.js'
import { buildPageTreeDocs } from '../utilities/pageTree.js'
import { getCollectionPageTreeConfig } from '../utilities/pageTreeConfig.js'
import { withPageTreeDisplayStatuses } from '../utilities/status.js'
import type { PageTreeSourceDoc } from '../types.js'

type ParsedQuery = Partial<ListQuery> & Record<string, unknown>
type ServerListViewProps = Record<string, any>

function isNumericSegment(segment: string): boolean {
  return /^\d+$/.test(segment)
}

function getKeySegments(key: string): string[] {
  const matches = key.match(/([^[\]]+)/g)
  return matches ? matches.filter(Boolean) : [key]
}

function setNestedValue(target: Record<string, unknown>, key: string, value: string): void {
  const segments = getKeySegments(key)

  if (segments.length === 0) {
    return
  }

  let current: Record<string, unknown> | unknown[] = target

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const isLastSegment = index === segments.length - 1
    const nextSegment = segments[index + 1]
    const nextContainer: Record<string, unknown> | unknown[] = isNumericSegment(nextSegment ?? '')
      ? []
      : {}

    if (isLastSegment) {
      if (Array.isArray(current)) {
        const arrayIndex = Number(segment)
        current[arrayIndex] = value
      } else {
        const existingValue = current[segment]

        if (existingValue === undefined) {
          current[segment] = value
        } else if (Array.isArray(existingValue)) {
          existingValue.push(value)
        } else {
          current[segment] = [existingValue, value]
        }
      }

      return
    }

    if (Array.isArray(current)) {
      const arrayIndex = Number(segment)
      const existingValue = current[arrayIndex]

      if (
        typeof existingValue !== 'object' ||
        existingValue === null ||
        Array.isArray(existingValue) !== Array.isArray(nextContainer)
      ) {
        current[arrayIndex] = nextContainer
      }

      current = current[arrayIndex] as Record<string, unknown> | unknown[]
      continue
    }

    const existingValue = current[segment]

    if (
      typeof existingValue !== 'object' ||
      existingValue === null ||
      Array.isArray(existingValue) !== Array.isArray(nextContainer)
    ) {
      current[segment] = nextContainer
    }

    current = current[segment] as Record<string, unknown> | unknown[]
  }
}

function parseSearchParams(searchParams?: Params): ParsedQuery {
  const parsed: ParsedQuery = {}

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') {
          setNestedValue(parsed, key, entry)
        }
      }
    } else if (typeof value === 'string') {
      setNestedValue(parsed, key, value)
    }
  }

  for (const key of ['columns', 'queryByGroup']) {
    if (typeof parsed[key] === 'string') {
      try {
        parsed[key] = JSON.parse(parsed[key] as string)
      } catch {
        // Leave invalid persisted values untouched and let Payload ignore them.
      }
    }
  }

  const sanitized: ParsedQuery = { ...parsed }

  for (const [key, value] of Object.entries(sanitized)) {
    if (
      key === 'columns' &&
      ((typeof value === 'string' && value === '[]') ||
        (Array.isArray(value) && value.length === 0))
    ) {
      delete sanitized[key]
      continue
    }

    if (
      key === 'where' &&
      typeof value === 'object' &&
      value !== null &&
      !Object.keys(value).length
    ) {
      delete sanitized[key]
      continue
    }

    if ((key === 'limit' || key === 'page') && typeof value === 'string') {
      const parsedValue = Number.parseInt(value, 10)
      sanitized[key] = Number.isNaN(parsedValue) ? undefined : parsedValue
    }

    if (key === 'page' && value === 0) {
      delete sanitized[key]
      continue
    }

    if (value === '') {
      delete sanitized[key]
    }
  }

  return sanitized
}

function getQueryValue<T>(incomingValue: T | undefined, fallbackValue: T): T {
  return incomingValue === undefined ? fallbackValue : incomingValue
}

function normalizeLimit(value: unknown, fallback: number): number {
  return typeof value === 'number' && value > 0 ? value : fallback
}

function normalizePage(value: unknown, fallback: number): number {
  return typeof value === 'number' && value > 0 ? value : fallback
}

function normalizeSearch(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeSort(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const sortValues = value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    )
    return sortValues.length > 0 ? sortValues.join(',') : undefined
  }

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getOrderableFieldName(collectionConfig: ServerListViewProps['collectionConfig']) {
  return collectionConfig.orderable === true ? '_order' : undefined
}

function getDefaultSort(collectionConfig: ServerListViewProps['collectionConfig']) {
  return typeof collectionConfig.defaultSort === 'string' ? collectionConfig.defaultSort : undefined
}

function getEffectiveTreeSort(args: {
  defaultSort?: string
  orderableFieldName?: string
  sort?: string
}): string | undefined {
  const { defaultSort, orderableFieldName, sort } = args

  if (sort) {
    return sort
  }

  if (
    orderableFieldName &&
    (defaultSort === orderableFieldName || defaultSort === `-${orderableFieldName}`)
  ) {
    return defaultSort
  }

  return undefined
}

function normalizeWhere(value: unknown): any {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }

  return undefined
}

function getCurrentQuery(props: ServerListViewProps, fallbackLimit: number): ListQuery {
  const parsedSearchQuery = parseSearchParams(props.searchParams)
  const preferenceQuery = (props.listPreferences ?? {}) as Partial<ListQuery>
  const mergedQuery = {
    ...preferenceQuery,
    ...parsedSearchQuery,
  } as ParsedQuery

  return {
    ...mergedQuery,
    limit: normalizeLimit(
      getQueryValue(mergedQuery.limit as number | undefined, fallbackLimit),
      fallbackLimit,
    ),
    page: normalizePage(
      getQueryValue(mergedQuery.page as number | undefined, props.data.page),
      props.data.page,
    ),
    search: normalizeSearch(mergedQuery.search),
    sort: normalizeSort(mergedQuery.sort) ?? normalizeSort(preferenceQuery.sort) ?? undefined,
    where: normalizeWhere(mergedQuery.where),
  }
}

function getBaseFilterArgs(
  props: ServerListViewProps,
  req: any,
  query: ListQuery,
  locale?: string,
) {
  return {
    limit: 0,
    locale,
    page: 1,
    req,
    sort:
      normalizeSort(query.sort) ??
      (typeof props.collectionConfig.defaultSort === 'string'
        ? props.collectionConfig.defaultSort
        : 'id'),
  }
}

async function getDocsWithDisplayStatus(args: {
  collectionConfig: ServerListViewProps['collectionConfig']
  collectionSlug: string
  docs: PageTreeSourceDoc[]
  locale?: string
  payload: any
  req: any
  user: unknown
}): Promise<PageTreeSourceDoc[]> {
  const { collectionConfig, collectionSlug, docs, locale, payload, req, user } = args

  if (!collectionConfig.versions?.drafts || docs.length === 0) {
    return docs
  }

  const docIDs = docs
    .map((doc) => doc.id)
    .filter((id): id is number | string => typeof id === 'number' || typeof id === 'string')

  if (docIDs.length === 0) {
    return docs
  }

  const currentResult = await payload.find({
    collection: collectionSlug,
    depth: 0,
    fallbackLocale: false,
    locale,
    pagination: false,
    req,
    select: {
      _status: true,
      id: true,
    },
    user,
    where: {
      id: {
        in: docIDs,
      },
    },
  } as never)

  return withPageTreeDisplayStatuses({
    currentDocs: currentResult.docs as Pick<PageTreeSourceDoc, '_status' | 'id'>[],
    draftDocs: docs,
  })
}

async function getListClientConfig({
  collectionSlug,
  i18n,
  payload,
  req,
  user,
}: {
  collectionSlug: string
  i18n: unknown
  payload: any
  req: any
  user: unknown
}): Promise<{
  clientCollectionConfig: any
  clientConfig: any
}> {
  const clientConfig = getClientConfig({
    config: payload.config,
    i18n: i18n as never,
    importMap: payload.importMap,
    user: (user ?? true) as never,
  } as never)

  await applyLocaleFiltering({
    clientConfig,
    config: payload.config,
    req,
  } as never)

  const clientCollectionConfig = clientConfig.collections.find(
    (collection) => collection.slug === collectionSlug,
  )

  if (!clientCollectionConfig) {
    throw new Error(`Could not resolve client collection config for "${collectionSlug}"`)
  }

  return {
    clientCollectionConfig,
    clientConfig,
  }
}

export async function NestedDocsPageTreeListView(props: ServerListViewProps) {
  const pageTreeConfig = getCollectionPageTreeConfig(props.collectionConfig)

  if (!pageTreeConfig) {
    throw new Error(`Could not resolve page tree config for "${props.collectionSlug}"`)
  }

  if (typeof props.collectionConfig.admin.useAsTitle !== 'string') {
    throw new Error(`Collection "${props.collectionSlug}" must define admin.useAsTitle`)
  }

  const query = getCurrentQuery(props, pageTreeConfig.defaultLimit)
  const orderableFieldName = getOrderableFieldName(props.collectionConfig)
  const defaultSort = getDefaultSort(props.collectionConfig)
  const effectiveSort = getEffectiveTreeSort({
    defaultSort,
    orderableFieldName,
    sort: normalizeSort(query.sort),
  })
  const effectiveQuery = {
    ...query,
    sort: effectiveSort,
  }
  const locale = props.locale?.code
  const req = {
    i18n: props.i18n,
    locale,
    payload: props.payload,
    query: effectiveQuery,
    user: props.user,
  }

  const baseFilter =
    props.collectionConfig.admin?.baseFilter ?? props.collectionConfig.admin?.baseListFilter
  const baseFilterConstraint = baseFilter
    ? await baseFilter(getBaseFilterArgs(props, req, query, locale))
    : undefined
  const mergedWhere = combineWhereConstraints([
    mergeListSearchAndWhere({
      collectionConfig: props.collectionConfig,
      search: normalizeSearch(query.search),
      where: normalizeWhere(query.where),
    } as never),
    baseFilterConstraint ?? undefined,
  ])
  const where = Object.keys(mergedWhere).length > 0 ? mergedWhere : undefined

  const fullResult = await props.payload.find({
    collection: props.collectionSlug,
    depth: 0,
    draft: props.collectionConfig.versions?.drafts ? true : undefined,
    fallbackLocale: false,
    includeLockStatus: true,
    locale,
    pagination: false,
    req,
    sort:
      normalizeSort(query.sort) ??
      defaultSort,
    user: props.user,
    where,
  } as never)
  const treeSourceDocs = await getDocsWithDisplayStatus({
    collectionConfig: props.collectionConfig,
    collectionSlug: props.collectionSlug,
    docs: fullResult.docs as unknown as PageTreeSourceDoc[],
    locale,
    payload: props.payload,
    req,
    user: props.user,
  })

  const orderedDocs = buildPageTreeDocs(treeSourceDocs, {
    parentFieldSlug: pageTreeConfig.parentFieldSlug,
    sort: effectiveSort,
  })
  const orderedData: PaginatedDocs = {
    docs: orderedDocs,
    hasNextPage: false,
    hasPrevPage: false,
    limit: normalizeLimit(query.limit, pageTreeConfig.defaultLimit),
    nextPage: null,
    page: 1,
    pagingCounter: orderedDocs.length > 0 ? 1 : 0,
    prevPage: null,
    totalDocs: orderedDocs.length,
    totalPages: 1,
  }
  const { clientCollectionConfig, clientConfig } = await getListClientConfig({
    collectionSlug: props.collectionSlug,
    i18n: props.i18n,
    payload: props.payload,
    req,
    user: props.user,
  })
  const columnPreferences: ColumnPreference[] = (props.columnState as Array<{
    accessor: string
    active: boolean
  }>).map(({ accessor, active }) => ({
    accessor,
    active: accessor === props.collectionConfig.admin.useAsTitle ? true : active,
  }))
  const columns = getColumns({
    clientConfig,
    collectionConfig: clientCollectionConfig,
    collectionSlug: props.collectionSlug,
    columns: columnPreferences,
    i18n: props.i18n,
    permissions: props.permissions,
  } as never)
  const fieldPermissions = props.permissions?.collections?.[props.collectionSlug]?.fields ?? true
  const renderedTable = await renderTable({
    clientCollectionConfig,
    clientConfig,
    collectionConfig: props.collectionConfig,
    columns,
    data: orderedData,
    enableRowSelections: Boolean(props.enableRowSelections),
    fieldPermissions,
    i18n: props.i18n,
    orderableFieldName: orderableFieldName ?? '',
    payload: props.payload,
    query: effectiveQuery,
    req,
    tableAppearance: 'default',
    useAsTitle: props.collectionConfig.admin.useAsTitle,
    viewType: props.viewType,
  } as never)
  const clientProps: Omit<ListViewClientProps, 'Table' | 'columnState'> = {
    AfterList: props.AfterList,
    AfterListTable: props.AfterListTable,
    BeforeList: props.BeforeList,
    BeforeListTable: props.BeforeListTable,
    Description: props.Description,
    beforeActions: props.beforeActions,
    collectionSlug: props.collectionSlug,
    disableBulkDelete: props.disableBulkDelete,
    disableBulkEdit: props.disableBulkEdit,
    disableQueryPresets: props.disableQueryPresets,
    enableRowSelections: props.enableRowSelections,
    hasCreatePermission: props.hasCreatePermission,
    hasDeletePermission: props.hasDeletePermission,
    hasTrashPermission: props.hasTrashPermission,
    listMenuItems: props.listMenuItems,
    listPreferences: props.listPreferences,
    newDocumentURL: props.newDocumentURL,
    preferenceKey: props.preferenceKey,
    queryPreset: props.queryPreset,
    queryPresetPermissions: props.queryPresetPermissions,
    renderedFilters: props.renderedFilters,
    resolvedFilterOptions: props.resolvedFilterOptions,
    viewType: props.viewType,
  }
  const canMoveDocs = Boolean(props.permissions?.collections?.[props.collectionSlug]?.update)

  return (
    <PageTreeListViewClient
      {...clientProps}
      allDocs={orderedDocs}
      badgeConfig={pageTreeConfig.badges}
      canMoveDocs={canMoveDocs}
      columnState={renderedTable.columnState}
      homeIndicatorEnabled={pageTreeConfig.homeIndicator.enabled}
      orderableFieldName={orderableFieldName}
      parentFieldSlug={pageTreeConfig.parentFieldSlug}
      query={effectiveQuery}
      sourceDocs={treeSourceDocs}
      useAsTitle={props.collectionConfig.admin.useAsTitle}
    />
  )
}

export default NestedDocsPageTreeListView
