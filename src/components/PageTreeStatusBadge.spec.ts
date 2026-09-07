import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { PageTreeStatusBadge } from './PageTreeStatusBadge.js'

vi.mock('@payloadcms/ui', () => ({
  ExternalLinkIcon: () =>
    React.createElement('svg', { 'data-page-tree-test-icon': 'external-link' }),
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('PageTreeStatusBadge', () => {
  const doc = {
    _displayStatus: 'changed',
    __pageTreeStatusLinks: {
      publicURL: 'https://example.com/live',
      previewURL: 'https://example.com/preview',
    },
  }
  const badgeConfig = { colors: {}, labels: { changed: 'Custom label' } }

  it.each(['live', 'preview', 'both'] as const)(
    'renders the %s destinations regardless of the badge label',
    (mode) => {
      const html = renderToStaticMarkup(
        React.createElement(PageTreeStatusBadge, {
          badgeConfig,
          doc,
          badgesLinks: { draftHasPublishedVersion: mode },
        }),
      )
      expect(html.match(/<a /g)?.length).toBe(mode === 'both' ? 2 : 1)
      expect(html.includes('href="https://example.com/live"')).toBe(mode !== 'preview')
      expect(html.includes('href="https://example.com/preview"')).toBe(mode !== 'live')
      expect(html.includes('data-page-tree-test-icon="external-link"')).toBe(mode === 'both')
      if (mode === 'preview') expect(html).toContain('>Custom label</a>')
    },
  )

  it('ignores even stale link metadata when links are disabled', () => {
    const html = renderToStaticMarkup(
      React.createElement(PageTreeStatusBadge, { badgeConfig, doc }),
    )
    expect(html).not.toContain('<a ')
  })

  it('defaults to both with an unlinked body when the live URL is missing', () => {
    const html = renderToStaticMarkup(
      React.createElement(PageTreeStatusBadge, {
        badgeConfig,
        badgesLinks: {},
        doc: { ...doc, __pageTreeStatusLinks: { previewURL: 'https://example.com/preview' } },
      }),
    )
    expect(html.match(/<a /g)?.length).toBe(1)
    expect(html).toContain('<span class="pages-hierarchy-status-badge__body">Custom label</span>')
    expect(html).toContain('href="https://example.com/preview"')
  })

  it('does not substitute live when preview-only mode has no preview URL', () => {
    const html = renderToStaticMarkup(
      React.createElement(PageTreeStatusBadge, {
        badgeConfig,
        badgesLinks: { draftHasPublishedVersion: 'preview' },
        doc: { ...doc, __pageTreeStatusLinks: { publicURL: 'https://example.com/live' } },
      }),
    )
    expect(html).not.toContain('<a ')
  })
})
