import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { detectReceiptEdges, prepareReceiptImage, readReceipt } from './receiptScanner.js'
import { possibleDuplicateReceipts } from './receiptDuplicates.js'
import { clearDriveDelete, listReceiptFolders, listReceipts, putReceipt, putReceiptFolder, removeReceipt, removeReceiptFolder } from './receiptStore.js'
import './ReceiptPage.css'

const php = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value)
const today = () => {
  const date = new Date()
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}
const fullCrop = { left: 0, right: 100, top: 0, bottom: 100 }
const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
const blankReceipt = () => ({ merchant: '', date: today(), amount: '', note: '', reason: '' })

function ReceiptPage({ scope, wallets, entries, onExpenseSaved, onExpensesRemoved, onFolderWalletChanged, onDriveSync, onConnectDrive, driveConnected, driveFolderUrl, driveAvailable, driveBusy, driveStatus, driveUploadError, driveLastSyncedAt, onOpenSettings, refreshKey, addReceiptRequest = 0, hidden }) {
  const displayMoney = (value) => hidden ? '₱ ••••••' : php(value)
  const [folders, setFolders] = useState([])
  const [foldersLoaded, setFoldersLoaded] = useState(false)
  const [receipts, setReceipts] = useState([])
  const [folderId, setFolderId] = useState('')
  const [folderForm, setFolderForm] = useState({ name: '', walletId: '', budget: '', budgetNote: '', reason: '' })
  const [editingFolder, setEditingFolder] = useState(false)
  const [showFolderForm, setShowFolderForm] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [viewingReceipt, setViewingReceipt] = useState(null)
  const [manualMode, setManualMode] = useState(false)
  const [editingReceipt, setEditingReceipt] = useState(null)
  const [receiptForm, setReceiptForm] = useState(blankReceipt)
  const [sourceBlob, setSourceBlob] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const previewRef = useRef('')
  const [savedBlob, setSavedBlob] = useState(null)
  const [imageHash, setImageHash] = useState('')
  const [approvedDuplicateKey, setApprovedDuplicateKey] = useState('')
  const [crop, setCrop] = useState(fullCrop)
  const [rotation, setRotation] = useState(0)
  const [enhance, setEnhance] = useState(false)
  const [scanned, setScanned] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cameraOn, setCameraOn] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const handledAddRequest = useRef(0)

  useEffect(() => {
    let active = true
    Promise.all([listReceiptFolders(scope), listReceipts(scope)]).then(([nextFolders, nextReceipts]) => {
      if (!active) return
      setFolders(nextFolders)
      setReceipts(nextReceipts)
      setFolderId((current) => nextFolders.some((folder) => folder.id === current) ? current : nextFolders[0]?.id || '')
      setFoldersLoaded(true)
    }).catch((cause) => { if (active) setError(`Receipt storage could not be read: ${cause.message}`) })
    return () => { active = false }
  }, [scope, refreshKey])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
  }, [])

  useEffect(() => {
    if (cameraOn && videoRef.current) videoRef.current.srcObject = streamRef.current
  }, [cameraOn])

  useEffect(() => {
    if (!foldersLoaded || !addReceiptRequest || handledAddRequest.current === addReceiptRequest) return
    handledAddRequest.current = addReceiptRequest
    if (folderId) openScanner()
    else setNotice('Create a receipt folder before adding a receipt.')
  }, [addReceiptRequest, folderId, foldersLoaded])

  useEffect(() => {
    if (!scanOpen) return undefined
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = document.querySelector('.receipt-modal')
    const heading = dialog?.querySelector('h2')
    heading?.setAttribute('tabindex', '-1')
    heading?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { stopCamera(); setScanOpen(false); return }
      if (event.key !== 'Tab' || !dialog) return
      const controls = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')]
      if (!controls.length) return
      const first = controls[0]
      const last = controls.at(-1)
      if (document.activeElement === heading) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [scanOpen])

  const folder = folders.find((item) => item.id === folderId)
  const folderReceipts = receipts.filter((item) => item.folderId === folderId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])
  const folderTotal = folderReceipts.reduce((sum, receipt) => {
    const entry = entryById.get(receipt.entryId)
    return sum + (entry && !entry.deletedAt ? entry.amount : 0)
  }, 0)
  const remaining = folder?.budget ? folder.budget - folderTotal : null
  const duplicateKey = `${receiptForm.merchant.trim().toLowerCase()}|${receiptForm.date}|${receiptForm.amount}|${imageHash}`
  const duplicates = possibleDuplicateReceipts(receipts, {
    merchant: receiptForm.merchant, date: receiptForm.date, amount: Number(receiptForm.amount), imageHash,
  }, editingReceipt?.id)

  async function reload() {
    const [nextFolders, nextReceipts] = await Promise.all([listReceiptFolders(scope), listReceipts(scope)])
    setFolders(nextFolders)
    setReceipts(nextReceipts)
    setFolderId((current) => nextFolders.some((item) => item.id === current) ? current : nextFolders[0]?.id || '')
  }

  function setImage(blob) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = blob ? URL.createObjectURL(blob) : ''
    setPreviewUrl(previewRef.current)
    setSourceBlob(blob)
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOn(false)
  }

  async function startCamera() {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) return setError('This browser cannot open the camera here. Use the image upload control instead.')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      streamRef.current = stream
      setCameraOn(true)
    } catch (cause) { setError(`Camera could not start: ${cause.message}. You can upload an image instead.`) }
  }

  async function captureCamera() {
    const video = videoRef.current
    if (!video?.videoWidth) return setError('Wait for the camera preview, then capture again.')
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .92))
    stopCamera()
    if (!blob) return setError('Camera image could not be prepared. Try capturing again.')
    await chooseImage(blob)
  }

  async function chooseImage(blob) {
    if (!blob || !blob.type.startsWith('image/')) return setError('Choose an image file for the receipt.')
    setManualMode(false)
    setError('')
    setBusy('Preparing receipt image…')
    setImage(blob)
    setSavedBlob(null)
    setImageHash('')
    setScanned(null)
    setRotation(0)
    let nextCrop = fullCrop
    try { nextCrop = await detectReceiptEdges(blob) || fullCrop }
    catch { setNotice('Edges were unclear. The full image is ready; adjust it if needed.') }
    setCrop(nextCrop)
    await prepareImage(blob, nextCrop, 0, enhance, false)
  }

  function openScanner(receipt = null, manual = false) {
    stopCamera()
    setScanOpen(true)
    setManualMode(manual || Boolean(receipt && !receipt.blob))
    setEditingReceipt(receipt)
    setReceiptForm(receipt ? { merchant: receipt.merchant || '', date: receipt.date, amount: String(receipt.amount), note: receipt.note || '', reason: '' } : blankReceipt())
    setImage(receipt?.blob || null)
    setSavedBlob(receipt?.blob || null)
    setImageHash(receipt?.imageHash || '')
    setApprovedDuplicateKey('')
    setScanned(receipt?.scanned || null)
    setCrop(fullCrop)
    setRotation(0)
    setError('')
    setNotice('')
  }

  async function prepareImage(blob, imageCrop, imageRotation, imageEnhance, withOcr) {
    if (!blob || imageCrop.left >= imageCrop.right || imageCrop.top >= imageCrop.bottom) return setError('Adjust the crop so it has a visible width and height.')
    setBusy(withOcr ? 'Reading receipt on this device…' : 'Preparing image…')
    setError('')
    try {
      const image = await prepareReceiptImage(blob, imageCrop, imageRotation, imageEnhance)
      setSavedBlob(image)
      const hash = await crypto.subtle.digest('SHA-256', await image.arrayBuffer())
      setImageHash(Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(''))
      if (withOcr) {
        const detected = await readReceipt(image, (status) => setBusy(`Reading receipt: ${status}…`))
        setScanned({ merchant: detected.merchant, date: detected.date, amount: detected.amount,
          lineItems: detected.lineItems, lineItemTotal: detected.lineItemTotal })
        setReceiptForm((current) => ({
          ...current,
          merchant: detected.merchant || current.merchant,
          date: detected.date || current.date,
          amount: detected.amount ? String(detected.amount) : current.amount,
        }))
        setNotice('Compare the detected details with the image, then save the confirmed amount.')
      } else setNotice('Image ready. Enter the receipt details, or use Read details to fill them in.')
    } catch (cause) { setError(`Receipt reading failed: ${cause.message}. You can crop the image and enter details manually.`) }
    finally { setBusy('') }
  }

  async function prepareAndRead(withOcr) {
    await prepareImage(sourceBlob, crop, rotation, enhance, withOcr)
  }

  async function submitFolder(event) {
    event.preventDefault()
    const name = folderForm.name.trim()
    const budget = folderForm.budget === '' ? null : Number(folderForm.budget)
    const budgetNote = folderForm.budgetNote.trim().slice(0, 300)
    if (!name || name.length > 60 || !wallets.some((wallet) => wallet.id === folderForm.walletId && (!wallet.archived || (editingFolder && folder.walletId === wallet.id)))) return setError('Enter a folder name and choose an active wallet.')
    if (budget !== null && (!Number.isFinite(budget) || budget <= 0 || Math.abs(Math.round(budget * 100) - budget * 100) > 1e-6)) return setError('The optional budget must be a positive PHP amount.')
    if (editingFolder && !folderForm.reason.trim()) return setError('Add a reason for the folder change.')
    if (folders.some((item) => item.id !== (editingFolder ? folderId : '') && item.name.toLowerCase() === name.toLowerCase())) return setError('A folder with this name already exists.')
    const next = editingFolder ? { ...folder, name, walletId: folderForm.walletId, budget, budgetNote, updatedAt: new Date().toISOString() }
      : { id: makeId(), name, walletId: folderForm.walletId, budget, budgetNote, createdAt: new Date().toISOString(), updatedAt: null }
    setBusy('Saving folder…')
    try {
      await putReceiptFolder(scope, next)
      if (editingFolder && folder.walletId !== next.walletId) {
        try { await onFolderWalletChanged(folderReceipts.map((receipt) => receipt.entryId), next.walletId, folderForm.reason.trim()) }
        catch (cause) { await putReceiptFolder(scope, folder); throw cause }
      }
      await reload()
      onDriveSync()
      setFolderId(next.id)
      setFolderForm({ name: '', walletId: '', budget: '', budgetNote: '', reason: '' })
      setEditingFolder(false)
      setShowFolderForm(false)
      setNotice(editingFolder ? 'Folder updated.' : 'Folder created. Add a receipt to record an expense.')
      setError('')
    } catch (cause) { setError(`Folder could not be saved: ${cause.message}`) }
    finally { setBusy('') }
  }

  function beginFolderEdit() {
    setEditingFolder(true)
    setShowFolderForm(true)
    setFolderForm({ name: folder.name, walletId: folder.walletId, budget: folder.budget === null ? '' : String(folder.budget), budgetNote: folder.budgetNote || '', reason: '' })
    setError('')
  }

  async function deleteFolder() {
    if (!window.confirm(`Delete “${folder.name}” and its ${folderReceipts.length} local records and images? Their wallet expenses will be reversed.`)) return
    setBusy('Deleting folder…')
    try {
      await removeReceiptFolder(scope, folder.id, folderReceipts.map((receipt) => receipt.id))
      try { await onExpensesRemoved(folderReceipts.map((receipt) => receipt.entryId)) }
      catch (cause) {
        await putReceiptFolder(scope, folder)
        for (const receipt of folderReceipts) await putReceipt(scope, receipt)
        await clearDriveDelete(scope, 'folder', folder.id)
        throw cause
      }
      await reload()
      onDriveSync()
      setEditingFolder(false)
      setNotice('Folder deleted and its wallet expenses reversed.')
    } catch (cause) { setError(`Folder could not be deleted: ${cause.message}`) }
    finally { setBusy('') }
  }

  async function saveReceipt(event) {
    event.preventDefault()
    const merchant = receiptForm.merchant.trim()
    const amount = Number(receiptForm.amount)
    if (!folder || (!manualMode && !savedBlob) || (sourceBlob && !savedBlob) || !receiptForm.date || !Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) return setError('Confirm the date and positive PHP amount. Prepare any selected image first.')
    if (editingReceipt && !receiptForm.reason.trim()) return setError('Add a reason for the receipt edit.')
    if (duplicates.length && approvedDuplicateKey !== duplicateKey) return setError('This looks like a duplicate. Review the matching record and confirm if it is a separate expense.')
    const receipt = {
      id: editingReceipt?.id || makeId(),
      entryId: editingReceipt?.entryId || makeId(),
      folderId: folder.id,
      merchant,
      date: receiptForm.date,
      amount,
      note: receiptForm.note.trim().slice(0, 300),
      scanned,
      imageHash,
      blob: savedBlob || null,
      createdAt: editingReceipt?.createdAt || new Date().toISOString(),
      updatedAt: editingReceipt ? new Date().toISOString() : null,
      reason: receiptForm.reason.trim(),
    }
    setBusy('Saving receipt and wallet expense…')
    try {
      await putReceipt(scope, receipt)
      try { await onExpenseSaved(receipt, folder, editingReceipt) }
      catch (cause) {
        if (editingReceipt) await putReceipt(scope, editingReceipt)
        else await removeReceipt(scope, receipt.id, false)
        throw cause
      }
      await reload()
      setScanOpen(false)
      setImage(null)
      const localMessage = `Expense saved locally. ${displayMoney(amount)} deducted from ${wallets.find((wallet) => wallet.id === folder.walletId)?.name}.`
      setNotice(driveConnected ? `${localMessage} Uploading receipt to Google Drive…` : localMessage)
      if (driveConnected) onDriveSync(receipt, (cause) => setNotice(cause
        ? `Expense saved locally. Google Drive did not confirm this receipt: ${cause}`
        : 'Receipt saved to Google Drive. Its wallet expense is recorded.'))
      setError('')
    } catch (cause) { setError(`Receipt could not be saved: ${cause.message}`) }
    finally { setBusy('') }
  }

  async function deleteReceipt(receipt) {
    if (!window.confirm(`Delete ${receipt.merchant || 'this receipt'}? Its wallet expense will be reversed.`)) return
    setBusy('Deleting receipt…')
    try {
      await removeReceipt(scope, receipt.id)
      try { await onExpensesRemoved([receipt.entryId]) }
      catch (cause) {
        await putReceipt(scope, receipt)
        await clearDriveDelete(scope, 'receipt', receipt.id)
        throw cause
      }
      await reload()
      onDriveSync()
      setNotice('Receipt deleted and its wallet expense reversed.')
    } catch (cause) { setError(`Receipt could not be deleted: ${cause.message}`) }
    finally { setBusy('') }
  }

  function downloadReceipt(receipt) {
    if (!receipt.blob) return
    const url = URL.createObjectURL(receipt.blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${receipt.merchant?.replace(/[^a-z0-9-]/gi, '_') || 'receipt'}-${receipt.date}.jpg`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const activeWallets = wallets.filter((wallet) => !wallet.archived)
  return <div className="receipt-page">
    <div className="page-head"><div><div className="eyebrow">LOCAL RECEIPT RECORDS</div><h1>Receipt folders</h1><p>Scan, review, and record receipts against a wallet.</p></div></div>
    <section className="receipt-drive-panel" aria-label="Google Drive receipt sync"><div><strong>{driveConnected ? driveBusy ? 'Updating Google Drive…' : 'Google Drive connected' : driveAvailable ? 'Google Drive disconnected' : 'Google Drive unavailable'}</strong><p role={driveUploadError ? 'alert' : 'status'}>{driveStatus || (driveAvailable ? 'Connect Drive with the same Google account you use to sign in to Budsync. Budsync will select that account automatically.' : 'Images save on this device. Drive setup is available in Settings.')}</p>{driveLastSyncedAt && <small>Last checked {driveLastSyncedAt.toLocaleString('en-PH')}</small>}</div><div className="receipt-drive-actions">{driveConnected && driveFolderUrl && <a className="drive-folder-link" href={driveFolderUrl} target="_blank" rel="noopener noreferrer">Open Budsync folder <span aria-hidden="true">↗</span></a>}{driveAvailable && <button className="secondary" type="button" disabled={driveBusy} onClick={driveConnected ? () => onDriveSync() : onConnectDrive}>{driveConnected ? 'Sync now' : 'Connect Drive'}</button>}{!driveConnected && <button className="secondary" type="button" onClick={onOpenSettings}>Settings</button>}</div></section>
    <p className="receipt-local-note">Each confirmed receipt deducts its expense once. Attaching an image later does not deduct it again.</p>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {notice && <p className="notice-banner" role="status">{notice}</p>}
    <div className="receipt-layout">
      <aside className="receipt-folders data-card">
        <div className="receipt-panel-head"><h2>Folders <small>{folders.length}</small></h2><button className="secondary" type="button" onClick={() => { setEditingFolder(false); setShowFolderForm(true); setFolderForm({ name: '', walletId: '', budget: '', budgetNote: '', reason: '' }) }}>+ New folder</button></div>
        {folders.length ? <div className="receipt-folder-list">{folders.map((item) => <button key={item.id} className={folderId === item.id ? 'selected' : ''} type="button" onClick={() => { setFolderId(item.id); setEditingFolder(false); setShowFolderForm(false); setFolderForm({ name: '', walletId: '', budget: '', budgetNote: '', reason: '' }); setError('') }}><strong>{item.name}</strong><small>{wallets.find((wallet) => wallet.id === item.walletId)?.name || 'Wallet'} · {receipts.filter((receipt) => receipt.folderId === item.id).length} records</small></button>)}</div> : <p className="receipt-empty-copy">Create a folder to group expenses and receipts.</p>}
        {showFolderForm && <form className="receipt-folder-form" onSubmit={submitFolder}>
          <h3>{editingFolder ? 'Edit folder' : 'New folder'}</h3>
          <label>Folder name<input required maxLength="60" value={folderForm.name} placeholder="e.g. Procurement 1" onChange={(event) => setFolderForm({ ...folderForm, name: event.target.value })} /></label>
          <label>Expense wallet<select required value={folderForm.walletId} onChange={(event) => setFolderForm({ ...folderForm, walletId: event.target.value })}><option value="">Choose a wallet</option>{activeWallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}{editingFolder && wallets.find((wallet) => wallet.id === folder.walletId)?.archived && <option value={folder.walletId}>{wallets.find((wallet) => wallet.id === folder.walletId)?.name} (archived)</option>}</select></label>
          <label>Allocated budget (optional; no deduction)<input type="number" min="0.01" step="0.01" value={folderForm.budget} placeholder="₱ 0.00" onChange={(event) => setFolderForm({ ...folderForm, budget: event.target.value })} /></label>
          <label>Budget note (optional)<textarea rows="2" maxLength="300" value={folderForm.budgetNote} placeholder="Add context for this budget" onChange={(event) => setFolderForm({ ...folderForm, budgetNote: event.target.value })} /></label>
          {editingFolder && <label>Reason for change<textarea required rows="2" maxLength="300" value={folderForm.reason} onChange={(event) => setFolderForm({ ...folderForm, reason: event.target.value })} /></label>}
          <div className="receipt-form-actions"><button className="primary" disabled={Boolean(busy)} type="submit">{editingFolder ? 'Save folder' : 'Create folder'}</button><button className="secondary" type="button" onClick={() => { setEditingFolder(false); setShowFolderForm(false); setFolderForm({ name: '', walletId: '', budget: '', budgetNote: '', reason: '' }) }}>Cancel</button></div>
        </form>}
      </aside>
      <section className="receipt-records data-card">
        {folder ? <>
          <div className="receipt-panel-head"><div><span className="widget-kicker">FOLDER RECORD</span><h2>{folder.name}</h2><p>Expenses are deducted from {wallets.find((wallet) => wallet.id === folder.walletId)?.name || 'the assigned wallet'}.</p></div><div className="receipt-toolbar"><button className="secondary" type="button" onClick={beginFolderEdit}>Edit folder</button><button className="secondary" type="button" onClick={deleteFolder}>Delete</button></div></div>
          <div className="receipt-summary"><div><small>Recorded spending</small><strong>{displayMoney(folderTotal)}</strong></div><div className="receipt-budget-summary"><small>Allocated budget</small><strong>{folder.budget ? displayMoney(folder.budget) : 'No limit'}</strong>{folder.budgetNote && <p>{folder.budgetNote}</p>}<button className="secondary receipt-budget-edit" type="button" onClick={beginFolderEdit}>Edit budget</button></div><div><small>{remaining === null ? 'Records' : remaining < 0 ? 'Over budget' : 'Remaining'}</small><strong>{remaining === null ? folderReceipts.length : displayMoney(Math.abs(remaining))}</strong></div></div>
          <div className="receipt-add-row"><h3>Expense records</h3><div className="receipt-toolbar"><button className="secondary" type="button" onClick={() => openScanner(null, true)}>+ Add amount</button><button className="primary" type="button" onClick={() => openScanner()}>+ Scan or upload</button></div></div>
          {folderReceipts.length ? <div className="receipt-items">{folderReceipts.map((receipt) => {
            const entry = entryById.get(receipt.entryId)
            const active = entry && !entry.deletedAt
            const imageSynced = receipt.blob && receipt.driveSyncedRevision === (receipt.updatedAt || receipt.createdAt)
            const imageStatus = receipt.blob ? imageSynced ? 'Image in Google Drive' : driveConnected ? driveUploadError ? 'Upload needs retry' : driveBusy ? 'Uploading image…' : 'Waiting for Drive upload' : 'Image saved on this device' : 'No image yet'
            return <article className="receipt-item" key={receipt.id}>{receipt.blob ? <button className="receipt-thumbnail-button" type="button" aria-label={`View receipt image${receipt.merchant ? ` from ${receipt.merchant}` : ''}`} onClick={() => setViewingReceipt(receipt)}><ReceiptThumbnail key={`${receipt.id}:${receipt.updatedAt}`} receipt={receipt} /></button> : <ReceiptThumbnail key={`${receipt.id}:${receipt.updatedAt}`} receipt={receipt} />}<div className="receipt-item-main"><strong>{receipt.merchant || 'Receipt'}</strong><span>{receipt.date} · {active ? 'Wallet expense recorded' : 'Expense removed from history'}</span><small className={'receipt-image-status' + (receipt.blob && !imageSynced ? ' pending' : '')}>{imageStatus}</small>{receipt.scanned?.amount && receipt.scanned.amount !== (active ? entry.amount : receipt.amount) && <small>Scan read {displayMoney(receipt.scanned.amount)} · Confirmed {displayMoney(active ? entry.amount : receipt.amount)}</small>}{receipt.note && <small>{receipt.note}</small>}</div><strong className="receipt-item-amount">{active ? displayMoney(entry.amount) : '—'}</strong><div className="receipt-item-actions"><button type="button" onClick={() => openScanner(receipt)}>Edit / attach</button>{receipt.blob && <button type="button" onClick={() => downloadReceipt(receipt)}>Download</button>}{receipt.blob && !imageSynced && driveConnected && driveUploadError && <button type="button" disabled={driveBusy} onClick={() => onDriveSync()}>Retry upload</button>}<button type="button" onClick={() => deleteReceipt(receipt)}>Delete</button></div></article>
          })}</div> : <p className="receipt-empty-copy">No records yet. Add an amount now or capture a receipt to create an expense.</p>}
        </> : <div className="empty"><strong>Choose or create a folder</strong><p>Each folder connects its receipt expenses to one wallet.</p></div>}
      </section>
    </div>
    {scanOpen && createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { stopCamera(); setScanOpen(false) } }}><div className="modal receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title"><div className="modal-head"><div><div className="eyebrow">DOCUMENT SCANNER</div><h2 id="receipt-modal-title">{editingReceipt ? 'Edit expense record' : manualMode ? 'Add expense amount' : 'Scan receipt'}</h2><p>{manualMode ? 'Save an amount now. You can attach its receipt later without another deduction.' : 'Capture, crop, compare, then confirm the expense.'}</p></div><button type="button" aria-label="Close" onClick={() => { stopCamera(); setScanOpen(false) }}>×</button></div>
      <div className="receipt-scan-body"><div className="receipt-capture-actions"><label className="primary">Take photo<input type="file" accept="image/*" capture="environment" onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value = '' }} /></label><label className="secondary">Choose image<input type="file" accept="image/*" onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value = '' }} /></label></div>
        {cameraOn && <div className="receipt-camera"><video ref={videoRef} autoPlay playsInline muted /><div className="receipt-camera-actions"><button className="primary" type="button" onClick={captureCamera}>Capture receipt</button><button className="secondary" type="button" onClick={stopCamera}>Stop camera</button></div></div>}
        {previewUrl && <><div className="receipt-preview"><img src={previewUrl} alt="Receipt ready to review" /><div className="receipt-crop-box" style={{ left: `${crop.left}%`, top: `${crop.top}%`, width: `${crop.right - crop.left}%`, height: `${crop.bottom - crop.top}%` }} /></div><details className="receipt-adjustments"><summary>Adjust image</summary><div className="receipt-crop-controls">{['left', 'right', 'top', 'bottom'].map((side) => <label key={side}>{side}<input type="range" min="0" max="100" value={crop[side]} onChange={(event) => { setCrop({ ...crop, [side]: Number(event.target.value) }); setSavedBlob(null) }} /></label>)}</div><div className="receipt-image-options"><button className="secondary" type="button" onClick={() => { setRotation((value) => (value + 90) % 360); setSavedBlob(null) }}>Rotate 90°</button><label><input type="checkbox" checked={enhance} onChange={(event) => { setEnhance(event.target.checked); setSavedBlob(null) }} /> Enhance black and white</label><button className="secondary" type="button" onClick={() => { setCrop(fullCrop); setSavedBlob(null) }}>Reset crop</button><button className="secondary" type="button" onClick={startCamera} disabled={Boolean(busy) || cameraOn}>Use live camera</button>{editingReceipt?.blob && <button className="secondary" type="button" onClick={() => { setImage(null); setSavedBlob(null); setImageHash(''); setScanned(null); setManualMode(true) }}>Remove image</button>}</div>{!savedBlob && <p>Image changes need to be applied before saving.</p>}<button className="secondary" type="button" disabled={Boolean(busy)} onClick={() => prepareAndRead(false)}>Apply image changes</button></details><div className="receipt-form-actions"><button className="secondary" type="button" disabled={Boolean(busy)} onClick={() => prepareAndRead(true)}>Read details from image</button></div></>}
        {busy && <p className="receipt-status" role="status">{busy}</p>}
        {scanned && <div className="receipt-comparison"><strong>Detected details · compare with the receipt</strong><span>Merchant: {scanned.merchant || 'Unclear'}</span><span>Date: {scanned.date || 'Unclear'}</span><span>Amount: {scanned.amount ? displayMoney(scanned.amount) : 'Unclear'}</span></div>}
        {scanned?.lineItems?.length > 0 && <div className="receipt-line-items"><strong>Detected line items</strong>{scanned.lineItems.map((item, index) => <div key={`${item.description}-${index}`}><span>{item.description}</span><b>{displayMoney(item.amount)}</b></div>)}<div className="receipt-line-total"><span>Items total</span><b>{displayMoney(scanned.lineItemTotal)}</b></div>{scanned.amount && <small>{Math.abs(scanned.amount - scanned.lineItemTotal) < .01 ? 'Items match the detected receipt total.' : `Items differ from the detected total by ${displayMoney(Math.abs(scanned.amount - scanned.lineItemTotal))}. Check discounts, tax, and OCR.`}</small>}</div>}
        {duplicates.length > 0 && <div className="receipt-duplicate" role="alert"><strong>Possible duplicate expense</strong><p>{duplicates.map((item) => `${item.merchant} · ${item.date} · ${displayMoney(item.amount)}`).join(' / ')}</p><label><input type="checkbox" checked={approvedDuplicateKey === duplicateKey} onChange={(event) => setApprovedDuplicateKey(event.target.checked ? duplicateKey : '')} /> I checked; this is a separate expense</label></div>}
        <form className="receipt-detail-form" onSubmit={saveReceipt}><h3>Confirmed record</h3><div className="receipt-fields"><label>Merchant or description (optional)<input maxLength="80" value={receiptForm.merchant} onChange={(event) => setReceiptForm({ ...receiptForm, merchant: event.target.value })} /></label><label>Date<input required type="date" value={receiptForm.date} onChange={(event) => setReceiptForm({ ...receiptForm, date: event.target.value })} /></label><label>Amount (PHP)<input required type="number" min="0.01" step="0.01" value={receiptForm.amount} onChange={(event) => setReceiptForm({ ...receiptForm, amount: event.target.value })} /></label><label>Note (optional)<input maxLength="300" value={receiptForm.note} onChange={(event) => setReceiptForm({ ...receiptForm, note: event.target.value })} /></label></div>{editingReceipt && <label>Reason for edit<textarea required rows="2" maxLength="300" value={receiptForm.reason} onChange={(event) => setReceiptForm({ ...receiptForm, reason: event.target.value })} /></label>}<div className="receipt-form-actions"><button className="primary" type="submit" disabled={Boolean(busy) || (!manualMode && !savedBlob) || Boolean(sourceBlob && !savedBlob) || Boolean(duplicates.length && approvedDuplicateKey !== duplicateKey)}>Save {editingReceipt ? 'changes' : 'expense'}</button><button className="secondary" type="button" onClick={() => { stopCamera(); setScanOpen(false) }}>Cancel</button></div></form>
      </div></div></div>, document.body)}
    {viewingReceipt && createPortal(<ReceiptViewer receipt={viewingReceipt} onClose={() => setViewingReceipt(null)} />, document.body)}
  </div>
}

export default ReceiptPage

function ReceiptThumbnail({ receipt }) {
  const [url] = useState(() => receipt.blob ? URL.createObjectURL(receipt.blob) : '')
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return url ? <img src={url} alt="" /> : <span className="receipt-no-image" aria-label="No image attached">₱</span>
}

function ReceiptViewer({ receipt, onClose }) {
  const [url] = useState(() => URL.createObjectURL(receipt.blob))
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  const title = receipt.merchant || 'Receipt'
  return <div className="modal-backdrop receipt-viewer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal receipt-viewer" role="dialog" aria-modal="true" aria-label={`${title} image`}>
      <div className="modal-head"><div><div className="eyebrow">RECEIPT IMAGE</div><h2>{title}</h2><p>{receipt.date}</p></div><button type="button" aria-label="Close receipt viewer" onClick={onClose}>×</button></div>
      <div className="receipt-viewer-content"><img src={url} alt={`${title} · ${receipt.date}`} /></div>
    </section>
  </div>
}
