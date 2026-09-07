import type { PayloadRequest } from 'payload'

import { stringifyDocID } from './pageTree.js'

export type NestedDocsPageTreePluginDiagnosticEvent = {
  collection: string
  data: Record<string, unknown>
  /** Stable identifier for grouping events from the same logical operation. */
  flow: string
  level: 'error' | 'info' | 'warn'
  message: string
  source:
    | 'move-endpoint:body-rejected'
    | 'move-endpoint:enter'
    | 'move-endpoint:error'
    | 'move-endpoint:ok'
    | 'move-endpoint:snapshot-after'
    | 'move-endpoint:snapshot-before'
    | 'page-tree-change:after'
    | 'page-tree-change:status-flip'
    | 'reorder-endpoint:body-rejected'
    | 'reorder-endpoint:enter'
    | 'reorder-endpoint:error'
    | 'reorder-endpoint:initial-migration'
    | 'reorder-endpoint:ok'
  /** ISO timestamp; included so log dumps are self-describing. */
  t: string
}

export type NestedDocsPageTreePluginDiagnosticsConfig =
  | {
      enabled: boolean
      /**
       * Custom event sink. Defaults to a single-line `console.log` per event.
       * Useful for routing diagnostics through `req.payload.logger` or similar.
       */
      logger?: (event: NestedDocsPageTreePluginDiagnosticEvent) => void
    }
  | boolean

export type Diagnostics = {
  enabled: boolean
  log: (event: Omit<NestedDocsPageTreePluginDiagnosticEvent, 't'>) => void
}

const NOOP_DIAGNOSTICS: Diagnostics = {
  enabled: false,
  log: () => {},
}

const DEFAULT_TAG = '[payload-nested-docs-page-tree]'
const DEFAULT_TAG_COLOR = '\x1b[38;2;59;130;246m'
const DEFAULT_TAG_STYLE = '\x1b[1m'
const RESET_STYLE = '\x1b[0m'

/** Context key used to thread a diagnostics flow id from the move endpoint into afterChange logs. */
export const DIAGNOSTICS_FLOW_CONTEXT_KEY = '__pageTreeDiagnosticsFlow'

function defaultLogger(event: NestedDocsPageTreePluginDiagnosticEvent): void {
  // One line per event keeps terminal copy-paste usable while preserving all fields.
  // eslint-disable-next-line no-console
  console.log(
    `${DEFAULT_TAG_STYLE}${DEFAULT_TAG_COLOR}${DEFAULT_TAG} ${event.source}${RESET_STYLE} ${event.message}`,
    JSON.stringify(event),
  )
}

export function resolveDiagnostics(
  config: NestedDocsPageTreePluginDiagnosticsConfig | undefined,
): Diagnostics {
  if (!config) {
    return NOOP_DIAGNOSTICS
  }

  const enabled = typeof config === 'boolean' ? config : Boolean(config.enabled)

  if (!enabled) {
    return NOOP_DIAGNOSTICS
  }

  const logger = typeof config === 'object' && config.logger ? config.logger : defaultLogger

  return {
    enabled: true,
    log(event) {
      try {
        logger({ ...event, t: new Date().toISOString() })
      } catch {
        // Diagnostics must never break a request.
      }
    },
  }
}

/** Generate a short flow id so multi-event sequences group together in logs. */
export function createFlowID(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
}

/**
 * Read a doc directly from the published main-row layer (`draft: false`).
 * Returns null when the doc is unpublished or unreadable so callers can log
 * the absence instead of failing the request.
 */
export async function readMainRowSnapshot(args: {
  collectionSlug: string
  fields: ReadonlyArray<string>
  id: number | string
  req: PayloadRequest
}): Promise<null | Record<string, unknown>> {
  const { id, collectionSlug, fields, req } = args

  try {
    const doc = (await req.payload.findByID({
      id,
      collection: collectionSlug,
      depth: 0,
      disableErrors: true,
      draft: false,
      overrideAccess: true,
      req,
    })) as unknown as null | Record<string, unknown>

    if (!doc) {
      return null
    }

    const snapshot: Record<string, unknown> = {
      id: stringifyDocID(typeof doc.id === 'number' || typeof doc.id === 'string' ? doc.id : undefined),
    }

    for (const field of fields) {
      snapshot[field] = projectField(doc[field])
    }

    return snapshot
  } catch {
    return null
  }
}

/** Collapse populated relationship docs to their id so logs stay compact. */
export function projectField(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as { id?: unknown }

    if ('id' in candidate) {
      const id = candidate.id

      return typeof id === 'number' || typeof id === 'string' ? stringifyDocID(id) : value
    }
  }

  return value
}
