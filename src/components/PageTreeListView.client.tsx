'use client'

import type { Column, ListQuery, ListViewClientProps, PaginatedDocs } from 'payload'

import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  type SortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import {
  DefaultListView,
  ListQueryProvider,
  Pill,
  SelectAll,
  SelectRow,
  SortHeader,
  toast,
  useConfig,
  useLocale,
  usePreferences,
  useTranslation,
  useWindowInfo,
} from '@payloadcms/ui'
import { useRouter, useSearchParams } from 'next/navigation'
import React from 'react'
import { createPortal } from 'react-dom'

import type {
  NestedDocsPageTreePluginBadgesLinks,
  NestedDocsPageTreePluginResolvedBadgeConfig,
  PageTreeSourceDoc,
} from '../types.js'

import {
  buildInsertDropTargets,
  getDropTargetParentDoc,
  type PageTreeDropTarget,
} from '../utilities/dropTargets.js'
import {
  CANCEL_DRAG_MESSAGE,
  getDropValidation,
  type PageTreeDropValidation,
} from '../utilities/moveValidation.js'
import {
  buildDocSlugPath,
  buildPageTreeDocs,
  buildProspectiveDocSlugPath,
  getDocDisplayLabel,
  getVisibleTreeDocs,
  type PageTreeDoc,
} from '../utilities/pageTree.js'
import { pageTreeCollisionDetectionStrategy } from '../utilities/pageTreeCollision.js'
import { PageTreeStatusBadge } from './PageTreeStatusBadge.js'
import { PageTreeProvider, PageTreeRowDndProvider } from './PageTreeContext.js'
import styles from './PageTreeListView.module.css'
import { PageTreeTitleCell } from './PageTreeTitleCell.js'

type PageTreeListViewClientProps = {
  allDocs: PageTreeDoc[]
  badgeConfig: NestedDocsPageTreePluginResolvedBadgeConfig
  badgesLinks?: NestedDocsPageTreePluginBadgesLinks
  canMoveDocs: boolean
  columnState: Column[]
  homeIndicatorEnabled: boolean
  orderableFieldName?: string
  parentFieldSlug: string
  query: ListQuery
  sourceDocs: PageTreeSourceDoc[]
  useAsTitle: string
} & Omit<ListViewClientProps, 'columnState' | 'Table'>

type SelectableRowData = React.ComponentProps<typeof SelectRow>['rowData']
type PageTreeDragType = 'move' | 'order'

type PageTreeDragData = {
  dragType?: PageTreeDragType
  parentID?: null | string
  rowID?: string
}

type PageTreeSortableTransform = ReturnType<typeof useSortable>['transform']

type PageTreeReorderRequestBody = {
  docsToMove: string[]
  frontendOrder?: PageTreeReorderFrontendOrder
  newKeyWillBe: 'greater' | 'less'
  orderableFieldName: string
  target: {
    id: string
    key: null | string
  }
}

type PageTreeReorderFrontendOrder = {
  activeSlug: null | string
  after: PageTreeReorderFrontendOrderEntry[]
  before: PageTreeReorderFrontendOrderEntry[]
  moveFromIndex: number
  moveToIndex: number
  newAfterRowSlug: null | string
  newBeforeRowSlug: null | string
  sort: null | string
  targetSlug: null | string
}

type PageTreeReorderFrontendOrderEntry = {
  index: number
  orderKey: null | string
  slug: null | string
}

type PageTreeIndexRange = {
  end: number
  start: number
}

type PageTreeRangeRect = {
  bottom: number
  height: number
  top: number
}

const SILENT_MOVE_MESSAGES = new Set([CANCEL_DRAG_MESSAGE])
const ALREADY_ROOT_MESSAGE = 'This page is already in root level.'

function getParentMovePreferenceKey(collectionSlug: string): string {
  return `payload-nested-docs-page-tree:${collectionSlug}:parentMoveHandle`
}

function getRowDropID(rowID: string): string {
  return `page-drop:${rowID}`
}

function getSortableRowID(rowID: string): string {
  return `page-sort:${rowID}`
}

function getDiagnosticString(value: unknown): null | string {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function getPageTreeDragData(value: unknown): PageTreeDragData {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const data = value as Record<string, unknown>
  const dragType = data.dragType === 'move' || data.dragType === 'order' ? data.dragType : undefined
  const parentID =
    data.parentID === null || typeof data.parentID === 'string' ? data.parentID : undefined
  const rowID = typeof data.rowID === 'string' ? data.rowID : undefined

  return {
    dragType,
    parentID,
    rowID,
  }
}

function getSortableTransform(transform: PageTreeSortableTransform): string | undefined {
  if (!transform) {
    return undefined
  }

  const scaleX = transform.scaleX ?? 1
  const scaleY = transform.scaleY ?? 1

  return `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${scaleX}) scaleY(${scaleY})`
}

function getVisibleSubtreeIndexRange(docs: PageTreeDoc[], rootIndex: number): null | PageTreeIndexRange {
  const rootDoc = docs[rootIndex]

  if (!rootDoc) {
    return null
  }

  let end = rootIndex

  for (let index = rootIndex + 1; index < docs.length; index += 1) {
    if (!docs[index]?.__pageTreeAncestorIDs.includes(rootDoc.__pageTreeID)) {
      break
    }

    end = index
  }

  return {
    end,
    start: rootIndex,
  }
}

function getRangeRect(args: {
  activeNodeRect: Parameters<SortingStrategy>[0]['activeNodeRect']
  activeRange: PageTreeIndexRange
  range: PageTreeIndexRange
  rects: Parameters<SortingStrategy>[0]['rects']
}): null | PageTreeRangeRect {
  const { activeNodeRect, activeRange, range, rects } = args
  const firstRect =
    rects[range.start] ?? (range.start === activeRange.start ? activeNodeRect : undefined)
  const lastRect = rects[range.end] ?? (range.end === activeRange.end ? activeNodeRect : undefined)

  if (!firstRect || !lastRect) {
    return null
  }

  return {
    bottom: lastRect.top + lastRect.height,
    height: lastRect.top + lastRect.height - firstRect.top,
    top: firstRect.top,
  }
}

function isIndexInRange(index: number, range: PageTreeIndexRange): boolean {
  return index >= range.start && index <= range.end
}

function buildPageTreeSortingStrategy(docs: PageTreeDoc[]): SortingStrategy {
  return ({ activeIndex, activeNodeRect, index, overIndex, rects }) => {
    const activeRange = getVisibleSubtreeIndexRange(docs, activeIndex)
    const overRange = getVisibleSubtreeIndexRange(docs, overIndex)

    if (!activeRange || !overRange || activeRange.start === overRange.start) {
      return null
    }

    const activeRect = getRangeRect({
      activeNodeRect,
      activeRange,
      range: activeRange,
      rects,
    })
    const overRect = getRangeRect({
      activeNodeRect,
      activeRange,
      range: overRange,
      rects,
    })

    if (!activeRect || !overRect) {
      return null
    }

    if (isIndexInRange(index, activeRange)) {
      return {
        scaleX: 1,
        scaleY: 1,
        x: 0,
        y:
          activeRange.start < overRange.start
            ? overRect.bottom - activeRect.bottom
            : overRect.top - activeRect.top,
      }
    }

    if (activeRange.start < overRange.start && index > activeRange.end && index <= overRange.end) {
      return {
        scaleX: 1,
        scaleY: 1,
        x: 0,
        y: -activeRect.height,
      }
    }

    if (activeRange.start > overRange.start && index >= overRange.start && index < activeRange.start) {
      return {
        scaleX: 1,
        scaleY: 1,
        x: 0,
        y: activeRect.height,
      }
    }

    return {
      scaleX: 1,
      scaleY: 1,
      x: 0,
      y: 0,
    }
  }
}

function buildPaginatedData(
  docs: PageTreeDoc[],
  limit: number,
  requestedPage: number,
): PaginatedDocs {
  const totalDocs = docs.length
  const totalPages = totalDocs > 0 ? Math.max(1, Math.ceil(totalDocs / limit)) : 1
  const page = Math.min(Math.max(requestedPage, 1), totalPages)
  const startIndex = (page - 1) * limit
  const pageDocs = docs.slice(startIndex, startIndex + limit)

  return {
    docs: pageDocs,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    limit,
    nextPage: page < totalPages ? page + 1 : null,
    page,
    pagingCounter: totalDocs === 0 ? 0 : startIndex + 1,
    prevPage: page > 1 ? page - 1 : null,
    totalDocs,
    totalPages,
  }
}

function normalizeSort(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    const sortValues = value.filter((entry) => typeof entry === 'string' && entry.length > 0)
    return sortValues.length > 0 ? sortValues.join(',') : undefined
  }

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function normalizePositiveInt(value: null | string, fallback: number): number {
  if (typeof value !== 'string') {
    return fallback
  }

  const parsedValue = Number.parseInt(value, 10)
  return Number.isNaN(parsedValue) || parsedValue <= 0 ? fallback : parsedValue
}

function isOrderableSortActive(args: { orderableFieldName?: string; sort?: string }): boolean {
  const { orderableFieldName, sort } = args

  return Boolean(
    orderableFieldName && (sort === orderableFieldName || sort === `-${orderableFieldName}`),
  )
}

function ensureUseAsTitleColumn(columnState: Column[], useAsTitle: string): Column[] {
  return columnState.map((column) =>
    column.accessor === useAsTitle
      ? {
          ...column,
          active: true,
        }
      : column,
  )
}

function sliceColumnState(
  columnState: Column[],
  docs: PageTreeDoc[],
  renderedCellIndexByDocID: ReadonlyMap<string, number>,
): Column[] {
  return columnState.map((column) => ({
    ...column,
    renderedCells: docs.map((doc) => {
      const renderedCellIndex =
        renderedCellIndexByDocID.get(doc.__pageTreeID) ?? doc.__pageTreeOrderIndex

      return column.renderedCells?.[renderedCellIndex] ?? null
    }),
  }))
}

function getSelectableRowData(doc: PageTreeDoc): SelectableRowData {
  const record = doc as Record<string, unknown>

  return {
    id: String(doc.id ?? doc.__pageTreeID),
    _isLocked: Boolean(record._isLocked),
    _userEditing: record._userEditing as SelectableRowData['_userEditing'],
  }
}

function shouldSilenceMoveMessage(message?: string): boolean {
  return typeof message === 'string' && SILENT_MOVE_MESSAGES.has(message)
}

function getVisibleSubtreeRowIDs(docs: PageTreeDoc[], rowID: string): string[] {
  const rootIndex = docs.findIndex((doc) => doc.__pageTreeID === rowID)

  if (rootIndex < 0) {
    return []
  }

  const rowIDs = [rowID]

  for (const doc of docs.slice(rootIndex + 1)) {
    if (!doc.__pageTreeAncestorIDs.includes(rowID)) {
      break
    }

    rowIDs.push(doc.__pageTreeID)
  }

  return rowIDs
}

function buildOptimisticOrderRowIDs(args: {
  activeRowID: string
  docs: PageTreeDoc[]
  targetRowID: string
}): null | string[] {
  const { activeRowID, docs, targetRowID } = args

  if (activeRowID === targetRowID) {
    return null
  }

  const activeDoc = docs.find((doc) => doc.__pageTreeID === activeRowID)
  const targetDoc = docs.find((doc) => doc.__pageTreeID === targetRowID)

  if (!activeDoc || !targetDoc || activeDoc.__pageTreeParentID !== targetDoc.__pageTreeParentID) {
    return null
  }

  const activeBlockIDs = getVisibleSubtreeRowIDs(docs, activeRowID)
  const targetBlockIDs = getVisibleSubtreeRowIDs(docs, targetRowID)

  if (
    activeBlockIDs.length === 0 ||
    targetBlockIDs.length === 0 ||
    targetBlockIDs.includes(activeRowID)
  ) {
    return null
  }

  const currentRowIDs = docs.map((doc) => doc.__pageTreeID)

  if (activeBlockIDs.length === 1 && targetBlockIDs.length === 1) {
    const activeIndex = currentRowIDs.indexOf(activeRowID)
    const targetIndex = currentRowIDs.indexOf(targetRowID)

    return activeIndex < 0 || targetIndex < 0
      ? null
      : arrayMove(currentRowIDs, activeIndex, targetIndex)
  }

  const remainingRowIDs = currentRowIDs.filter((rowID) => !activeBlockIDs.includes(rowID))
  const activeIndex = currentRowIDs.indexOf(activeRowID)
  const targetIndex = currentRowIDs.indexOf(targetRowID)
  const targetAnchorID =
    activeIndex < targetIndex ? targetBlockIDs[targetBlockIDs.length - 1] : targetBlockIDs[0]

  if (!targetAnchorID) {
    return null
  }

  const targetAnchorIndex = remainingRowIDs.indexOf(targetAnchorID)

  if (targetAnchorIndex < 0) {
    return null
  }

  const insertIndex = activeIndex < targetIndex ? targetAnchorIndex + 1 : targetAnchorIndex

  return [
    ...remainingRowIDs.slice(0, insertIndex),
    ...activeBlockIDs,
    ...remainingRowIDs.slice(insertIndex),
  ]
}

function buildReorderRequestBody(args: {
  activeRowID: string
  docs: PageTreeDoc[]
  orderableFieldName?: string
  sort?: string
  targetRowID: string
}): null | PageTreeReorderRequestBody {
  const { activeRowID, docs, orderableFieldName, sort, targetRowID } = args

  if (!orderableFieldName || (sort !== orderableFieldName && sort !== `-${orderableFieldName}`)) {
    return null
  }

  if (activeRowID === targetRowID) {
    return null
  }

  const activeDoc = docs.find((doc) => doc.__pageTreeID === activeRowID)
  const targetDoc = docs.find((doc) => doc.__pageTreeID === targetRowID)

  if (!activeDoc || !targetDoc || activeDoc.__pageTreeParentID !== targetDoc.__pageTreeParentID) {
    return null
  }

  const siblingDocs = docs.filter(
    (doc) => doc.__pageTreeParentID === activeDoc.__pageTreeParentID,
  )
  const moveFromIndex = siblingDocs.findIndex((doc) => doc.__pageTreeID === activeRowID)
  const moveToIndex = siblingDocs.findIndex((doc) => doc.__pageTreeID === targetRowID)

  if (moveFromIndex < 0 || moveToIndex < 0 || moveFromIndex === moveToIndex) {
    return null
  }

  const newBeforeRow =
    moveToIndex > moveFromIndex ? siblingDocs[moveToIndex] : siblingDocs[moveToIndex - 1]
  const newAfterRow =
    moveToIndex > moveFromIndex ? siblingDocs[moveToIndex + 1] : siblingDocs[moveToIndex]
  const target = newBeforeRow ?? newAfterRow

  if (!target) {
    return null
  }

  const getFrontendOrderEntry = (
    doc: PageTreeDoc,
    index: number,
  ): PageTreeReorderFrontendOrderEntry => {
    const orderKey = doc[orderableFieldName]

    return {
      slug: getDiagnosticString(doc.slug),
      index,
      orderKey: typeof orderKey === 'string' && orderKey.length > 0 ? orderKey : null,
    }
  }
  const siblingDocsAfter = [...siblingDocs]
  const [movedSiblingDoc] = siblingDocsAfter.splice(moveFromIndex, 1)

  if (!movedSiblingDoc) {
    return null
  }

  siblingDocsAfter.splice(moveToIndex, 0, movedSiblingDoc)

  const targetKey = target[orderableFieldName]
  const newKeyWillBe =
    (newBeforeRow && sort === orderableFieldName) ||
    (!newBeforeRow && sort === `-${orderableFieldName}`)
      ? 'greater'
      : 'less'

  return {
    docsToMove: [activeRowID],
    frontendOrder: {
      activeSlug: getDiagnosticString(activeDoc.slug),
      after: siblingDocsAfter.map(getFrontendOrderEntry),
      before: siblingDocs.map(getFrontendOrderEntry),
      moveFromIndex,
      moveToIndex,
      newAfterRowSlug: newAfterRow ? getDiagnosticString(newAfterRow.slug) : null,
      newBeforeRowSlug: newBeforeRow ? getDiagnosticString(newBeforeRow.slug) : null,
      sort: sort ?? null,
      targetSlug: getDiagnosticString(targetDoc.slug),
    },
    newKeyWillBe,
    orderableFieldName,
    target: {
      id: target.__pageTreeID,
      key: typeof targetKey === 'string' && targetKey.length > 0 ? targetKey : null,
    },
  }
}

function orderDocsByRowIDs(docs: PageTreeDoc[], orderRowIDs: null | string[]): PageTreeDoc[] {
  if (!orderRowIDs) {
    return docs
  }

  const docsByID = new Map(docs.map((doc) => [doc.__pageTreeID, doc]))
  const orderedDocs = orderRowIDs.flatMap((rowID) => {
    const doc = docsByID.get(rowID)

    return doc ? [doc] : []
  })

  return orderedDocs.length === docs.length ? orderedDocs : docs
}

function getDropTargetValidation(args: {
  activeDoc: PageTreeDoc
  docsByID: ReadonlyMap<string, PageTreeDoc>
  dropTarget: PageTreeDropTarget
}): PageTreeDropValidation {
  const { activeDoc, docsByID, dropTarget } = args

  if (dropTarget.dropType === 'row') {
    return getDropValidation({
      activeDoc,
      targetDoc: docsByID.get(dropTarget.rowID) ?? undefined,
    })
  }

  if (dropTarget.parentID === null) {
    if (activeDoc.__pageTreeParentID === null) {
      return {
        isValid: false,
        message: ALREADY_ROOT_MESSAGE,
        parentID: null,
      }
    }

    return {
      isValid: true,
      parentID: null,
    }
  }

  const targetDoc = docsByID.get(dropTarget.parentID)

  if (!targetDoc) {
    return {
      isValid: false,
      message: 'Could not resolve drop target.',
      parentID: dropTarget.parentID,
    }
  }

  if (targetDoc.__pageTreeID === activeDoc.__pageTreeID) {
    return {
      isValid: false,
      message: CANCEL_DRAG_MESSAGE,
      parentID: targetDoc.__pageTreeID,
    }
  }

  if (targetDoc.__pageTreeAncestorIDs.includes(activeDoc.__pageTreeID)) {
    return {
      isValid: false,
      message: 'A document cannot be moved under one of its descendants.',
      parentID: targetDoc.__pageTreeID,
    }
  }

  return {
    isValid: true,
    parentID: targetDoc.__pageTreeID,
  }
}

function renderStatusBadge(args: {
  badgeConfig: NestedDocsPageTreePluginResolvedBadgeConfig
  badgesLinks?: NestedDocsPageTreePluginBadgesLinks
  doc: PageTreeDoc
  index: number
  t: (key: 'general:noValue' | 'version:changed' | 'version:draft' | 'version:published') => string
}): React.ReactNode {
  const { badgeConfig, badgesLinks, doc, index } = args
  return (
    <PageTreeStatusBadge
      badgeConfig={badgeConfig}
      badgesLinks={badgesLinks}
      doc={doc}
      key={doc.__pageTreeID ?? index}
    />
  )
}

function ParentMoveToggle({
  collectionSlug,
  enabled,
  onToggle,
}: {
  collectionSlug: string
  enabled: boolean
  onToggle: () => void
}) {
  const {
    breakpoints: { s: smallBreak },
  } = useWindowInfo()
  const [mobileActions, setMobileActions] = React.useState<Element | null>(null)
  const setMobileMount = React.useCallback((node: HTMLSpanElement | null) => {
    setMobileActions(
      node?.closest('.collection-list')?.querySelector('.search-bar__actions') ?? null,
    )
  }, [])
  const toggle = (
    <Pill
      aria-checked={enabled}
      aria-label={`${enabled ? 'Hide' : 'Show'} edit hierarchy handles`}
      className="pages-hierarchy-parent-move-toggle"
      id={`pages-hierarchy-parent-move-toggle-${collectionSlug}`}
      onClick={onToggle}
      pillStyle={enabled ? 'dark' : 'light'}
      size="small"
    >
      Edit Hierarchy
    </Pill>
  )

  if (smallBreak) {
    return (
      <>
        <span hidden ref={setMobileMount} />
        {mobileActions ? createPortal(toggle, mobileActions) : null}
      </>
    )
  }

  return toggle
}

function buildTableColumns(args: {
  badgeConfig: NestedDocsPageTreePluginResolvedBadgeConfig
  badgesLinks?: NestedDocsPageTreePluginBadgesLinks
  columnState: Column[]
  docs: PageTreeDoc[]
  enableRowSelections?: boolean
  homeIndicatorEnabled: boolean
  orderableFieldName?: string
  parentFieldSlug: string
  t: (key: 'general:noValue' | 'version:changed' | 'version:draft' | 'version:published') => string
  useAsTitle: string
}): Column[] {
  const {
    badgeConfig,
    badgesLinks,
    columnState,
    docs,
    enableRowSelections,
    homeIndicatorEnabled,
    orderableFieldName,
    parentFieldSlug,
    t,
    useAsTitle,
  } = args
  const columnsToUse = columnState.map((column) => {
    if (column.accessor === useAsTitle) {
      return {
        ...column,
        active: true,
        renderedCells: docs.map((doc, index) => (
          <PageTreeTitleCell
            doc={doc}
            homeIndicatorEnabled={homeIndicatorEnabled}
            key={doc.__pageTreeID ?? index}
          >
            {column.renderedCells?.[index] ?? getDocDisplayLabel(doc)}
          </PageTreeTitleCell>
        )),
      }
    }

    if (column.accessor === '_status') {
      return {
        ...column,
        renderedCells: docs.map((doc, index) =>
          renderStatusBadge({
            badgeConfig,
            badgesLinks,
            doc,
            index,
            t,
          }),
        ),
      }
    }

    if (column.accessor === parentFieldSlug) {
      return {
        ...column,
        renderedCells: docs.map((doc, index) =>
          doc.__pageTreeParentID !== null ? (
            (column.renderedCells?.[index] ?? null)
          ) : (
            <span className="pages-hierarchy-empty-cell" key={doc.__pageTreeID ?? index}>
              -
            </span>
          ),
        ),
      }
    }

    return column
  })

  if (enableRowSelections) {
    columnsToUse.unshift({
      accessor: '_select',
      active: true,
      field: { hidden: true } as Column['field'],
      Heading: <SelectAll />,
      renderedCells: docs.map((doc, index) => (
        <SelectRow key={doc.__pageTreeID ?? index} rowData={getSelectableRowData(doc)} />
      )),
    })
  }

  if (orderableFieldName) {
    const orderableColumn = {
      accessor: '_pageTreeOrderSort',
      active: true,
      field: { hidden: true } as Column['field'],
      Heading: <SortHeader />,
      renderedCells: docs.map((doc, index) => (
        <span
          aria-hidden="true"
          className="pages-hierarchy-order-sort-spacer"
          key={doc.__pageTreeID ?? index}
        />
      )),
    } satisfies Column
    const selectColumnIndex = columnsToUse.findIndex((column) => column.accessor === '_select')

    columnsToUse.splice(selectColumnIndex >= 0 ? selectColumnIndex + 1 : 0, 0, orderableColumn)
  }

  return columnsToUse
}

function HierarchyInsertRow({
  activeColumnsCount,
  activeDragRowID,
  activeDropTargetID,
  dropTarget,
  dropValidation,
  isMovePending,
}: {
  activeColumnsCount: number
  activeDragRowID: null | string
  activeDropTargetID: null | string
  dropTarget: Extract<PageTreeDropTarget, { dropType: 'insert' }>
  dropValidation?: PageTreeDropValidation
  isMovePending: boolean
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: dropTarget.dropID,
    data: dropTarget,
    disabled: isMovePending,
  })
  const hasActiveDrag = Boolean(activeDragRowID)
  const showInsertLine = isOver && activeDropTargetID === dropTarget.dropID

  return (
    <tr
      className="pages-hierarchy-insert-row"
      data-drag-over={showInsertLine ? 'true' : 'false'}
      data-drop-valid={hasActiveDrag ? (dropValidation?.isValid ? 'true' : 'false') : undefined}
      data-page-tree-insert="true"
    >
      {/* eslint-disable-next-line jsx-a11y/control-has-associated-label */}
      <td colSpan={activeColumnsCount}>
        <div
          className="pages-hierarchy-insert-row__target"
          data-insert-depth={dropTarget.depth}
          ref={setNodeRef}
        />
      </td>
    </tr>
  )
}

function HierarchyTableRow({
  activeColumns,
  activeDragRowID,
  activeDragType,
  canReorderRows,
  doc,
  dropValidation,
  insertAfterDropID,
  insertBeforeDropID,
  isMovePending,
  rowIndex,
  titleCellAccessor,
}: {
  activeColumns: Column[]
  activeDragRowID: null | string
  activeDragType: null | PageTreeDragType
  canReorderRows: boolean
  doc: PageTreeDoc
  dropValidation?: PageTreeDropValidation
  insertAfterDropID: null | string
  insertBeforeDropID: null | string
  isMovePending: boolean
  rowIndex: number
  titleCellAccessor: string
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: getRowDropID(doc.__pageTreeID),
    data: {
      dropType: 'row',
      insertAfterDropID,
      insertBeforeDropID,
      rowID: doc.__pageTreeID,
    } satisfies Extract<PageTreeDropTarget, { dropType: 'row' }>,
    disabled: isMovePending,
  })
  const sortable = useSortable({
    id: getSortableRowID(doc.__pageTreeID),
    data: {
      dragType: 'order',
      parentID: doc.__pageTreeParentID,
      rowID: doc.__pageTreeID,
    } satisfies PageTreeDragData,
    disabled: !canReorderRows || isMovePending || activeDragType === 'move',
  })
  const hasActiveMoveDrag = activeDragType === 'move' && Boolean(activeDragRowID)
  const isActiveDragRow = activeDragRowID === doc.__pageTreeID
  const setRowRef = React.useCallback(
    (element: HTMLTableRowElement | null) => {
      setNodeRef(element)
      sortable.setNodeRef(element)
    },
    [setNodeRef, sortable],
  )
  const rowDndValue = React.useMemo(
    () => ({
      isOrderDragging: sortable.isDragging,
      orderHandleAttributes: sortable.attributes,
      orderHandleListeners: sortable.listeners,
      orderHandleRef: sortable.setActivatorNodeRef,
    }),
    [sortable.attributes, sortable.isDragging, sortable.listeners, sortable.setActivatorNodeRef],
  )
  const sortableStyle = React.useMemo(
    () =>
      ({
        position: sortable.isDragging ? 'relative' : undefined,
        transform: getSortableTransform(sortable.transform),
        transition: activeDragType === 'order' ? sortable.transition : undefined,
        zIndex: sortable.isDragging ? 1 : undefined,
      }) as React.CSSProperties,
    [activeDragType, sortable.isDragging, sortable.transform, sortable.transition],
  )

  return (
    <tr
      className={`row-${rowIndex + 1}`}
      data-drag-over={activeDragType === 'move' && isOver ? 'true' : 'false'}
      data-drop-valid={hasActiveMoveDrag ? (dropValidation?.isValid ? 'true' : 'false') : undefined}
      data-id={doc.id}
      data-is-drag-source={activeDragType === 'move' && isActiveDragRow ? 'true' : 'false'}
      data-is-order-drag-source={sortable.isDragging ? 'true' : 'false'}
      data-page-tree-row="true"
      ref={setRowRef}
      style={sortableStyle}
    >
      <PageTreeRowDndProvider value={rowDndValue}>
        {activeColumns.map((column, columnIndex) => {
          const { accessor } = column

          return (
            <td
              className={`cell-${accessor.replace(/\./g, '__')}`}
              data-page-tree-title-cell={accessor === titleCellAccessor ? 'true' : undefined}
              key={columnIndex}
            >
              {column.renderedCells?.[rowIndex] ?? null}
            </td>
          )
        })}
      </PageTreeRowDndProvider>
    </tr>
  )
}

function HierarchyTable({
  activeDragRowID,
  activeDragType,
  activeDropTarget,
  allDocsByID,
  canReorderRows,
  columns,
  data,
  isMovePending,
  titleCellAccessor,
}: {
  activeDragRowID: null | string
  activeDragType: null | PageTreeDragType
  activeDropTarget: null | PageTreeDropTarget
  allDocsByID: ReadonlyMap<string, PageTreeDoc>
  canReorderRows: boolean
  columns: Column[]
  data: PageTreeDoc[]
  isMovePending: boolean
  titleCellAccessor: string
}) {
  const activeColumns = React.useMemo(() => columns.filter((column) => column?.active), [columns])
  const sortableItems = React.useMemo(
    () => data.map((doc) => getSortableRowID(doc.__pageTreeID)),
    [data],
  )
  const sortingStrategy = React.useMemo(() => buildPageTreeSortingStrategy(data), [data])
  const insertDropTargets = React.useMemo(() => buildInsertDropTargets(data), [data])
  const insertDropTargetsByReferenceRowID = React.useMemo(
    () => new Map(insertDropTargets.map((dropTarget) => [dropTarget.referenceRowID, dropTarget])),
    [insertDropTargets],
  )
  const activeDropTargetID =
    activeDropTarget?.dropType === 'insert' ? activeDropTarget.dropID : null
  const activeDoc =
    activeDragType === 'move' && activeDragRowID ? (allDocsByID.get(activeDragRowID) ?? null) : null
  const rowDropValidationByID = React.useMemo(() => {
    if (!activeDoc) {
      return new Map<string, PageTreeDropValidation>()
    }

    return new Map(
      data.map((doc) => [
        doc.__pageTreeID,
        getDropTargetValidation({
          activeDoc,
          docsByID: allDocsByID,
          dropTarget: {
            dropType: 'row',
            insertAfterDropID: null,
            insertBeforeDropID: null,
            rowID: doc.__pageTreeID,
          },
        }),
      ]),
    )
  }, [activeDoc, allDocsByID, data])
  const insertDropValidationByID = React.useMemo(() => {
    if (!activeDoc) {
      return new Map<string, PageTreeDropValidation>()
    }

    return new Map(
      insertDropTargets.map((dropTarget) => [
        dropTarget.dropID,
        getDropTargetValidation({
          activeDoc,
          docsByID: allDocsByID,
          dropTarget,
        }),
      ]),
    )
  }, [activeDoc, allDocsByID, insertDropTargets])

  if (activeColumns.length === 0) {
    return <div>No columns selected</div>
  }

  return (
    <div
      className={[
        'table-wrap pages-hierarchy-table',
        activeDoc ? 'pages-hierarchy-table--dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="table table--appearance-default">
        <table cellPadding="0" cellSpacing="0">
          <thead>
            <tr>
              {activeColumns.map((column, index) => (
                <th
                  data-page-tree-title-cell={
                    column.accessor === titleCellAccessor ? 'true' : undefined
                  }
                  id={`heading-${column.accessor.replace(/\./g, '__')}`}
                  key={index}
                >
                  {column.Heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <SortableContext items={sortableItems} strategy={sortingStrategy}>
              {data.map((doc, rowIndex) => {
                const rootInsertBeforeDropTarget =
                  doc.__pageTreeParentID === null
                    ? insertDropTargetsByReferenceRowID.get(doc.__pageTreeID)
                    : undefined
                const rootInsertTargetIndex =
                  rootInsertBeforeDropTarget !== undefined
                    ? insertDropTargets.indexOf(rootInsertBeforeDropTarget)
                    : -1
                const rootInsertAfterDropTarget =
                  rootInsertTargetIndex >= 0
                    ? insertDropTargets[rootInsertTargetIndex + 1]
                    : undefined
                const isTrailingRootInsert =
                  rootInsertAfterDropTarget === insertDropTargets[insertDropTargets.length - 1]
                const nextVisibleDoc = data[rowIndex + 1]
                const hasVisibleDescendantAfter =
                  nextVisibleDoc?.__pageTreeAncestorIDs.includes(doc.__pageTreeID) ?? false

                return (
                  <React.Fragment key={doc.__pageTreeID}>
                    {rootInsertBeforeDropTarget ? (
                      <HierarchyInsertRow
                        activeColumnsCount={activeColumns.length}
                        activeDragRowID={activeDoc ? activeDragRowID : null}
                        activeDropTargetID={activeDropTargetID}
                        dropTarget={rootInsertBeforeDropTarget}
                        dropValidation={insertDropValidationByID.get(
                          rootInsertBeforeDropTarget.dropID,
                        )}
                        isMovePending={isMovePending}
                        key={rootInsertBeforeDropTarget.dropID}
                      />
                    ) : null}
                    <HierarchyTableRow
                      activeColumns={activeColumns}
                      activeDragRowID={activeDragRowID}
                      activeDragType={activeDragType}
                      canReorderRows={canReorderRows}
                      doc={doc}
                      dropValidation={rowDropValidationByID.get(doc.__pageTreeID)}
                      insertAfterDropID={
                        hasVisibleDescendantAfter || isTrailingRootInsert
                          ? null
                          : (rootInsertAfterDropTarget?.dropID ?? null)
                      }
                      insertBeforeDropID={rootInsertBeforeDropTarget?.dropID ?? null}
                      isMovePending={isMovePending}
                      rowIndex={rowIndex}
                      titleCellAccessor={titleCellAccessor}
                    />
                  </React.Fragment>
                )
              })}
            </SortableContext>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function PageTreeListViewClient({
  allDocs,
  badgeConfig,
  badgesLinks,
  canMoveDocs,
  columnState,
  homeIndicatorEnabled,
  orderableFieldName,
  parentFieldSlug,
  query,
  sourceDocs,
  useAsTitle,
  ...props
}: PageTreeListViewClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { config } = useConfig()
  const locale = useLocale()
  const { i18n } = useTranslation()
  const [activeDragRowID, setActiveDragRowID] = React.useState<null | string>(null)
  const [activeDragType, setActiveDragType] = React.useState<null | PageTreeDragType>(null)
  const [activeDropTarget, setActiveDropTarget] = React.useState<null | PageTreeDropTarget>(null)
  const [collapsedIDs, setCollapsedIDs] = React.useState<Set<string>>(() => new Set())
  const [optimisticOrderRowIDs, setOptimisticOrderRowIDs] = React.useState<null | string[]>(null)
  const [parentMoveEnabled, setParentMoveEnabled] = React.useState(false)
  const [pendingMoveRowID, setPendingMoveRowID] = React.useState<null | string>(null)
  const { getPreference, setPreference } = usePreferences()
  const parentMovePreferenceKey = React.useMemo(
    () => getParentMovePreferenceKey(props.collectionSlug),
    [props.collectionSlug],
  )

  const toggleRow = React.useCallback((rowID: string) => {
    setCollapsedIDs((currentState) => {
      const nextState = new Set(currentState)

      if (nextState.has(rowID)) {
        nextState.delete(rowID)
      } else {
        nextState.add(rowID)
      }

      return nextState
    })
  }, [])
  const handleParentMoveToggle = React.useCallback(() => {
    setParentMoveEnabled((currentValue) => {
      const nextValue = !currentValue

      void setPreference(parentMovePreferenceKey, nextValue)

      return nextValue
    })
  }, [parentMovePreferenceKey, setPreference])
  const currentSort = React.useMemo(() => {
    const searchParamSort = searchParams.getAll('sort')

    if (searchParamSort.length > 0) {
      return normalizeSort(searchParamSort)
    }

    return normalizeSort(query.sort as string | string[] | undefined)
  }, [query.sort, searchParams])
  const canReorderRows =
    canMoveDocs && isOrderableSortActive({ orderableFieldName, sort: currentSort })
  const currentLimit = React.useMemo(
    () =>
      normalizePositiveInt(
        searchParams.get('limit'),
        typeof query.limit === 'number' && query.limit > 0 ? query.limit : 10,
      ),
    [query.limit, searchParams],
  )
  const currentRequestedPage = React.useMemo(
    () =>
      normalizePositiveInt(
        searchParams.get('page'),
        typeof query.page === 'number' && query.page > 0 ? query.page : 1,
      ),
    [query.page, searchParams],
  )
  const liveAllDocs = React.useMemo(
    () =>
      buildPageTreeDocs(sourceDocs, {
        parentFieldSlug,
        sort: currentSort,
      }),
    [currentSort, parentFieldSlug, sourceDocs],
  )
  const collapseResetKey = React.useMemo(
    () => JSON.stringify([props.collectionSlug, props.viewType, searchParams.toString()]),
    [props.collectionSlug, props.viewType, searchParams],
  )
  const hierarchyValue = React.useMemo(
    () => ({
      activeDragRowID,
      canMoveDocs,
      collapsedIDs,
      parentMoveEnabled,
      pendingMoveRowID,
      toggleRow,
    }),
    [activeDragRowID, canMoveDocs, collapsedIDs, parentMoveEnabled, pendingMoveRowID, toggleRow],
  )

  React.useEffect(() => {
    let isMounted = true

    void getPreference<boolean>(parentMovePreferenceKey).then((storedValue) => {
      if (isMounted) {
        setParentMoveEnabled(storedValue === true)
      }
    })

    return () => {
      isMounted = false
    }
  }, [getPreference, parentMovePreferenceKey])

  React.useEffect(() => {
    setActiveDragRowID(null)
    setActiveDragType(null)
    setActiveDropTarget(null)
    setCollapsedIDs(new Set())
    setOptimisticOrderRowIDs(null)
  }, [collapseResetKey])

  const visibleDocs = React.useMemo(
    () => getVisibleTreeDocs(liveAllDocs, collapsedIDs),
    [liveAllDocs, collapsedIDs],
  )
  const paginatedData = React.useMemo(
    () => buildPaginatedData(visibleDocs, currentLimit, currentRequestedPage),
    [currentLimit, currentRequestedPage, visibleDocs],
  )
  const paginatedDocs = paginatedData.docs as PageTreeDoc[]
  const paginatedServerOrderKey = React.useMemo(
    () => paginatedDocs.map((doc) => doc.__pageTreeID).join('\0'),
    [paginatedDocs],
  )
  const displayedPaginatedDocs = React.useMemo(
    () => orderDocsByRowIDs(paginatedDocs, optimisticOrderRowIDs),
    [optimisticOrderRowIDs, paginatedDocs],
  )
  const displayedPaginatedData = React.useMemo(
    () => ({
      ...paginatedData,
      docs: displayedPaginatedDocs,
    }),
    [displayedPaginatedDocs, paginatedData],
  )

  React.useEffect(() => {
    setOptimisticOrderRowIDs(null)
  }, [paginatedServerOrderKey])

  const allDocsByID = React.useMemo(
    () => new Map(liveAllDocs.map((doc) => [doc.__pageTreeID, doc])),
    [liveAllDocs],
  )
  const paginatedDocsByID = React.useMemo(
    () => new Map(displayedPaginatedDocs.map((doc) => [doc.__pageTreeID, doc])),
    [displayedPaginatedDocs],
  )
  const renderedCellIndexByDocID = React.useMemo(
    () => new Map(allDocs.map((doc, index) => [doc.__pageTreeID, index])),
    [allDocs],
  )
  const normalizedColumnState = React.useMemo(
    () => ensureUseAsTitleColumn(columnState, useAsTitle),
    [columnState, useAsTitle],
  )
  const paginatedColumnState = React.useMemo(
    () => sliceColumnState(normalizedColumnState, displayedPaginatedDocs, renderedCellIndexByDocID),
    [displayedPaginatedDocs, normalizedColumnState, renderedCellIndexByDocID],
  )
  const tableColumns = React.useMemo(
    () =>
      buildTableColumns({
        badgeConfig,
        badgesLinks,
        columnState: paginatedColumnState,
        docs: displayedPaginatedDocs,
        enableRowSelections: props.enableRowSelections,
        homeIndicatorEnabled,
        orderableFieldName,
        parentFieldSlug,
        t: i18n.t,
        useAsTitle,
      }),
    [
      paginatedColumnState,
      displayedPaginatedDocs,
      badgeConfig,
      badgesLinks,
      homeIndicatorEnabled,
      orderableFieldName,
      parentFieldSlug,
      props.enableRowSelections,
      i18n.t,
      useAsTitle,
    ],
  )
  const activeDragDoc = activeDragRowID ? (paginatedDocsByID.get(activeDragRowID) ?? null) : null
  const activeDragPreviewPath = React.useMemo(() => {
    if (!activeDragDoc || activeDragType !== 'move') {
      return null
    }

    if (!activeDropTarget) {
      return buildDocSlugPath({
        doc: activeDragDoc,
        docsByID: allDocsByID,
      })
    }

    const targetDoc = getDropTargetParentDoc({
      docsByID: allDocsByID,
      dropTarget: activeDropTarget,
    })
    const dropValidation = getDropTargetValidation({
      activeDoc: activeDragDoc,
      docsByID: allDocsByID,
      dropTarget: activeDropTarget,
    })

    if (!dropValidation.isValid) {
      return buildDocSlugPath({
        doc: activeDragDoc,
        docsByID: allDocsByID,
      })
    }

    return buildProspectiveDocSlugPath({
      activeDoc: activeDragDoc,
      docsByID: allDocsByID,
      targetDoc: targetDoc ?? undefined,
    })
  }, [activeDragDoc, activeDragType, activeDropTarget, allDocsByID])
  const isMovePending = pendingMoveRowID !== null
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 2,
      },
    }),
  )
  const handleDragCancel = React.useCallback(() => {
    setActiveDragRowID(null)
    setActiveDragType(null)
    setActiveDropTarget(null)
  }, [])
  const handleDragStart = React.useCallback(
    (event: DragStartEvent) => {
      if (!canMoveDocs || isMovePending) {
        return
      }

      const dragData = getPageTreeDragData(event.active.data.current)
      const { dragType, rowID } = dragData

      if (
        typeof rowID === 'string' &&
        dragType &&
        paginatedDocsByID.has(rowID) &&
        (dragType !== 'order' || canReorderRows)
      ) {
        setActiveDragRowID(rowID)
        setActiveDragType(dragType)
        setActiveDropTarget(null)
      }
    },
    [canMoveDocs, canReorderRows, isMovePending, paginatedDocsByID],
  )
  const handleDragOver = React.useCallback((event: DragOverEvent) => {
    const dragData = getPageTreeDragData(event.active.data.current)
    const overData = event.over?.data.current as PageTreeDropTarget | undefined

    if (dragData.dragType === 'order') {
      setActiveDropTarget(null)
      return
    }

    if (dragData.dragType !== 'move' || !overData) {
      setActiveDropTarget(null)
      return
    }

    if (overData.dropType === 'insert') {
      setActiveDropTarget(overData)
      return
    }

    if (overData.dropType === 'row') {
      setActiveDropTarget(overData)
      return
    }

    setActiveDropTarget(null)
  }, [])
  const handleDragEnd = React.useCallback(
    async (event: DragEndEvent) => {
      const dragData = getPageTreeDragData(event.active.data.current)
      const { dragType, rowID } = dragData
      const activeDoc = typeof rowID === 'string' ? (paginatedDocsByID.get(rowID) ?? null) : null
      const overData = event.over?.data.current as PageTreeDropTarget | undefined
      const overDragData = getPageTreeDragData(event.over?.data.current)

      setActiveDragRowID(null)
      setActiveDragType(null)
      setActiveDropTarget(null)

      if (dragType === 'order') {
        if (typeof rowID === 'string' && typeof overDragData.rowID === 'string') {
          const nextOrderRowIDs = buildOptimisticOrderRowIDs({
            activeRowID: rowID,
            docs: displayedPaginatedDocs,
            targetRowID: overDragData.rowID,
          })
          const reorderRequestBody = buildReorderRequestBody({
            activeRowID: rowID,
            docs: displayedPaginatedDocs,
            orderableFieldName,
            sort: currentSort,
            targetRowID: overDragData.rowID,
          })

          if (!nextOrderRowIDs || !reorderRequestBody) {
            return
          }

          const apiRoute = config.routes.api
          const params = new URLSearchParams()

          if (locale?.code) {
            params.set('locale', locale.code)
          }

          setOptimisticOrderRowIDs(nextOrderRowIDs)
          setPendingMoveRowID(rowID)

          try {
            const response = await fetch(
              `${apiRoute}/${props.collectionSlug}/${encodeURIComponent(rowID)}/reorder${
                params.size > 0 ? `?${params.toString()}` : ''
              }`,
              {
                body: JSON.stringify(reorderRequestBody),
                credentials: 'include',
                headers: {
                  'Accept-Language': i18n.language,
                  'Content-Type': 'application/json',
                },
                method: 'POST',
              },
            )
            const result = (await response.json().catch(() => null)) as {
              message?: string
            } | null

            if (!response.ok) {
              setOptimisticOrderRowIDs(null)
              toast.error(result?.message ?? 'Could not reorder document.')
              return
            }

            if (result?.message === 'initial migration') {
              setOptimisticOrderRowIDs(null)
            }

            React.startTransition(() => {
              router.refresh()
            })
          } catch (error) {
            const message =
              error instanceof Error && error.message
                ? error.message
                : 'Could not reorder document.'

            setOptimisticOrderRowIDs(null)
            toast.error(message)
          } finally {
            setPendingMoveRowID(null)
          }
        }

        return
      }

      if (dragType !== 'move' || typeof rowID !== 'string' || !activeDoc || !overData) {
        return
      }

      const dropValidation = getDropTargetValidation({
        activeDoc,
        docsByID: allDocsByID,
        dropTarget: overData,
      })

      if (!dropValidation.isValid) {
        if (!shouldSilenceMoveMessage(dropValidation.message)) {
          toast.error(dropValidation.message ?? 'Could not move document.')
        }

        return
      }

      if (
        overData.dropType === 'insert' &&
        activeDoc.__pageTreeParentID === dropValidation.parentID
      ) {
        return
      }

      const apiRoute = config.routes.api
      const params = new URLSearchParams()

      if (locale?.code) {
        params.set('locale', locale.code)
      }

      setPendingMoveRowID(rowID)

      try {
        const response = await fetch(
          `${apiRoute}/${props.collectionSlug}/${encodeURIComponent(rowID)}/move${
            params.size > 0 ? `?${params.toString()}` : ''
          }`,
          {
            body: JSON.stringify({
              parentID: dropValidation.parentID,
            }),
            credentials: 'include',
            headers: {
              'Accept-Language': i18n.language,
              'Content-Type': 'application/json',
            },
            method: 'POST',
          },
        )
        const result = (await response.json().catch(() => null)) as {
          message?: string
        } | null

        if (!response.ok) {
          if (shouldSilenceMoveMessage(result?.message)) {
            return
          }

          toast.error(result?.message ?? 'Could not move document.')
          return
        }

        toast.success(`Moved "${getDocDisplayLabel(activeDoc)}".`)
        React.startTransition(() => {
          router.refresh()
        })
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : 'Could not move document.'

        toast.error(message)
      } finally {
        setPendingMoveRowID(null)
      }
    },
    [
      allDocsByID,
      config.routes.api,
      currentSort,
      displayedPaginatedDocs,
      i18n.language,
      locale?.code,
      orderableFieldName,
      paginatedDocsByID,
      props.collectionSlug,
      router,
    ],
  )
  const handleDragEndSync = React.useCallback(
    (event: DragEndEvent) => {
      void handleDragEnd(event)
    },
    [handleDragEnd],
  )

  const tableNode = React.useMemo(
    () => (
      <DndContext
        collisionDetection={pageTreeCollisionDetectionStrategy}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEndSync}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        sensors={sensors}
      >
        <HierarchyTable
          activeDragRowID={activeDragRowID}
          activeDragType={activeDragType}
          activeDropTarget={activeDropTarget}
          allDocsByID={allDocsByID}
          canReorderRows={canReorderRows}
          columns={tableColumns}
          data={displayedPaginatedDocs}
          isMovePending={isMovePending}
          titleCellAccessor={useAsTitle}
        />
        <DragOverlay dropAnimation={null} style={{ cursor: 'grabbing' }}>
          {activeDragPreviewPath ? (
            <div className="pages-hierarchy-drag-overlay">{activeDragPreviewPath}</div>
          ) : null}
        </DragOverlay>
      </DndContext>
    ),
    [
      activeDragPreviewPath,
      activeDragRowID,
      activeDragType,
      activeDropTarget,
      allDocsByID,
      canReorderRows,
      displayedPaginatedDocs,
      handleDragCancel,
      handleDragEndSync,
      handleDragOver,
      handleDragStart,
      isMovePending,
      sensors,
      tableColumns,
      useAsTitle,
    ],
  )
  const beforeActions = React.useMemo(() => {
    const actions = props.beforeActions ? [...props.beforeActions] : []

    if (canMoveDocs) {
      actions.unshift(
        <ParentMoveToggle
          collectionSlug={props.collectionSlug}
          enabled={parentMoveEnabled}
          key="parent-move-toggle"
          onToggle={handleParentMoveToggle}
        />,
      )
    }

    return actions.length > 0 ? actions : undefined
  }, [
    canMoveDocs,
    handleParentMoveToggle,
    parentMoveEnabled,
    props.beforeActions,
    props.collectionSlug,
  ])

  return (
    <div className={styles.root}>
      <PageTreeProvider value={hierarchyValue}>
        <ListQueryProvider
          collectionSlug={props.collectionSlug}
          data={displayedPaginatedData}
          modifySearchParams
          orderableFieldName={orderableFieldName}
          query={{
            ...query,
            limit: currentLimit,
            page: displayedPaginatedData.page,
            sort: currentSort,
          }}
        >
          <DefaultListView
            {...props}
            beforeActions={beforeActions}
            columnState={paginatedColumnState}
            Table={tableNode}
          />
        </ListQueryProvider>
      </PageTreeProvider>
    </div>
  )
}
