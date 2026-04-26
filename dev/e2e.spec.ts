import { expect, type Page, test } from '@playwright/test'

import { devUser } from './helpers/credentials.js'

test.describe.configure({ mode: 'serial' })

async function loginAsSeedUser(page: Page) {
  const response = await page.request.post('/api/users/login', {
    data: devUser,
  })

  expect(response.ok()).toBe(true)
}

function getPageTreeRows(page: Page) {
  return page.locator(".pages-hierarchy-table tbody tr[data-page-tree-row='true']")
}

function getPageTreeRow(page: Page, title: string) {
  return getPageTreeRows(page).filter({
    has: page.getByRole('link', {
      name: title,
      exact: true,
    }),
  })
}

async function getRootPageTitles(page: Page) {
  return getPageTreeRows(page).evaluateAll((rows) =>
    rows
      .map((row) => {
        const title = row.querySelector('a')?.textContent?.trim() ?? ''
        const depth = row
          .querySelector('.pages-hierarchy-cell')
          ?.getAttribute('data-tree-depth')

        return {
          depth,
          title,
        }
      })
      .filter((row) => row.depth === '0' && row.title.length > 0)
      .map((row) => row.title),
  )
}

async function getOrderablePageIDBySlug(page: Page, slug: string) {
  const response = await page.request.get(
    `/api/page-tree-orderable?depth=0&limit=1&where[slug][equals]=${encodeURIComponent(slug)}`,
  )

  expect(response.ok()).toBe(true)

  const result = (await response.json()) as {
    docs?: Array<{
      id?: number | string
    }>
  }
  const id = result.docs?.[0]?.id

  expect(id).toBeDefined()

  return id
}

async function setOrderablePageParent(page: Page, slug: string, parentSlug: null | string) {
  const id = await getOrderablePageIDBySlug(page, slug)
  const parent = parentSlug ? await getOrderablePageIDBySlug(page, parentSlug) : null
  const response = await page.request.patch(`/api/page-tree-orderable/${id}`, {
    data: {
      parent,
    },
  })

  expect(response.ok()).toBe(true)
}

async function dragTitleHandleToRow(
  page: Page,
  sourceTitle: string,
  targetTitle: string,
  position: 'center' | 'top',
) {
  const sourceHandle = getPageTreeRow(page, sourceTitle).locator(
    '.pages-hierarchy-cell__drag-handle',
  )
  const targetRow = getPageTreeRow(page, targetTitle)
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetRow.boundingBox()

  expect(sourceBox).not.toBeNull()
  expect(targetBox).not.toBeNull()

  if (!sourceBox || !targetBox) {
    return
  }

  await expect(sourceHandle).toBeEnabled()

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    position === 'top' ? targetBox.y + 2 : targetBox.y + targetBox.height / 2,
    {
      steps: 12,
    },
  )
  await page.mouse.up()
}

test('renders the seeded page tree with the expected columns and mixed statuses', async ({
  page,
}) => {
  await loginAsSeedUser(page)
  await page.goto('/admin/collections/page-tree')

  await expect(page).toHaveURL(/\/admin\/collections\/page-tree/)
  await expect(page.locator('.pages-hierarchy-table')).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.locator('.pages-hierarchy-table')).not.toHaveAttribute(
    'data-page-tree-orderable',
    'true',
  )
  await expect(page.locator('.pages-hierarchy-cell__drag-handle').first()).toBeVisible()
  await expect(page.locator('.pages-hierarchy-cell__toggle').first()).toBeVisible()
  await expect(page.locator('#heading-_dragHandle')).toHaveCount(0)
  const dataRows = page.locator(".pages-hierarchy-table tbody tr[data-page-tree-row='true']")

  await expect(dataRows).toHaveCount(14)
  await expect(getPageTreeRow(page, 'Home').locator('.pages-hierarchy-cell')).toHaveAttribute(
    'data-tree-home',
    'true',
  )
  await expect(dataRows.getByRole('link', { name: 'About', exact: true })).toHaveCount(1)
  await expect(dataRows.getByRole('link', { name: 'Leadership', exact: true })).toHaveCount(1)
  await expect(page.locator('.pages-hierarchy-status-badge--published').first()).toBeVisible()
  await expect(page.locator('.pages-hierarchy-status-badge--draft').first()).toBeVisible()
  await expect(page.locator('.pages-hierarchy-root-drop')).toHaveCount(0)

  const visibleHeaders = (await page.locator('.pages-hierarchy-table thead th').allTextContents())
    .map((header) => header.trim())
    .filter(Boolean)

  expect(visibleHeaders).toEqual(['Title', 'Published', 'Updated At', 'Parent', 'Slug', 'Status'])
})

test('renders the orderable page tree with manual order controls but without Payload drag handles', async ({
  page,
}) => {
  await loginAsSeedUser(page)
  await page.goto('/admin/collections/page-tree-orderable?sort=title')

  await expect(page).toHaveURL(/\/admin\/collections\/page-tree-orderable/)
  await expect(page.locator('.pages-hierarchy-table')).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.locator('.pages-hierarchy-table')).toHaveAttribute(
    'data-page-tree-orderable',
    'true',
  )

  const orderHeading = page.locator('#heading-_dragHandle')
  const orderButton = page.getByRole('button', {
    name: 'Sort by Order Ascending',
  })

  await expect(orderHeading).toBeVisible()
  await expect(orderButton).toBeVisible()
  await expect(orderButton).not.toHaveClass(/sort-header--active/)
  const headingIDs = await page
    .locator('.pages-hierarchy-table thead th')
    .evaluateAll((headings) => headings.map((heading) => heading.id))
  const selectHeadingIndex = headingIDs.indexOf('heading-_select')

  expect(selectHeadingIndex).toBeGreaterThanOrEqual(0)
  expect(headingIDs.indexOf('heading-_dragHandle')).toBe(selectHeadingIndex + 1)
  await expect(page.locator(".pages-hierarchy-table tbody tr .cell-_dragHandle [role='button']")).toHaveCount(
    0,
  )

  await orderButton.click()

  await expect(page).toHaveURL(/sort=_order/)
  await expect(orderButton).toHaveClass(/sort-header--active/)
  await expect(page.locator('.pages-hierarchy-cell__drag-handle').first()).toBeVisible()
  await expect(page.locator('.pages-hierarchy-cell__toggle').first()).toBeVisible()

  const dataRows = page.locator(".pages-hierarchy-table tbody tr[data-page-tree-row='true']")

  await expect(dataRows).toHaveCount(14)
  await expect(dataRows.locator(".cell-_dragHandle [role='button']")).toHaveCount(0)
  await expect(dataRows.getByRole('link', { name: 'About', exact: true })).toHaveCount(1)
  await expect(dataRows.getByRole('link', { name: 'Leadership', exact: true })).toHaveCount(1)
})

test('orderable page tree reorders root pages from the title drag handle in manual order mode', async ({
  page,
}) => {
  await loginAsSeedUser(page)
  await page.goto('/admin/collections/page-tree-orderable?sort=_order')

  await expect(page.locator('.pages-hierarchy-table')).toBeVisible({
    timeout: 20_000,
  })

  const rootTitles = await getRootPageTitles(page)

  expect(rootTitles.length).toBeGreaterThan(1)

  const sourceTitle = rootTitles[rootTitles.length - 1]
  const targetTitle = rootTitles[0]

  expect(sourceTitle).toBeDefined()
  expect(targetTitle).toBeDefined()

  const reorderResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/reorder') && response.request().method() === 'POST',
  )

  await dragTitleHandleToRow(page, sourceTitle, targetTitle, 'top')

  const reorderResponse = await reorderResponsePromise

  expect(reorderResponse.ok()).toBe(true)
  await expect(page.getByText('Document is already at the root.')).toHaveCount(0)
})

test('orderable page tree moves and reorders cross-parent title drags in manual order mode', async ({
  page,
}) => {
  await loginAsSeedUser(page)
  await setOrderablePageParent(page, 'pricing', null)
  await page.goto('/admin/collections/page-tree-orderable?sort=_order')

  await expect(page.locator('.pages-hierarchy-table')).toBeVisible({
    timeout: 20_000,
  })

  const moveResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/page-tree-orderable/') &&
      response.url().includes('/move') &&
      response.request().method() === 'POST',
  )
  const reorderResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/reorder') && response.request().method() === 'POST',
  )

  await dragTitleHandleToRow(page, 'Pricing', 'About', 'center')

  const moveResponse = await moveResponsePromise
  const reorderResponse = await reorderResponsePromise

  expect(moveResponse.ok()).toBe(true)
  expect(reorderResponse.ok()).toBe(true)
  await expect(page.getByText('Document is already at the root.')).toHaveCount(0)
})
