import type { CollectionConfig } from 'payload'

import type { NestedDocsPageTreePluginCollectionCustom } from '../types.js'
import { nestedDocsPageTreePluginCustomKey } from '../types.js'
import { normalizeNestedDocsPageTreePluginBadgeConfig } from './badgeConfig.js'

export function getCollectionPageTreeConfig(
  collection: Pick<CollectionConfig, 'custom'>,
): null | NestedDocsPageTreePluginCollectionCustom {
  const value = collection.custom?.[nestedDocsPageTreePluginCustomKey]

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const config = value as Partial<NestedDocsPageTreePluginCollectionCustom>

  if (
    typeof config.breadcrumbsFieldSlug !== 'string' ||
    typeof config.defaultLimit !== 'number' ||
    typeof config.hideBreadcrumbs !== 'boolean' ||
    !config.homeIndicator ||
    typeof config.homeIndicator !== 'object' ||
    Array.isArray(config.homeIndicator) ||
    typeof config.homeIndicator.enabled !== 'boolean' ||
    typeof config.parentFieldSlug !== 'string'
  ) {
    return null
  }

  return {
    badges: normalizeNestedDocsPageTreePluginBadgeConfig(config.badges),
    breadcrumbsFieldSlug: config.breadcrumbsFieldSlug,
    defaultLimit: config.defaultLimit,
    hideBreadcrumbs: config.hideBreadcrumbs,
    homeIndicator: {
      enabled: config.homeIndicator.enabled,
    },
    parentFieldSlug: config.parentFieldSlug,
  }
}
