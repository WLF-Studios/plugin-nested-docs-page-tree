'use client'

import { ExternalLinkIcon, useTranslation } from '@payloadcms/ui'
import React from 'react'

import type {
  NestedDocsPageTreePluginBadgesLinks,
  NestedDocsPageTreePluginResolvedBadgeConfig,
  PageTreeSourceDoc,
} from '../types.js'

import {
  getPageTreeBadgeColor,
  getPageTreeBadgeLabel,
  getPageTreeDisplayStatus,
} from '../utilities/status.js'

export function PageTreeStatusBadge({
  badgeConfig,
  badgesLinks,
  doc,
}: {
  badgeConfig: NestedDocsPageTreePluginResolvedBadgeConfig
  badgesLinks?: NestedDocsPageTreePluginBadgesLinks
  doc: PageTreeSourceDoc
}) {
  const { t } = useTranslation()
  const status = getPageTreeDisplayStatus(doc)
  const color = getPageTreeBadgeColor({ badgeColors: badgeConfig.colors, status })
  const label = getPageTreeBadgeLabel({ badgeLabels: badgeConfig.labels, status, t })
  const previewLabel = t('version:preview')
  const openInNewTabLabel = t('fields:openInNewTab')
  const publicURL = badgesLinks ? doc.__pageTreeStatusLinks?.publicURL : undefined
  const previewURL = badgesLinks ? doc.__pageTreeStatusLinks?.previewURL : undefined
  const mode = badgesLinks?.draftHasPublishedVersion ?? 'both'
  const split = status === 'changed' && mode === 'both' && Boolean(previewURL)
  const opensPreview = status === 'draft' || (status === 'changed' && mode === 'preview')
  const href = opensPreview
    ? previewURL
    : status === 'published' || status === 'changed'
      ? publicURL
      : undefined

  const badgeProps = {
    className: `pages-hierarchy-status-badge pages-hierarchy-status-badge--${status}${split ? ' pages-hierarchy-status-badge--split' : ''}`,
    'data-custom-color': color ? 'true' : undefined,
    style: color ? ({ '--page-tree-badge-base': color } as React.CSSProperties) : undefined,
  }
  const linkProps = {
    href,
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    rel: 'noopener noreferrer',
    target: '_blank',
    title: `${opensPreview ? previewLabel : 'Live'} (${openInNewTabLabel})`,
  }

  if (!split) {
    return href ? (
      <a {...badgeProps} {...linkProps}>
        {label}
      </a>
    ) : (
      <span {...badgeProps}>{label}</span>
    )
  }

  return (
    <span {...badgeProps}>
      {href ? (
        <a {...linkProps} className="pages-hierarchy-status-badge__body">
          {label}
        </a>
      ) : (
        <span className="pages-hierarchy-status-badge__body">{label}</span>
      )}
      <a
        {...linkProps}
        aria-label={previewLabel}
        className="pages-hierarchy-status-badge__preview"
        href={previewURL}
        title={`${previewLabel} (${openInNewTabLabel})`}
      >
        <span aria-hidden="true">
          <ExternalLinkIcon />
        </span>
      </a>
    </span>
  )
}
