import type { CollectionConfig, Config } from 'payload'

import { createMovePageEndpoint } from './endpoints/createMovePageEndpoint.js'
import type {
  NestedDocsPageTreePluginCollectionCustom,
  NestedDocsPageTreePluginConfig,
} from './types.js'
import { nestedDocsPageTreePluginCustomKey } from './types.js'
import { normalizeNestedDocsPageTreePluginBadgeConfig } from './utilities/badgeConfig.js'

const DEFAULT_BREADCRUMBS_FIELD_SLUG = 'breadcrumbs'
const DEFAULT_HOME_INDICATOR_COLLECTIONS = ['pages']
const DEFAULT_LIMIT = 100
const DEFAULT_PARENT_FIELD_SLUG = 'parent'
const PAGE_TREE_LIST_VIEW_PATH =
  'payload-nested-docs-page-tree/rsc#NestedDocsPageTreeListView'
type CollectionEndpoint = NonNullable<Exclude<CollectionConfig['endpoints'], false>>[number]

function getTopLevelField(
  collection: Pick<CollectionConfig, 'fields'>,
  fieldName: string,
) {
  return collection.fields.find((field) => 'name' in field && field.name === fieldName)
}

function getCollectionEndpoints(collection: CollectionConfig): CollectionEndpoint[] {
  return Array.isArray(collection.endpoints) ? [...collection.endpoints] : []
}

function patchBreadcrumbField<TField extends CollectionConfig['fields'][number]>(args: {
  breadcrumbsFieldSlug: string
  field: TField
  hideBreadcrumbs: boolean
}): TField {
  const { breadcrumbsFieldSlug, field, hideBreadcrumbs } = args

  if (!('name' in field) || field.name !== breadcrumbsFieldSlug) {
    return field
  }

  return {
    ...field,
    admin: {
      ...(field.admin ?? {}),
      hidden: hideBreadcrumbs,
    },
  } as TField
}

function validateTargetCollection(args: {
  breadcrumbsFieldSlug: string
  collection: CollectionConfig
  parentFieldSlug: string
}) {
  const { breadcrumbsFieldSlug, collection, parentFieldSlug } = args

  if (typeof collection.admin?.useAsTitle !== 'string' || collection.admin.useAsTitle.includes('.')) {
    throw new Error(
      `payload-nested-docs-page-tree requires "${collection.slug}" to define a top-level admin.useAsTitle field.`,
    )
  }

  if (!getTopLevelField(collection, collection.admin.useAsTitle)) {
    throw new Error(
      `payload-nested-docs-page-tree could not find the useAsTitle field "${collection.admin.useAsTitle}" on "${collection.slug}".`,
    )
  }

  if (!getTopLevelField(collection, parentFieldSlug)) {
    throw new Error(
      `payload-nested-docs-page-tree requires "${collection.slug}" to already define the nested docs parent field "${parentFieldSlug}". Register @payloadcms/plugin-nested-docs before payload-nested-docs-page-tree.`,
    )
  }

  if (!getTopLevelField(collection, breadcrumbsFieldSlug)) {
    throw new Error(
      `payload-nested-docs-page-tree requires "${collection.slug}" to already define the nested docs breadcrumbs field "${breadcrumbsFieldSlug}". Register @payloadcms/plugin-nested-docs before payload-nested-docs-page-tree.`,
    )
  }

  const existingListView = collection.admin?.components?.views?.list?.Component

  if (existingListView && existingListView !== PAGE_TREE_LIST_VIEW_PATH) {
    throw new Error(
      `payload-nested-docs-page-tree cannot own the "${collection.slug}" list view because the collection already defines a custom admin.components.views.list.Component.`,
    )
  }

  const existingMoveEndpoint = getCollectionEndpoints(collection).find(
    (endpoint) => endpoint.path === '/:id/move',
  )

  if (existingMoveEndpoint) {
    throw new Error(
      `payload-nested-docs-page-tree cannot add the move endpoint to "${collection.slug}" because the collection already defines POST /:id/move.`,
    )
  }
}

function buildCollectionCustom(args: {
  badges: NestedDocsPageTreePluginCollectionCustom['badges']
  breadcrumbsFieldSlug: string
  defaultLimit: number
  hideBreadcrumbs: boolean
  homeIndicator: NestedDocsPageTreePluginCollectionCustom['homeIndicator']
  parentFieldSlug: string
}): NestedDocsPageTreePluginCollectionCustom {
  const {
    badges,
    breadcrumbsFieldSlug,
    defaultLimit,
    hideBreadcrumbs,
    homeIndicator,
    parentFieldSlug,
  } = args

  return {
    badges,
    breadcrumbsFieldSlug,
    defaultLimit,
    hideBreadcrumbs,
    homeIndicator,
    parentFieldSlug,
  }
}

function getHomeIndicatorCollectionSlugs(
  homeIndicator: NestedDocsPageTreePluginConfig['homeIndicator'],
): Set<string> {
  if (homeIndicator === false) {
    return new Set()
  }

  return new Set(homeIndicator?.collections ?? DEFAULT_HOME_INDICATOR_COLLECTIONS)
}

export type {
  NestedDocsPageTreePluginBadgeConfig,
  NestedDocsPageTreePluginBadgeMap,
  NestedDocsPageTreePluginBadgeStatus,
  NestedDocsPageTreePluginConfig,
  NestedDocsPageTreePluginHomeIndicatorConfig,
} from './types.js'

export const nestedDocsPageTreePlugin =
  (pluginOptions: NestedDocsPageTreePluginConfig) =>
  (config: Config): Config => {
    if (!pluginOptions.collections?.length) {
      throw new Error('payload-nested-docs-page-tree requires at least one collection slug.')
    }

    if (pluginOptions.disabled) {
      return config
    }

    const breadcrumbsFieldSlug =
      pluginOptions.breadcrumbsFieldSlug ?? DEFAULT_BREADCRUMBS_FIELD_SLUG
    const defaultLimit = pluginOptions.defaultLimit ?? DEFAULT_LIMIT
    const hideBreadcrumbs = pluginOptions.hideBreadcrumbs ?? true
    const parentFieldSlug = pluginOptions.parentFieldSlug ?? DEFAULT_PARENT_FIELD_SLUG
    const badges = normalizeNestedDocsPageTreePluginBadgeConfig(pluginOptions.badges)
    const homeIndicatorCollectionSlugs = getHomeIndicatorCollectionSlugs(
      pluginOptions.homeIndicator,
    )
    const targetedCollectionSlugs = new Set<string>(pluginOptions.collections)

    if (!config.collections?.length) {
      throw new Error('payload-nested-docs-page-tree could not find any collections to patch.')
    }

    const foundCollectionSlugs = new Set<string>()
    const nextCollections = config.collections.map((collection) => {
      if (!targetedCollectionSlugs.has(collection.slug)) {
        return collection
      }

      foundCollectionSlugs.add(collection.slug)
      validateTargetCollection({
        breadcrumbsFieldSlug,
        collection,
        parentFieldSlug,
      })

      return {
        ...collection,
        admin: {
          ...(collection.admin ?? {}),
          components: {
            ...(collection.admin?.components ?? {}),
            views: {
              ...(collection.admin?.components?.views ?? {}),
              list: {
                ...(collection.admin?.components?.views?.list ?? {}),
                Component: PAGE_TREE_LIST_VIEW_PATH,
              },
            },
          },
          pagination: {
            ...(collection.admin?.pagination ?? {}),
            defaultLimit:
              collection.admin?.pagination?.defaultLimit === undefined
                ? defaultLimit
                : collection.admin.pagination.defaultLimit,
          },
        },
        custom: {
          ...(collection.custom ?? {}),
          [nestedDocsPageTreePluginCustomKey]: buildCollectionCustom({
            badges,
            breadcrumbsFieldSlug,
            defaultLimit,
            hideBreadcrumbs,
            homeIndicator: {
              enabled: homeIndicatorCollectionSlugs.has(collection.slug),
            },
            parentFieldSlug,
          }),
        },
        endpoints: [
          ...getCollectionEndpoints(collection),
          createMovePageEndpoint({
            collectionSlug: collection.slug,
            parentFieldSlug,
          }),
        ],
        fields: collection.fields.map((field) =>
          patchBreadcrumbField({
            breadcrumbsFieldSlug,
            field,
            hideBreadcrumbs,
          }),
        ),
      }
    })

    const missingCollections = pluginOptions.collections.filter(
      (collectionSlug) => !foundCollectionSlugs.has(collectionSlug),
    )

    if (missingCollections.length > 0) {
      throw new Error(
        `payload-nested-docs-page-tree could not find the following collections: ${missingCollections.join(', ')}`,
      )
    }

    return {
      ...config,
      collections: nextCollections as CollectionConfig[],
    }
  }
