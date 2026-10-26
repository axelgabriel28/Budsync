import assert from 'node:assert/strict'
import test from 'node:test'
import { listChildren, trashFile, uploadFile } from './googleDrive.js'
import { restoreFromDrive, syncToDrive } from './googleDriveSync.js'

test('Drive listing follows pages and keeps app file metadata', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return Response.json(calls.length === 1
      ? { files: [{ id: 'folder-1', appProperties: { budsyncKind: 'folder' } }], nextPageToken: 'second' }
      : { files: [{ id: 'folder-2' }] })
  }
  try {
    const files = await listChildren('token', 'wallet-1')
    assert.deepEqual(files.map((file) => file.id), ['folder-1', 'folder-2'])
    assert.match(calls[0].url, /wallet-1/)
    assert.match(calls[1].url, /pageToken=second/)
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token')
  } finally { globalThis.fetch = original }
})

test('Drive creates receipt metadata and moves deleted files to Trash', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return Response.json({ id: 'file-1' })
  }
  try {
    await uploadFile('token', null, 'folder-1', 'receipt.json', '{"amount":1000}', 'application/json',
      { budsyncKind: 'receiptMeta', budsyncId: 'receipt-1' })
    await trashFile('token', 'file-1')
    assert.match(calls[0].url, /uploadType=multipart/)
    assert.match(calls[0].options.headers['Content-Type'], /multipart\/related/)
    const body = await calls[0].options.body.text()
    assert.match(body, /receipt-1/)
    assert.match(body, /"amount":1000/)
    assert.deepEqual(JSON.parse(calls[1].options.body), { trashed: true })
  } finally { globalThis.fetch = original }
})

test('a new Drive account has no receipts to restore', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({ files: [] })
  try {
    assert.deepEqual(await restoreFromDrive('token', 'guest', []),
      { folders: 0, receipts: 0, skipped: 0, restored: [], deletedEntryIds: [] })
  } finally { globalThis.fetch = original }
})

test('Drive updates a local receipt and applies a deletion from another device', async () => {
  const original = globalThis.fetch
  let deleted = false
  const folder = { id: 'folder-1', walletId: 'wallet-1', name: 'Food', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z' }
  const receipt = { id: 'receipt-1', entryId: 'entry-1', folderId: 'folder-1', merchant: 'Store', amount: 75,
    date: '2026-01-03', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z' }
  let localFolder = { ...folder, name: 'Old', updatedAt: '2026-01-01T00:00:00Z' }
  let localReceipt = { ...receipt, amount: 50, updatedAt: '2026-01-01T00:00:00Z' }
  const storage = {
    listReceiptFolders: async () => localFolder ? [localFolder] : [],
    listReceipts: async () => localReceipt ? [localReceipt] : [],
    listDriveDeletes: async () => [],
    putReceiptFolder: async (_scope, item) => { localFolder = item },
    putReceipt: async (_scope, item) => { localReceipt = item },
    removeReceipt: async () => { localReceipt = null },
    removeReceiptFolder: async () => { localFolder = null },
  }
  globalThis.fetch = async (value) => {
    const url = new URL(value)
    if (url.searchParams.get('alt') === 'media') {
      return new Response(JSON.stringify(url.pathname.endsWith('folder-meta') ? folder : receipt))
    }
    const query = url.searchParams.get('q') || ''
    if (query.includes('name =')) return Response.json({ files: [{ id: 'root' }] })
    if (query.includes("'root' in parents")) return Response.json({ files: [
      { id: 'wallet-file', appProperties: { budsyncKind: 'wallet', budsyncId: 'wallet-1' } },
      ...(deleted ? [{ id: 'delete-file', appProperties: { budsyncKind: 'deletion', budsyncId: 'receipt:receipt-1' } }] : []),
    ] })
    if (query.includes("'wallet-file' in parents")) return Response.json({ files: [
      { id: 'folder-file', appProperties: { budsyncKind: 'folder', budsyncId: 'folder-1' } },
    ] })
    if (query.includes("'folder-file' in parents")) return Response.json({ files: [
      { id: 'folder-meta', appProperties: { budsyncKind: 'folderMeta', budsyncId: 'folder-1' } },
      { id: 'receipt-meta', appProperties: { budsyncKind: 'receiptMeta', budsyncId: 'receipt-1', budsyncRevision: receipt.updatedAt } },
    ] })
    throw new Error(`Unexpected Drive URL: ${url}`)
  }
  try {
    const updated = await restoreFromDrive('token', 'guest', [{ id: 'wallet-1' }], null, storage)
    assert.equal(updated.restored.length, 1)
    assert.equal(localFolder.name, 'Food')
    assert.equal(localReceipt.amount, 75)
    localReceipt = null
    const guest = await restoreFromDrive('token', 'guest', [{ id: 'wallet-1' }], null, storage)
    assert.equal(guest.restored.length, 1)
    assert.equal(localReceipt.amount, 75)
    localReceipt = null
    const skipped = await restoreFromDrive('token', 'guest', [{ id: 'wallet-1' }], new Set(), storage, '2026-01-04T00:00:00Z')
    assert.equal(skipped.restored.length, 0)
    assert.equal(localReceipt, null)
    assert.equal(localFolder, null)
    localReceipt = receipt
    deleted = true
    const removed = await restoreFromDrive('token', 'guest', [{ id: 'wallet-1' }], new Set(['entry-1']), storage)
    assert.deepEqual(removed.deletedEntryIds, ['entry-1'])
    assert.equal(localReceipt, null)
  } finally { globalThis.fetch = original }
})

test('a receipt is confirmed only after its metadata and image reach Drive', async () => {
  const original = globalThis.fetch
  const revision = '2026-10-24T10:00:00Z'
  let failImage = false
  const storage = {
    listDriveDeletes: async () => [],
    listReceiptFolders: async () => [{ id: 'folder-1', walletId: 'wallet-1', name: 'Food', createdAt: revision }],
    listReceipts: async () => [{ id: 'receipt-1', entryId: 'entry-1', folderId: 'folder-1', merchant: 'Store',
      amount: 75, date: '2026-10-24', createdAt: revision, driveSyncedRevision: revision,
      blob: new Blob(['image'], { type: 'image/jpeg' }) }],
  }
  let receiptMetadata = ''
  globalThis.fetch = async (value, options) => {
    const url = new URL(value)
    if (url.searchParams.get('uploadType') === 'multipart') {
      const body = await options.body.text()
      if (body.includes('receipt-1.json')) receiptMetadata = body
      if (failImage && body.includes('receipt-1.jpg')) return Response.json({ error: { message: 'Image upload failed' } }, { status: 500 })
      return Response.json({ id: 'uploaded' })
    }
    const query = url.searchParams.get('q') || ''
    if (query.includes('name =')) return Response.json({ files: [{ id: 'root' }] })
    if (query.includes("'root' in parents")) return Response.json({ files: [
      { id: 'wallet-file', name: 'Personal', appProperties: { budsyncKind: 'wallet', budsyncId: 'wallet-1' } },
    ] })
    if (query.includes("'wallet-file' in parents")) return Response.json({ files: [
      { id: 'folder-file', name: 'Food', appProperties: { budsyncKind: 'folder', budsyncId: 'folder-1' } },
    ] })
    if (query.includes("'folder-file' in parents")) return Response.json({ files: [] })
    throw new Error(`Unexpected Drive URL: ${url}`)
  }
  try {
    const saved = await syncToDrive('token', 'guest', [{ id: 'wallet-1', name: 'Personal' }], storage)
    assert.equal(saved.uploaded, 3)
    assert.equal(saved.rootId, 'root')
    assert.deepEqual(saved.syncedReceipts, [{ id: 'receipt-1', revision }])
    assert.doesNotMatch(receiptMetadata, /driveSyncedRevision/)
    failImage = true
    await assert.rejects(syncToDrive('token', 'guest', [{ id: 'wallet-1', name: 'Personal' }], storage), /Image upload failed/)
  } finally { globalThis.fetch = original }
})

test('a later Drive image fills a local receipt with the same metadata revision', async () => {
  const original = globalThis.fetch
  const revision = '2026-10-24T10:00:00Z'
  const folder = { id: 'folder-1', walletId: 'wallet-1', name: 'Food', createdAt: revision }
  let receipt = { id: 'receipt-1', entryId: 'entry-1', folderId: folder.id, amount: 75,
    createdAt: revision, blob: null }
  const storage = {
    listReceiptFolders: async () => [folder],
    listReceipts: async () => [receipt],
    listDriveDeletes: async () => [],
    putReceipt: async (_scope, item) => { receipt = item },
  }
  globalThis.fetch = async (value) => {
    const url = new URL(value)
    if (url.searchParams.get('alt') === 'media') {
      return url.pathname.endsWith('folder-meta')
        ? new Response(JSON.stringify(folder))
        : new Response('image', { headers: { 'Content-Type': 'image/jpeg' } })
    }
    const query = url.searchParams.get('q') || ''
    if (query.includes('name =')) return Response.json({ files: [{ id: 'root' }] })
    if (query.includes("'root' in parents")) return Response.json({ files: [
      { id: 'wallet-file', appProperties: { budsyncKind: 'wallet', budsyncId: 'wallet-1' } },
    ] })
    if (query.includes("'wallet-file' in parents")) return Response.json({ files: [
      { id: 'folder-file', appProperties: { budsyncKind: 'folder', budsyncId: folder.id } },
    ] })
    if (query.includes("'folder-file' in parents")) return Response.json({ files: [
      { id: 'folder-meta', appProperties: { budsyncKind: 'folderMeta', budsyncId: folder.id } },
      { id: 'receipt-meta', appProperties: { budsyncKind: 'receiptMeta', budsyncId: receipt.id, budsyncRevision: revision } },
      { id: 'receipt-image', appProperties: { budsyncKind: 'receiptImage', budsyncId: receipt.id, budsyncRevision: revision } },
    ] })
    throw new Error(`Unexpected Drive URL: ${url}`)
  }
  try {
    const result = await restoreFromDrive('token', 'guest', [{ id: 'wallet-1' }], null, storage)
    assert.equal(await receipt.blob.text(), 'image')
    assert.equal(result.restored.length, 1)
    assert.equal(result.restored[0].receipt.id, receipt.id)
  } finally { globalThis.fetch = original }
})
