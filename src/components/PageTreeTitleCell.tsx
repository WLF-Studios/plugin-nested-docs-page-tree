'use client'

import { useDraggable } from '@dnd-kit/core'
import { ChevronIcon, DragHandleIcon } from '@payloadcms/ui'
import React from 'react'

import type { PageTreeDoc } from '../utilities/pageTree.js'

import { usePageTree } from './PageTreeContext.js'

const HOME_PAGE_SLUG = 'home'

function isHomePageDoc(doc: PageTreeDoc): boolean {
  return doc.__pageTreeParentID === null && doc.slug?.trim() === HOME_PAGE_SLUG
}

export function PageTreeTitleCell({
  children,
  doc,
  homeIndicatorEnabled,
}: {
  children: React.ReactNode
  doc: PageTreeDoc
  homeIndicatorEnabled: boolean
}) {
  const {
    activeDragRowID,
    canMoveDocs,
    collapsedIDs,
    disableMoveDrag,
    pendingMoveRowID,
    toggleRow,
  } = usePageTree()
  const depth = doc.__pageTreeDepth
  const hasChildren = doc.__pageTreeHasChildren
  const shadeLevel = Math.min(doc.__pageTreeShadeLevel, 6)
  const rowID = doc.__pageTreeID
  const isCollapsed = hasChildren && collapsedIDs.has(rowID)
  const dragIsDisabled = disableMoveDrag || !canMoveDocs || !rowID || pendingMoveRowID !== null
  const showHomeIcon = homeIndicatorEnabled && isHomePageDoc(doc)
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: `page-drag:${rowID}`,
    data: {
      dragType: 'move',
      rowID,
    },
    disabled: dragIsDisabled,
  })
  const isActiveDragRow = activeDragRowID === rowID

  return (
    <div
      className="pages-hierarchy-cell"
      data-row-dragging={isDragging || isActiveDragRow ? 'true' : 'false'}
      data-tree-depth={depth}
      data-tree-has-children={hasChildren ? 'true' : 'false'}
      data-tree-home={showHomeIcon ? 'true' : undefined}
      data-tree-shade-level={shadeLevel}
      style={{ '--pages-tree-depth': String(depth) } as React.CSSProperties}
    >
      {hasChildren ? (
        <button
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? 'Expand nested items' : 'Collapse nested items'}
          className="pages-hierarchy-cell__toggle"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            toggleRow(rowID)
          }}
          type="button"
        >
          <ChevronIcon
            className={[
              'pages-hierarchy-cell__chevron',
              isCollapsed ? 'pages-hierarchy-cell__chevron--collapsed' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        </button>
      ) : (
        <span className="pages-hierarchy-cell__spacer" />
      )}
      {canMoveDocs ? (
        <button
          {...attributes}
          {...listeners}
          aria-label="Move document"
          className={[
            'pages-hierarchy-cell__drag-handle',
            isDragging || isActiveDragRow ? 'pages-hierarchy-cell__drag-handle--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={dragIsDisabled}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          ref={setNodeRef}
          type="button"
        >
          <DragHandleIcon />
        </button>
      ) : (
        <span className="pages-hierarchy-cell__drag-spacer" />
      )}
      <span className="pages-hierarchy-cell__content">{children}</span>
    </div>
  )
}
