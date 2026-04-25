'use client'

import React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ChevronIcon, DragHandleIcon } from '@payloadcms/ui'

import { usePageTree } from './PageTreeContext.js'
import type { PageTreeDoc } from '../utilities/pageTree.js'

export function PageTreeTitleCell({
  children,
  doc,
}: {
  children: React.ReactNode
  doc: PageTreeDoc
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
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    data: {
      dragType: 'move',
      rowID,
    },
    disabled: dragIsDisabled,
    id: `page-drag:${rowID}`,
  })
  const isActiveDragRow = activeDragRowID === rowID

  return (
    <div
      className="pages-hierarchy-cell"
      data-row-dragging={isDragging || isActiveDragRow ? 'true' : 'false'}
      data-tree-depth={depth}
      data-tree-has-children={hasChildren ? 'true' : 'false'}
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
