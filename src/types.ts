import type { CollectionSlug } from 'payload'

export const nestedDocsPageTreePluginBadgeStatuses = ['published', 'changed', 'draft'] as const

export type NestedDocsPageTreePluginBadgeStatus =
  (typeof nestedDocsPageTreePluginBadgeStatuses)[number]

export type NestedDocsPageTreePluginBadgeMap = Partial<
  Record<NestedDocsPageTreePluginBadgeStatus, string>
>

export type NestedDocsPageTreePluginBadgeConfig = {
  colors?: NestedDocsPageTreePluginBadgeMap
  labels?: NestedDocsPageTreePluginBadgeMap
}

export type NestedDocsPageTreePluginResolvedBadgeConfig = {
  colors: NestedDocsPageTreePluginBadgeMap
  labels: NestedDocsPageTreePluginBadgeMap
}

export type NestedDocsPageTreePluginHomeIndicatorConfig =
  | false
  | {
      collections?: CollectionSlug[]
    }

export type NestedDocsPageTreePluginResolvedHomeIndicatorConfig = {
  enabled: boolean
}

export type NestedDocsPageTreePluginConfig = {
  badges?: NestedDocsPageTreePluginBadgeConfig
  breadcrumbsFieldSlug?: string
  collections: CollectionSlug[]
  defaultLimit?: number
  disabled?: boolean
  hideBreadcrumbs?: boolean
  homeIndicator?: NestedDocsPageTreePluginHomeIndicatorConfig
  parentFieldSlug?: string
}

export type NestedDocsPageTreePluginCollectionCustom = {
  badges: NestedDocsPageTreePluginResolvedBadgeConfig
  breadcrumbsFieldSlug: string
  defaultLimit: number
  hideBreadcrumbs: boolean
  homeIndicator: NestedDocsPageTreePluginResolvedHomeIndicatorConfig
  parentFieldSlug: string
}

export type PageTreeSourceDoc = Record<string, unknown> & {
  _displayStatus?: null | string
  _status?: null | string
  id?: number | string
  slug?: null | string
}

export const nestedDocsPageTreePluginCustomKey = 'nestedDocsPageTreePlugin'
