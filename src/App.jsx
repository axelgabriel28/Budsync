import { useEffect, useMemo, useRef, useState } from 'react'
import { backupJson, parseBackup, starterWallets, transactionsCsv } from './data.js'
import { entryImpact, monthlyReport, previewEntryBalances, walletBalances } from './finance.js'
import { freshWorkspace, readPreviousAccountWorkspace, readWorkspace, workspaceKey, writeWorkspace } from './localStore.js'
import { applySnapshot, cloudReady, fetchSnapshot, readSession, signIn, signOut, signUp } from './cloud.js'
import { changedRecords } from './syncReview.js'
import { budgetUsage, cashFlowByMonth, monthComparison } from './insights.js'
import ReceiptPage from './ReceiptPage.jsx'
import { moveReceiptExpenses, removeReceiptExpenses, upsertReceiptExpense } from './receiptFinance.js'
import { listDriveDeletes, listReceiptFolders, listReceipts, markReceiptDriveSynced, pruneReceiptCache } from './receiptStore.js'
import { reconcileReceiptData } from './receiptReconcile.js'
import { connectGoogleDrive, googleClientId, loadGoogleIdentity } from './googleDrive.js'
import { restoreFromDrive, syncToDrive } from './googleDriveSync.js'
import './App.css'
import './Fluid.css'

const navigation = [
  ['overview', 'Overview'],
  ['transactions', 'Transactions'],
  ['wallets', 'Wallets'],
  ['receipts', 'Receipts'],
  ['reports', 'Insights'],
  ['account', 'Settings'],
]
const categories = {
  income: ['Salary', 'Business', 'Gift', 'Interest', 'Other income'],
  expense: ['Food', 'Transport', 'Bills', 'Shopping', 'Health', 'Education', 'Other expense'],
}
function categoryChoices(defaults, used) {
  const seen = new Set()
  return [...defaults, ...used].filter((category) => {
    const label = category?.trim()
    if (!label || seen.has(label.toLowerCase())) return false
    seen.add(label.toLowerCase())
    return true
  })
}
const php = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value)
const shownMoney = (value, hidden) => hidden ? '₱ ••••••' : php(value)
const localDate = () => {
  const date = new Date()
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}
const dateLabel = (date) => new Date(date + 'T12:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
const entryName = (entry) => entry.type === 'transfer' ? 'Transfer' : entry.type === 'adjustment'
  ? (entry.adjustmentEffect === 'increase' ? 'Balance increase' : 'Balance decrease')
  : entry.category || (entry.type === 'income' ? 'Income' : 'Expense')
const validAmount = (value, allowZero = false) => Number.isFinite(Number(value))
  && (allowZero ? Number(value) >= 0 : Number(value) > 0)
  && Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) < 1e-6
const newId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function entryForm(type, wallets) {
  return {
    type, walletId: wallets[0]?.id || '', fromWalletId: wallets[0]?.id || '',
    toWalletId: wallets[1]?.id || '', amount: '', date: localDate(),
    category: '', note: '', adjustmentEffect: 'increase', editNote: '',
  }
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function reconcileLocalReceipts(scope, workspace, signedIn) {
  const [folders, receipts, deletes] = await Promise.all([
    listReceiptFolders(scope), listReceipts(scope), listDriveDeletes(scope),
  ])
  const data = reconcileReceiptData(workspace.data, folders, receipts, deletes)
  return data === workspace.data ? workspace : { ...workspace, data, dirty: signedIn || workspace.dirty }
}

function App() {
  const [workspace, setWorkspace] = useState(freshWorkspace)
  const [scope, setScope] = useState('guest')
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saveAllowed, setSaveAllowed] = useState(true)
  const [storageError, setStorageError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [conflict, setConflict] = useState(null)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authConfirm, setAuthConfirm] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [authError, setAuthError] = useState('')
  const [authConfirmation, setAuthConfirmation] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [pendingGuest, setPendingGuest] = useState(null)
  const [pendingPrevious, setPendingPrevious] = useState(null)
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('budsync-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [balanceHidden, setBalanceHidden] = useState(false)
  const [chartRange, setChartRange] = useState(6)
  const [introStep, setIntroStep] = useState(0)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [localSaved, setLocalSaved] = useState(true)
  const workspaceRef = useRef(workspace)
  const scopeRef = useRef(scope)
  const syncLock = useRef(false)
  const cloudCheckLock = useRef(false)
  const cloudCheckRef = useRef(null)
  const persistQueue = useRef(Promise.resolve())
  const saveRequest = useRef(0)
  const data = workspace.data
  const driveFolderUrl = driveSession?.folderId
    ? `https://drive.google.com/drive/folders/${encodeURIComponent(driveSession.folderId)}`
    : ''
  const categoryOptions = useMemo(() => ({
    income: categoryChoices(categories.income, data.entries.filter((entry) => entry.type === 'income').map((entry) => entry.category)),
    expense: categoryChoices(categories.expense, [
      ...data.entries.filter((entry) => entry.type === 'expense').map((entry) => entry.category),
      ...(data.budgets || []).map((budget) => budget.category),
    ]),
  }), [data.entries, data.budgets])
  const accountId = session?.user.id
  const [page, setPage] = useState('overview')
  const [settingsSection, setSettingsSection] = useState('appearance')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(() => entryForm('expense', starterWallets))
  const [walletForm, setWalletForm] = useState({ name: '', openingBalance: '0', editNote: '' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [walletFilter, setWalletFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const [reportMonth, setReportMonth] = useState(localDate().slice(0, 7))
  const [pendingBackup, setPendingBackup] = useState(null)
  const [driveSession, setDriveSession] = useState(null)
  const [driveBusy, setDriveBusy] = useState(false)
  const [driveStatus, setDriveStatus] = useState('')
  const [driveUploadError, setDriveUploadError] = useState('')
  const [driveLastSyncedAt, setDriveLastSyncedAt] = useState(null)
  const [receiptRefresh, setReceiptRefresh] = useState(0)
  const driveSessionRef = useRef(null)
  const driveLock = useRef(false)
  const drivePending = useRef(false)
  const pendingDriveReceipts = useRef(new Map())

  useEffect(() => {
    workspaceRef.current = workspace
    scopeRef.current = scope
  })

  useEffect(() => {
    if (googleClientId) loadGoogleIdentity().catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111111' : '#ececec')
    try { localStorage.setItem('budsync-theme', theme) } catch { /* Theme stays active for this visit. */ }
  }, [theme])

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', updateConnection)
    window.addEventListener('offline', updateConnection)
    return () => {
      window.removeEventListener('online', updateConnection)
      window.removeEventListener('offline', updateConnection)
    }
  }, [])

  useEffect(() => {
    async function start() {
      let savedSession = null
      try { savedSession = await readSession() } catch (cause) { setSyncError(`Firebase sign-in could not be restored: ${cause.message}`) }
      const nextScope = workspaceKey(savedSession?.user?.id)
      try {
        let local = await readWorkspace(nextScope)
        if (savedSession) {
          setSession(savedSession)
          if (navigator.onLine) {
            try {
              const remote = await fetchSnapshot()
              if (remote && (!local || (!local.dirty && remote.revision > local.revision))) {
                local = { data: remote.data, revision: remote.revision, dirty: false }
              } else if (!remote && local) {
                local = { ...local, revision: 0, dirty: true }
              }
            } catch (cause) { setSyncError(cause.message) }
          }
          if (!local) local = { ...freshWorkspace(), dirty: true }
        }
        local = await reconcileLocalReceipts(nextScope, local || freshWorkspace(), Boolean(savedSession))
        setScope(nextScope)
        setWorkspace(local)
      } catch {
        setSaveAllowed(false)
        setStorageError('Saved data could not be read. It has not been replaced. Download a backup or start fresh.')
      } finally { setLoading(false) }
    }
    start()
  }, [])

  useEffect(() => {
    if (loading || !saveAllowed) return
    const requestNumber = ++saveRequest.current
    persistQueue.current = persistQueue.current.catch(() => {}).then(() => writeWorkspace(scope, workspace))
    persistQueue.current.then(() => {
      if (requestNumber === saveRequest.current) { setStorageError(''); setLocalSaved(true) }
    }).catch(() => {
      setLocalSaved(false)
      setStorageError('Device storage failed. Download a backup now; changes may not survive refresh.')
    })
  }, [workspace, scope, loading, saveAllowed])

  async function runSync() {
    if (!session || !cloudReady || !navigator.onLine || syncLock.current || conflict || !workspaceRef.current.dirty) return
    syncLock.current = true
    setSyncing(true)
    try {
      await persistQueue.current
      const sent = workspaceRef.current
      const sentScope = scopeRef.current
      const result = await applySnapshot(sent.revision, sent.data)
      if (scopeRef.current !== sentScope) return
      if (!result.applied) {
        if (!result.data) {
          setWorkspace((current) => ({ ...current, revision: 0, dirty: true }))
          setSyncError('The account copy is empty. Retrying your saved device copy.')
        } else {
          setConflict(result)
          setSyncError('Another device changed this account. Review both versions below.')
        }
      } else {
        setWorkspace((current) => ({ ...current, revision: result.revision,
          dirty: JSON.stringify(current.data) !== JSON.stringify(sent.data) }))
        setSyncError('')
      }
    } catch (cause) { setSyncError(cause.message) }
    finally { syncLock.current = false; setSyncing(false) }
  }

  useEffect(() => {
    if (loading || !workspace.dirty || !session || conflict) return
    const timer = setTimeout(() => { runSync() }, 1200)
    return () => clearTimeout(timer)
  // runSync reads the latest workspace through a ref after the debounce.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, session, conflict, loading])

  useEffect(() => {
    if (loading || !accountId || !cloudReady) return
    const refresh = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) cloudCheckRef.current?.({ silent: true })
    }
    const timer = window.setInterval(refresh, 4000)
    const onOnline = () => refresh()
    const onVisible = () => refresh()
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loading, accountId])

  useEffect(() => {
    if (!modal) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    const dialog = document.querySelector('.modal')
    document.body.style.overflow = 'hidden'
    const heading = dialog?.querySelector('h2')
    heading?.setAttribute('tabindex', '-1')
    heading?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); setModal(null); return }
      if (event.key !== 'Tab' || !dialog) return
      const controls = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
      if (!controls.length) return
      const first = controls[0]
      const last = controls.at(-1)
      if (document.activeElement === heading) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [modal])

  function editData(updater) {
    setLocalSaved(false)
    setWorkspace((current) => ({ ...current,
      data: typeof updater === 'function' ? updater(current.data) : updater, dirty: Boolean(session) }))
  }

  async function checkCloud({ silent = false } = {}) {
    if (!session || !cloudReady || !navigator.onLine || cloudCheckLock.current || syncLock.current || (silent && conflict)) return
    cloudCheckLock.current = true
    if (!silent) setSyncing(true)
    const checkedScope = scopeRef.current
    try {
      const remote = await fetchSnapshot()
      if (scopeRef.current !== checkedScope || syncLock.current) return
      const current = workspaceRef.current
      if (remote && remote.revision > current.revision) {
        if (current.dirty) {
          setConflict({ ...remote, applied: false })
          setSyncError('Another device changed this account. Review both versions below.')
        } else {
          setWorkspace({ data: remote.data, revision: remote.revision, dirty: false })
          setNotice('Latest account data downloaded.')
          setSyncError('')
        }
      } else if (current.dirty) await runSync()
      else {
        setSyncError('')
        if (!silent) setNotice('Your account is up to date.')
      }
    } catch (cause) { setSyncError(cause.message) }
    finally {
      cloudCheckLock.current = false
      if (!silent) setSyncing(false)
    }
  }
  useEffect(() => { cloudCheckRef.current = checkCloud })

  async function openAccount(nextSession) {
    setLoading(true)
    driveSessionRef.current = null
    setDriveSession(null)
    setDriveStatus('')
    setDriveUploadError('')
    setDriveLastSyncedAt(null)
    pendingDriveReceipts.current.clear()
    try {
      const nextScope = workspaceKey(nextSession.user.id)
      let local = await readWorkspace(nextScope)
      let remote = null
      let remoteLoaded = false
      try { remote = await fetchSnapshot(); remoteLoaded = true } catch (cause) { setSyncError(cause.message) }
      if (remote && (!local || (!local.dirty && remote.revision > local.revision))) {
        local = { data: remote.data, revision: remote.revision, dirty: false }
      } else if (remoteLoaded && !remote && local) local = { ...local, revision: 0, dirty: true }
      local = await reconcileLocalReceipts(nextScope, local || { ...freshWorkspace(), dirty: !remote }, true)
      setScope(nextScope)
      setSession(nextSession)
      setWorkspace(local)
      setConflict(null)
      if (remote) setSyncError('')
      setAuthPassword('')
      setAuthConfirm('')
      setAuthError('')
      setAuthMode('login')
    } finally { setLoading(false) }
  }

  async function submitAuth(event) {
    event.preventDefault()
    setAuthConfirmation('')
    if (authMode === 'signup' && authPassword !== authConfirm) {
      setAuthError('Passwords do not match.')
      return
    }
    setAuthBusy(true)
    setAuthError('')
    try {
      const next = authMode === 'signup' ? await signUp(authEmail.trim(), authPassword) : await signIn(authEmail.trim(), authPassword)
      if (next) {
        await openAccount(next)
        setAuthConfirmation(authMode === 'signup' ? 'Account created and logged in successfully.' : 'Logged in successfully.')
      } else {
        setAuthPassword('')
        setAuthConfirm('')
        setAuthConfirmation('Check your email to confirm your account, then log in.')
      }
    } catch (cause) { setAuthError(cause.message) }
    finally { setAuthBusy(false) }
  }

  function changeAuthMode(mode) {
    setAuthMode(mode)
    setAuthPassword('')
    setAuthConfirm('')
    setAuthError('')
    setAuthConfirmation('')
  }

  async function leaveAccount() {
    setLoading(true)
    setAuthConfirmation('')
    try {
      try { await persistQueue.current } catch { /* Keep the current workspace in memory. */ }
      await signOut()
      driveSessionRef.current = null
      setDriveSession(null)
      setDriveStatus('')
      setDriveUploadError('')
      setDriveLastSyncedAt(null)
      pendingDriveReceipts.current.clear()
      setSession(null)
      setConflict(null)
      setSyncError('')
      setAuthPassword('')
      setAuthConfirm('')
      setAuthError('')
      setAuthMode('login')
      setScope('guest')
      setWorkspace(freshWorkspace())
      setAuthConfirmation('Logged out successfully. Guest data on this device is separate from your account.')
      try {
        setWorkspace(await reconcileLocalReceipts('guest', await readWorkspace('guest') || freshWorkspace(), false))
      } catch (cause) { setStorageError(cause.message) }
    } catch (cause) { setSyncError(`Log out failed: ${cause.message}`) }
    finally { setLoading(false) }
  }

  async function reviewGuest() {
    try {
      const guest = await readWorkspace('guest')
      if (!guest) return setNotice('There are no guest records on this device to copy.')
      setPendingGuest(guest.data)
    } catch (cause) { setError(cause.message) }
  }

  async function reviewPreviousAccount() {
    try {
      const previous = await readPreviousAccountWorkspace()
      if (!previous) return setNotice('No previous Supabase account copy was found on this device. Import a JSON backup instead.')
      setPendingPrevious(previous)
    } catch (cause) { setError(cause.message) }
  }

  function resolveConflict(choice) {
    if (choice === 'cloud') {
      setWorkspace({ data: conflict.data, revision: conflict.revision, dirty: false })
      setNotice('Account copy loaded. Your previous device copy can be recovered from a backup if you downloaded one.')
    } else {
      setWorkspace((current) => ({ ...current, revision: conflict.revision, dirty: true }))
      setNotice('Your device copy is queued to replace the account copy.')
    }
    setConflict(null)
    setSyncError('')
  }

  const activeWallets = data.wallets.filter((wallet) => !wallet.archived)
  const archivedWallets = data.wallets.filter((wallet) => wallet.archived)
  const activeEntries = data.entries.filter((entry) => !entry.deletedAt)
  const balances = useMemo(() => walletBalances(data.wallets, data.entries), [data])
  const currentMonth = localDate().slice(0, 7)
  const monthLabel = new Date(`${currentMonth}-01T12:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
  const currentReport = useMemo(() => monthlyReport(data.wallets, data.entries, currentMonth), [data, currentMonth])
  const priorMonth = new Date(`${currentMonth}-01T12:00:00Z`)
  priorMonth.setUTCMonth(priorMonth.getUTCMonth() - 1)
  const previousReport = monthlyReport(data.wallets, data.entries, priorMonth.toISOString().slice(0, 7))
  const cashFlow = useMemo(() => cashFlowByMonth(data.entries, currentMonth, chartRange), [data.entries, currentMonth, chartRange])
  const combined = Object.values(balances).reduce((total, value) => total + value, 0)
  const sorted = [...activeEntries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const walletName = (id) => data.wallets.find((wallet) => wallet.id === id)?.name || 'Wallet'
  const list = showDeleted ? data.entries.filter((entry) => entry.deletedAt) : sorted
  const query = search.trim().toLowerCase()
  const filtered = list.filter((entry) => {
    const walletMatches = walletFilter === 'all' || [entry.walletId, entry.fromWalletId, entry.toWalletId].includes(walletFilter)
    const dateMatches = (!dateFrom || entry.date >= dateFrom) && (!dateTo || entry.date <= dateTo)
    const text = [entryName(entry), entry.category, entry.note, entry.editNote, walletName(entry.walletId), walletName(entry.fromWalletId), walletName(entry.toWalletId)].join(' ').toLowerCase()
    return walletMatches && dateMatches && (!query || text.includes(query))
  })
  const report = monthlyReport(data.wallets, data.entries, reportMonth)
  const syncStatus = conflict ? 'Review needed'
    : storageError ? 'Local save failed'
      : !localSaved ? 'Saving locally'
        : !session ? 'Saved locally'
          : !isOnline ? workspace.dirty ? 'Offline · pending sync' : 'Offline · saved locally'
            : syncError ? 'Sync failed'
              : syncing ? 'Syncing'
                : workspace.dirty ? 'Pending sync' : 'Synced'

  async function openEntry(type = 'expense', existing = null) {
    if (existing?.receiptId) {
      const localReceipts = await listReceipts(scope).catch(() => [])
      setPage('receipts')
      setNotice(localReceipts.some((receipt) => receipt.id === existing.receiptId)
        ? 'Edit this expense through its receipt folder so the image and wallet record stay together.'
        : 'This receipt is missing on this device. Connect Google Drive to restore it before editing.')
      return
    }
    setForm(existing ? { ...entryForm(existing.type, activeWallets), ...existing, amount: String(existing.amount), editNote: '' } : entryForm(type, activeWallets))
    setError('')
    setModal({ kind: 'entry', id: existing?.id || null })
  }
  function openTransfer(wallet) {
    const choices = activeWallets.filter((item) => item.id !== wallet.id)
    setForm({ ...entryForm('transfer', activeWallets), fromWalletId: wallet.id, toWalletId: choices[0]?.id || '' })
    setError('')
    setModal({ kind: 'entry', id: null })
  }
  function openWallet(existing = null) {
    setWalletForm(existing ? { name: existing.name, openingBalance: String(existing.openingBalance), editNote: '' } : { name: '', openingBalance: '0', editNote: '' })
    setError('')
    setModal({ kind: 'wallet', id: existing?.id || null })
  }
  function saveEntry(event) {
    event.preventDefault()
    if (!validAmount(form.amount)) return setError('Enter an amount greater than zero, with up to two decimal places.')
    if (!form.date) return setError('Choose a date.')
    if (form.type === 'transfer' && (!form.toWalletId || form.fromWalletId === form.toWalletId)) return setError('Choose two different wallets for a transfer.')
    if (form.type === 'transfer' && (!data.wallets.some((wallet) => wallet.id === form.fromWalletId) || !data.wallets.some((wallet) => wallet.id === form.toWalletId))) return setError('Choose valid wallets for the transfer.')
    if (form.type !== 'transfer' && !data.wallets.some((wallet) => wallet.id === form.walletId)) return setError('Choose a wallet.')
    if (form.type === 'adjustment' && !form.note.trim()) return setError('Add a reason note for this correction.')
    if (modal.id && !form.editNote.trim()) return setError('Add a reason note for this edit.')
    const previous = modal.id ? data.entries.find((entry) => entry.id === modal.id) : null
    const timestamp = new Date().toISOString()
    const entry = {
      id: previous?.id || newId(),
      type: form.type,
      walletId: form.type === 'transfer' ? null : form.walletId,
      fromWalletId: form.type === 'transfer' ? form.fromWalletId : null,
      toWalletId: form.type === 'transfer' ? form.toWalletId : null,
      adjustmentEffect: form.type === 'adjustment' ? form.adjustmentEffect : null,
      amount: Number(form.amount),
      date: form.date,
      category: ['income', 'expense'].includes(form.type)
        ? categoryOptions[form.type].find((option) => option.toLowerCase() === form.category.trim().toLowerCase()) || form.category.trim()
        : '',
      note: form.note.trim(),
      createdAt: previous?.createdAt || timestamp,
      updatedAt: previous ? timestamp : null,
      editNote: previous ? form.editNote.trim() : '',
      deletedAt: null,
      editHistory: previous ? [...(previous.editHistory || []), { at: timestamp, note: form.editNote.trim() }] : [],
      receiptId: null,
      receiptFolderId: null,
    }
    editData((current) => ({ ...current, entries: previous
      ? current.entries.map((item) => item.id === previous.id ? entry : item)
      : [entry, ...current.entries] }))
    setModal(null)
    setNotice(previous ? 'Transaction updated.' : 'Transaction added.')
  }
  function saveWallet(event) {
    event.preventDefault()
    const name = walletForm.name.trim()
    if (!name || name.length > 60) return setError('Enter a wallet name up to 60 characters.')
    if (!validAmount(walletForm.openingBalance, true)) return setError('Enter a valid opening balance with up to two decimal places.')
    if (data.wallets.some((wallet) => wallet.id !== modal.id && wallet.name.toLowerCase() === name.toLowerCase())) return setError('A wallet with this name already exists.')
    if (modal.id && !walletForm.editNote.trim()) return setError('Add a reason for changing this wallet.')
    const timestamp = new Date().toISOString()
    editData((current) => {
      if (modal.id) return {
        ...current, sampleBalances: false,
        wallets: current.wallets.map((wallet) => wallet.id === modal.id
          ? { ...wallet, name, openingBalance: Number(walletForm.openingBalance), updatedAt: timestamp, editNote: walletForm.editNote.trim() }
          : wallet),
      }
      return {
        ...current,
        wallets: [...current.wallets, {
          id: newId(), name, type: 'Custom', openingBalance: Number(walletForm.openingBalance),
          currency: 'PHP', color: ['blue', 'purple', 'teal', 'orange'][current.wallets.length % 4],
          archived: false, updatedAt: null, editNote: '',
        }],
      }
    })
    setModal(null)
    setNotice(modal.id ? 'Wallet updated.' : 'Wallet created.')
  }
  function toggleArchive(wallet) {
    if (!wallet.archived && activeWallets.length === 1) return setNotice('Keep at least one wallet active.')
    editData((current) => ({ ...current, wallets: current.wallets.map((item) => item.id === wallet.id
      ? { ...item, archived: !item.archived, updatedAt: new Date().toISOString(), editNote: item.archived ? 'Restored wallet' : 'Archived wallet' }
      : item) }))
    setNotice(wallet.archived ? 'Wallet restored.' : 'Wallet archived. Its balance still counts in the combined total.')
  }
  function deleteEntry(id) {
    if (data.entries.find((entry) => entry.id === id)?.receiptId) {
      setPage('receipts')
      setNotice('Delete this expense in its receipt folder so the change reaches Google Drive and other devices.')
      return
    }
    editData((current) => ({ ...current, entries: current.entries.map((entry) => entry.id === id ? { ...entry, deletedAt: new Date().toISOString() } : entry) }))
    setNotice('Transaction moved to Recently deleted. You can restore it there.')
  }
  async function restoreEntry(id) {
    const entry = data.entries.find((item) => item.id === id)
    if (entry?.receiptId && !(await listReceipts(scope).catch(() => [])).some((receipt) => receipt.id === entry.receiptId)) {
      setNotice('Restore this receipt from Google Drive before restoring its expense.')
      return
    }
    editData((current) => ({ ...current, entries: current.entries.map((entry) => entry.id === id ? { ...entry, deletedAt: null } : entry) }))
    setNotice('Transaction restored.')
  }
  function showWallet(id) {
    setWalletFilter(id)
    setShowDeleted(false)
    setPage('transactions')
  }
  async function chooseBackup(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) return setError('Choose a backup smaller than 5 MB.')
    try {
      const imported = parseBackup(await file.text())
      setPendingBackup({ name: file.name, data: imported })
      setError('')
    } catch (cause) {
      setPendingBackup(null)
      setError(cause.message)
    }
  }
  async function restoreBackup() {
    const restoredData = { ...pendingBackup.data, receiptSyncCutoff: new Date().toISOString() }
    try {
      await pruneReceiptCache(scope, new Set(restoredData.entries.filter((entry) => entry.receiptId).map((entry) => entry.id)), true)
    } catch (cause) { setError(`Receipt storage could not be updated: ${cause.message}`); return }
    editData(restoredData)
    setSaveAllowed(true)
    setPendingBackup(null)
    setWalletFilter('all')
    setShowDeleted(false)
    setNotice('Backup restored in this browser.')
    setReceiptRefresh((current) => current + 1)
    if (driveSessionRef.current) uploadReceipts()
    setError('')
  }
  function clearSamples() {
    const sampleIds = new Set(starterWallets.map((wallet) => wallet.id))
    editData((current) => ({ ...current, sampleBalances: false, wallets: current.wallets.map((wallet) => sampleIds.has(wallet.id) ? { ...wallet, openingBalance: 0 } : wallet) }))
  }
  function addBudget(category, limit) {
    editData((current) => ({ ...current, budgets: [...(current.budgets || []), { id: newId(), category, limit }] }))
    setNotice('Monthly budget added.')
  }
  function removeBudget(id) {
    editData((current) => ({ ...current, budgets: (current.budgets || []).filter((item) => item.id !== id) }))
    setNotice('Budget removed.')
  }
  function addGoal(name, target, walletId) {
    editData((current) => ({ ...current, goals: [...(current.goals || []), { id: newId(), name, target, walletId }] }))
    setNotice('Savings target added.')
  }
  function removeGoal(id) {
    editData((current) => ({ ...current, goals: (current.goals || []).filter((item) => item.id !== id) }))
    setNotice('Savings target removed.')
  }

  async function commitReceiptFinance(updater) {
    await persistQueue.current
    const current = workspaceRef.current
    const next = { ...current, data: updater(current.data), dirty: Boolean(session) }
    await writeWorkspace(scopeRef.current, next)
    workspaceRef.current = next
    setWorkspace(next)
    setLocalSaved(true)
  }

  async function saveReceiptExpense(receipt, folder) {
    const timestamp = new Date().toISOString()
    await commitReceiptFinance((current) => ({ ...current, entries: upsertReceiptExpense(current.entries, receipt, folder, timestamp) }))
  }

  async function reverseReceiptExpenses(ids) {
    await commitReceiptFinance((current) => ({ ...current, entries: removeReceiptExpenses(current.entries, ids, new Date().toISOString()) }))
  }

  async function changeReceiptFolderWallet(ids, walletId, reason) {
    await commitReceiptFinance((current) => ({ ...current, entries: moveReceiptExpenses(current.entries, ids, walletId, reason, new Date().toISOString()) }))
  }

  async function pullDriveReceipts(current) {
    const entryIds = new Set(workspaceRef.current.data.entries.filter((entry) => entry.receiptId).map((entry) => entry.id))
    const cutoff = workspaceRef.current.data.receiptSyncCutoff
    if (cutoff) await pruneReceiptCache(current.scope, entryIds, false, cutoff)
    const result = await restoreFromDrive(current.token, current.scope, workspaceRef.current.data.wallets, cutoff ? entryIds : null, undefined, cutoff)
    if (result.restored.length || result.deletedEntryIds.length) {
      const deleted = new Set(result.deletedEntryIds)
      editData((local) => ({ ...local, entries: result.restored.reduce((entries, { receipt, folder }) => {
        const existing = entries.find((entry) => entry.id === receipt.entryId)
        const remoteTime = [receipt.updatedAt, receipt.createdAt, folder.updatedAt, folder.createdAt].filter(Boolean).sort().at(-1) || ''
        const entryTime = existing?.updatedAt || existing?.createdAt || ''
        return existing && (existing.deletedAt || remoteTime <= entryTime) ? entries : upsertReceiptExpense(entries, receipt, folder, remoteTime)
      }, removeReceiptExpenses(local.entries, deleted, new Date().toISOString())) }))
    }
    setReceiptRefresh((value) => value + 1)
    return result
  }

  useEffect(() => {
    if (!driveSession) return undefined
    const timer = window.setTimeout(() => { uploadReceipts() }, 300)
    return () => window.clearTimeout(timer)
  // Wallet names and assignments are read from the latest workspace during upload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.wallets, driveSession])

  useEffect(() => {
    if (!driveSession) return undefined
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) uploadReceipts()
    }, 20000)
    return () => window.clearInterval(timer)
  // The timer reads the current Drive session and workspace through refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveSession])

  function requestReceiptDriveSync(receipt, notify) {
    if (receipt) pendingDriveReceipts.current.set(receipt.id, { revision: receipt.updatedAt || receipt.createdAt, notify })
    uploadReceipts()
  }

  async function recordDriveSync(current, result) {
    const changed = await Promise.all(result.syncedReceipts.map(({ id, revision }) => markReceiptDriveSynced(current.scope, id, revision)))
    if (changed.some(Boolean)) setReceiptRefresh((value) => value + 1)
    setDriveUploadError('')
    setDriveLastSyncedAt(new Date())
  }

  async function uploadReceipts() {
    const current = driveSessionRef.current
    if (!current) return
    if (driveLock.current) { drivePending.current = true; return }
    if (Date.now() >= current.expiresAt - 30000) {
      driveSessionRef.current = null
      setDriveSession(null)
      setDriveUploadError('Reconnect Google Drive to finish uploading.')
      setDriveStatus('Google Drive needs reconnection. Local receipt changes are pending.')
      for (const pending of pendingDriveReceipts.current.values()) pending.notify?.('Reconnect Google Drive to finish uploading.')
      return
    }
    driveLock.current = true
    setDriveBusy(true)
    try {
      const restored = await pullDriveReceipts(current)
      const result = await syncToDrive(current.token, current.scope, workspaceRef.current.data.wallets)
      if (result.rootId && current.folderId !== result.rootId) {
        current.folderId = result.rootId
        setDriveSession({ ...current })
      }
      await recordDriveSync(current, result)
      setDriveStatus(`Google Drive updated${result.uploaded ? `: ${result.uploaded} files` : ''}${restored.receipts ? `; downloaded ${restored.receipts} receipts` : ''}.`)
      const confirmed = result.syncedReceipts.filter(({ id, revision }) =>
        pendingDriveReceipts.current.has(id) && revision === pendingDriveReceipts.current.get(id).revision).map(({ id }) => id)
      if (confirmed.length) {
        for (const id of confirmed) {
          pendingDriveReceipts.current.get(id)?.notify?.(null)
          pendingDriveReceipts.current.delete(id)
        }
      }
      for (const { id, revision } of result.syncedReceipts) {
        const pending = pendingDriveReceipts.current.get(id)
        if (pending && revision > pending.revision) {
          pending.notify?.('A newer receipt from another device was found. Review that receipt before editing again.')
          pendingDriveReceipts.current.delete(id)
        }
      }
    } catch (cause) {
      setDriveUploadError(cause.message)
      setDriveStatus(`Drive upload failed: ${cause.message}. Local changes are pending.`)
      for (const pending of pendingDriveReceipts.current.values()) pending.notify?.(cause.message)
    }
    finally {
      driveLock.current = false
      setDriveBusy(false)
      if (drivePending.current) { drivePending.current = false; uploadReceipts() }
    }
  }

  async function connectDrive() {
    if (driveLock.current) return
    driveLock.current = true
    setDriveBusy(true)
    setDriveStatus('Connecting to Google Drive…')
    try {
      const expectedEmail = session?.user?.email?.trim().toLowerCase()
      const currentScope = scopeRef.current
      if (!expectedEmail) throw new Error('Sign in to Budsync before connecting Google Drive. Drive must use the same account as your Budsync login.')
      const authorization = await connectGoogleDrive(expectedEmail)
      if (scopeRef.current !== currentScope || session?.user?.email?.trim().toLowerCase() !== expectedEmail) {
        throw new Error('Your Budsync account changed during Google authorization. No Drive data was synced. Connect Google Drive again.')
      }
      await activateDriveAccount(authorization, currentScope, true)
    } catch (cause) { setDriveUploadError(cause.message); setDriveStatus(`Google Drive connection failed: ${cause.message}`) }
    finally {
      driveLock.current = false
      setDriveBusy(false)
      if (drivePending.current) { drivePending.current = false; uploadReceipts() }
    }
  }

  async function activateDriveAccount(authorization, currentScope, alreadyLocked = false) {
    if (driveLock.current && !alreadyLocked) return
    driveLock.current = true
    setDriveBusy(true)
    setDriveUploadError('')
    try {
      const current = { ...authorization, scope: currentScope }
      setDriveStatus('Connected. Checking Drive for receipt changes…')
      const restored = await pullDriveReceipts(current)
      const uploaded = await syncToDrive(current.token, current.scope, workspaceRef.current.data.wallets)
      current.folderId = uploaded.rootId
      driveSessionRef.current = current
      setDriveSession({ ...current })
      await recordDriveSync(current, uploaded)
      setDriveStatus(`Connected. Updated ${restored.folders} folders and ${restored.receipts} receipts; uploaded ${uploaded.uploaded} files.${restored.skipped ? ` ${restored.skipped} items need matching wallets.` : ''}`)
    } catch (cause) {
      setDriveUploadError(cause.message)
      setDriveStatus(`Google Drive connection failed: ${cause.message}`)
    }
    finally {
      driveLock.current = false
      setDriveBusy(false)
      if (drivePending.current) { drivePending.current = false; uploadReceipts() }
    }
  }

  async function restoreDrive() {
    const current = driveSessionRef.current
    if (!current || driveLock.current) return
    if (Date.now() >= current.expiresAt - 30000) {
      driveSessionRef.current = null
      setDriveSession(null)
      return setDriveStatus('Reconnect Google Drive to restore receipts.')
    }
    driveLock.current = true
    setDriveBusy(true)
    try {
      const restored = await pullDriveReceipts(current)
      setDriveStatus(`Updated ${restored.folders} folders and ${restored.receipts} receipts from Drive.${restored.skipped ? ` ${restored.skipped} items need matching wallets.` : ''}`)
    } catch (cause) { setDriveStatus(`Drive restore failed: ${cause.message}`) }
    finally { driveLock.current = false; setDriveBusy(false) }
  }

  if (loading) return <div className="loading-screen" role="status">Loading your Budsync records…</div>

  if (!data.setupComplete && saveAllowed) return <div className="setup-screen"><section className="setup-card"><span className="widget-kicker">WELCOME TO BUDSYNC</span><h1>Set up your wallets</h1><p>Choose how the four starter wallets should begin. You can edit their opening balances later. This choice does not add any transactions.</p><div className="setup-options"><button type="button" onClick={() => editData((current) => ({ ...current, setupComplete: true, sampleBalances: false }))}><strong>Start at ₱0</strong><span>Use your real opening balances when you are ready.</span></button><button type="button" onClick={() => editData((current) => ({ ...current, wallets: starterWallets.map((wallet) => ({ ...wallet })), setupComplete: true, sampleBalances: true }))}><strong>Explore with sample balances</strong><span>Try Personal ₱1,000, Organization ₱500, and Savings ₱300.</span></button></div></section><PolicyLinks /></div>

  return <div className={'app' + (sidebarCollapsed ? ' sidebar-compact' : '')}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <div className="sidebar-top"><button className="brand" type="button" aria-label="Budsync home" onClick={() => setPage('overview')}><span className="brand-icon">◉</span><span className="brand-word">budsync<span>.</span></span></button><button className="collapse-button" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><NavIcon name="menu" size={19} /></button></div>
      <div className="mobile-header-actions"><button type="button" aria-label="Insights" onClick={() => setPage('reports')}><NavIcon name="reports" /></button><button type="button" aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><NavIcon name={theme === 'dark' ? 'sun' : 'moon'} /></button><button type="button" aria-label="Settings" onClick={() => setPage('account')}><NavIcon name="account" /></button></div>
      <div className="side-content">
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Desktop navigation">{navigation.map(([id, label]) => <button type="button" key={id} title={label} aria-current={page === id ? 'page' : undefined} className={page === id ? 'active' : ''} onClick={() => setPage(id)}><span className="nav-icon"><NavIcon name={id} /></span><span className="nav-text">{label}</span></button>)}</nav>
        <p className="nav-label wallets-label">YOUR WALLETS</p>
        <div className="side-wallets">{activeWallets.map((wallet) => <button type="button" key={wallet.id} onClick={() => showWallet(wallet.id)}><span className={'mini-wallet ' + wallet.color}>{wallet.name[0]}</span>{wallet.name}</button>)}</div>
      </div>
      <div className="side-bottom"><span className="side-status-dot" /><div><strong>{syncStatus}</strong><small>{session ? 'Your account workspace' : 'Guest workspace · PHP only'}</small></div></div>
    </aside>
    <div className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>›</span> <strong>{navigation.find(([id]) => id === page)?.[1]}</strong></div><div className="top-right"><span className={'status' + (syncError || storageError ? ' status-error' : workspace.dirty ? ' status-pending' : '')} role="status"><i /> {syncStatus}</span><button className="top-icon-button" type="button" aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><NavIcon name={theme === 'dark' ? 'sun' : 'moon'} size={18} /></button><button className="avatar" type="button" aria-label="Settings" onClick={() => setPage('account')}>B</button></div></header>
      <main id="main-content" className="content" key={page}>
        <div className={'mobile-sync-pill' + (syncError || storageError ? ' status-error' : workspace.dirty ? ' status-pending' : '')} role="status"><i /> {syncStatus}</div>
        {!saveAllowed && <div className="error-banner" role="alert">Saved data could not be read. It has not been replaced. Restore a backup in Settings, or <button type="button" onClick={() => { setSaveAllowed(true); setNotice('Started with sample data.') }}>start fresh</button>.</div>}
        {storageError && <div className="error-banner" role="alert">{storageError}</div>}
        {syncError && <div className="error-banner" role="alert">{syncError} <button type="button" onClick={() => { setSettingsSection('connections'); setPage('account') }}>Open sync settings</button></div>}
        {notice && <div className="notice-banner" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice">×</button></div>}
        {data.sampleBalances && data.entries.length > 0 && <div className="sample-banner"><span><strong>Sample opening balances</strong> from the V1 plan are loaded for testing. Entries you add save on this device.</span><button type="button" onClick={clearSamples}>Start from ₱0 instead →</button></div>}

        {page === 'overview' && <>
          {data.sampleBalances && data.entries.length === 0 && <section className="welcome-card" aria-labelledby="welcome-title"><div><span className="widget-kicker">WELCOME TO BUDSYNC</span><h2 id="welcome-title">Your money, in a clearer view.</h2><p>Explore with the plan’s sample opening balances, start with zero, or bring in an existing account or backup. {session ? 'Changes save on this device and sync when online.' : 'Guest entries stay on this device until you choose to sign in and copy them.'}</p><div className="button-row"><button type="button" className="primary" onClick={clearSamples}>Start fresh at ₱0</button><button type="button" className="secondary" onClick={() => { setSettingsSection('data'); setPage('account') }}>Restore existing data</button></div></div><div className="welcome-art" aria-hidden="true"><i /><i /><i /></div></section>}
          <div className="page-head"><div><div className="eyebrow">YOUR FINANCIAL SPACE</div><h1>Good to see you.</h1><p>A clear picture of your money, all in one place.</p></div></div>
          <section className="balance-hero" aria-label="Combined wallet balance"><div className="hero-main"><div className="hero-label">TOTAL BALANCE <span>Across {data.wallets.length} wallets</span></div><div className="hero-amount"><strong key={balanceHidden ? 'hidden' : combined}>{balanceHidden ? '₱ ••••••' : php(combined)}</strong><button type="button" aria-label={balanceHidden ? 'Show balance' : 'Hide balance'} onClick={() => setBalanceHidden(!balanceHidden)}><NavIcon name={balanceHidden ? 'eyeOff' : 'eye'} size={19} /></button></div><p>Opening balances plus recorded activity. Adjustments are excluded from monthly net.</p><button className="hero-action" type="button" onClick={() => openEntry()}><NavIcon name="plus" size={16} /> Add transaction</button></div><div className="hero-side"><span>{monthLabel.toUpperCase()}</span><strong>{balanceHidden ? '₱ ••••••' : php(currentReport.net)}</strong><small>Net income after expenses</small></div></section>
          <div className="metrics"><Metric label="Income this month" value={balanceHidden ? '₱ ••••••' : php(currentReport.income)} detail={monthComparison(currentReport.income, previousReport.income)} tone="green" icon="↓" /><Metric label="Expenses this month" value={balanceHidden ? '₱ ••••••' : php(currentReport.expenses)} detail={monthComparison(currentReport.expenses, previousReport.expenses)} tone="coral" icon="↑" /></div>
          <div className="dashboard-grid"><CashFlowChart items={cashFlow} range={chartRange} onRange={setChartRange} hidden={balanceHidden} /><SpendingPanel report={currentReport} budgets={data.budgets || []} hidden={balanceHidden} /></div>
          <SectionHeading title="Your wallets" subtitle="Balances across the places you keep money." action="Manage wallets" onAction={() => setPage('wallets')} />
          <div className="wallet-grid">{activeWallets.map((wallet) => <WalletCard key={wallet.id} wallet={wallet} balance={balances[wallet.id]} hidden={balanceHidden} recent={sorted.find((entry) => [entry.walletId, entry.fromWalletId, entry.toWalletId].includes(wallet.id))} onShow={() => showWallet(wallet.id)} onTransfer={activeWallets.length > 1 ? () => openTransfer(wallet) : undefined} />)}</div>
          <SectionHeading title="Recent activity" subtitle="Your latest recorded transactions." action="See all activity" onAction={() => setPage('transactions')} />
          <div className="panel">{sorted.length ? sorted.slice(0, 5).map((entry) => <TransactionRow key={entry.id} entry={entry} walletName={walletName} hidden={balanceHidden} onEdit={() => openEntry(entry.type, entry)} onDelete={() => deleteEntry(entry.id)} />) : <EmptyState onAdd={() => openEntry()} />}</div>
        </>}

        {page === 'transactions' && <>
          <div className="page-head"><div><div className="eyebrow">YOUR ACTIVITY</div><h1>Transactions</h1><p>Search, filter, and manage your records.</p></div><button className="primary" type="button" onClick={() => openEntry()}>＋ Add transaction</button></div>
          <div className="quick-actions">{[['income', 'income', 'Add income', 'Money coming in', 'green'], ['expense', 'expense', 'Add expense', 'Money going out', 'coral'], ['transfer', 'transfer', 'Transfer', 'Move between wallets', 'blue'], ['adjustment', 'adjustment', 'Adjustment', 'Correct a balance', 'purple']].map(([type, icon, label, sub, color]) => <button type="button" key={type} onClick={() => openEntry(type)}><span className={'quick-icon ' + color}><NavIcon name={icon} size={19} /></span><span><strong>{label}</strong><small>{sub}</small></span><span className="quick-arrow" aria-hidden="true"><NavIcon name="chevronRight" size={17} /></span></button>)}</div>
          <section className="panel history">
            <div className="history-head"><div><h2>Transaction history</h2><p>{filtered.length} {filtered.length === 1 ? 'entry' : 'entries'} shown</p></div><button type="button" className={showDeleted ? 'tab-active' : ''} onClick={() => setShowDeleted(!showDeleted)}>{showDeleted ? 'Show active' : 'Recently deleted'}</button></div>
            <div className="filters"><label>Search<input type="search" placeholder="Category, note, or wallet" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>Wallet<select value={walletFilter} onChange={(event) => setWalletFilter(event.target.value)}><option value="all">All wallets</option>{data.wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select></label><label>From<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label><label>To<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>{(walletFilter !== 'all' || dateFrom || dateTo || search) && <button type="button" onClick={() => { setWalletFilter('all'); setDateFrom(''); setDateTo(''); setSearch('') }}>Clear filters</button>}</div>
            {filtered.length ? filtered.map((entry) => <TransactionRow key={entry.id} entry={entry} walletName={walletName} walletFilter={walletFilter} hidden={balanceHidden} onEdit={() => openEntry(entry.type, entry)} onDelete={() => deleteEntry(entry.id)} onRestore={() => restoreEntry(entry.id)} deleted={showDeleted} />) : <EmptyState filtered={list.length > 0 || showDeleted} onAdd={() => openEntry()} />}
          </section>
        </>}

        {page === 'wallets' && <>
          <div className="page-head"><div><div className="eyebrow">YOUR MONEY, ORGANIZED</div><h1>Wallets</h1><p>Set opening balances and organize your money.</p></div><button className="primary" type="button" onClick={() => openWallet()}>＋ Add wallet</button></div>
          <div className="wallet-total"><small>Combined balance</small><strong>{shownMoney(combined, balanceHidden)}</strong><small>Includes archived wallets</small></div>
          <div className="wallet-grid wallet-details">{activeWallets.map((wallet) => <WalletCard key={wallet.id} wallet={wallet} balance={balances[wallet.id]} summary={currentReport.byWallet.find((item) => item.id === wallet.id)} hidden={balanceHidden} detailed onShow={() => showWallet(wallet.id)} onTransfer={activeWallets.length > 1 ? () => openTransfer(wallet) : undefined} onEdit={() => openWallet(wallet)} onArchive={() => toggleArchive(wallet)} />)}</div>
          {archivedWallets.length > 0 && <><SectionHeading title="Archived wallets" subtitle="Balances and history remain in your totals." /><div className="wallet-grid wallet-details">{archivedWallets.map((wallet) => <WalletCard key={wallet.id} wallet={wallet} balance={balances[wallet.id]} summary={currentReport.byWallet.find((item) => item.id === wallet.id)} hidden={balanceHidden} detailed onShow={() => showWallet(wallet.id)} onEdit={() => openWallet(wallet)} onArchive={() => toggleArchive(wallet)} />)}</div></>}
        </>}

        {page === 'reports' && <Reports report={report} month={reportMonth} onMonth={setReportMonth} budgets={data.budgets || []} goals={data.goals || []} wallets={data.wallets} balances={balances} hidden={balanceHidden} categoryOptions={categoryOptions} onAddBudget={addBudget} onRemoveBudget={removeBudget} onAddGoal={addGoal} onRemoveGoal={removeGoal} />}

        {page === 'receipts' && <ReceiptPage scope={scope} wallets={data.wallets} entries={data.entries} onExpenseSaved={saveReceiptExpense} onExpensesRemoved={reverseReceiptExpenses} onFolderWalletChanged={changeReceiptFolderWallet} onDriveSync={requestReceiptDriveSync} onConnectDrive={connectDrive} driveConnected={Boolean(driveSession)} driveFolderUrl={driveFolderUrl} driveAvailable={Boolean(googleClientId)} driveBusy={driveBusy} driveStatus={driveStatus} driveUploadError={driveUploadError} driveLastSyncedAt={driveLastSyncedAt} onOpenSettings={() => { setSettingsSection('connections'); setPage('account') }} refreshKey={receiptRefresh} hidden={balanceHidden} />}

        {page === 'account' && <div className="data-page">
          <div className="page-head"><div><div className="eyebrow">YOUR SPACE</div><h1>Settings</h1><p>Personalize Budsync, manage your account, and control your data.</p></div></div>
          <div className="settings-tabs" role="group" aria-label="Settings section"><button type="button" aria-pressed={settingsSection === 'appearance'} className={settingsSection === 'appearance' ? 'selected' : ''} onClick={() => setSettingsSection('appearance')}>Appearance</button><button type="button" aria-pressed={settingsSection === 'connections'} className={settingsSection === 'connections' ? 'selected' : ''} onClick={() => setSettingsSection('connections')}>Account & connections</button><button type="button" aria-pressed={settingsSection === 'data'} className={settingsSection === 'data' ? 'selected' : ''} onClick={() => setSettingsSection('data')}>Data & backup</button></div>
          {settingsSection === 'appearance' && <>
            <section className="data-card settings-card"><div className="settings-card-heading"><span className="settings-icon"><NavIcon name="sun" size={19} /></span><div><h2>Appearance</h2><p>Choose the look that feels comfortable for you.</p></div></div><div className="settings-choice-group" role="group" aria-label="Color theme"><button type="button" aria-pressed={theme === 'light'} className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><NavIcon name="sun" size={18} /><span><strong>Light</strong><small>Bright surfaces</small></span></button><button type="button" aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><NavIcon name="moon" size={18} /><span><strong>Dark</strong><small>Dim surfaces</small></span></button></div></section>
            <section className="data-card settings-card"><div className="settings-card-heading"><span className="settings-icon"><NavIcon name={balanceHidden ? 'eyeOff' : 'eye'} size={19} /></span><div><h2>Privacy on screen</h2><p>Hide money amounts when you want a little more privacy.</p></div></div><div className="settings-toggle-row"><span><strong>Hide balances</strong><small>Applies to dashboards, wallets, and reports.</small></span><button type="button" role="switch" aria-checked={balanceHidden} aria-label="Hide balances" className={'settings-switch' + (balanceHidden ? ' on' : '')} onClick={() => setBalanceHidden(!balanceHidden)}><span /></button></div></section>
          </>}
          {settingsSection === 'connections' && <>
          <section className="data-card account-access"><h2>Account</h2>{authConfirmation && <p className="account-confirmation" role="status">{authConfirmation}</p>}{session ? <>
            <p>Logged in as <strong>{session.user.email}</strong>. Your account records save on this device and sync when online.</p>
            <p className="sync-state" role="status">{syncStatus}</p>
            <div className="button-row"><button className="secondary" type="button" disabled={loading} onClick={leaveAccount}>Log out</button></div>
          </> : <>
            <p>Log in to sync your records across devices, or sign up for a new account. Guest records stay on this device until you choose to copy them into an account.</p>
            {cloudReady ? <>
              <div className="auth-tabs" role="group" aria-label="Account action">
                <button type="button" className={authMode === 'login' ? 'selected' : ''} aria-pressed={authMode === 'login'} disabled={authBusy} onClick={() => changeAuthMode('login')}>Login</button>
                <button type="button" className={authMode === 'signup' ? 'selected' : ''} aria-pressed={authMode === 'signup'} disabled={authBusy} onClick={() => changeAuthMode('signup')}>Sign up</button>
              </div>
              <form className="auth-form" onSubmit={submitAuth}>
                <label>Email<input required type="email" autoComplete="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /></label>
                <label>Password<input required type="password" minLength="6" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /></label>
                {authMode === 'signup' && <label>Confirm password<input required type="password" minLength="6" autoComplete="new-password" value={authConfirm} onChange={(event) => setAuthConfirm(event.target.value)} /></label>}
                {authError && <p className="form-error" role="alert">{authError}</p>}
                <div className="button-row"><button className="primary" type="submit" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'signup' ? 'Create account' : 'Login'}</button></div>
              </form>
            </> : <p>Account access needs the Firebase web app values in <code>.env.local</code>.</p>}
          </>}</section>
          <section className="data-card"><h2>Google Drive receipts</h2><p>Connect Google Drive with the same email you use to sign in to Budsync. Google will use your Budsync email automatically. If Google authorizes another account, Budsync blocks the connection before any receipts are restored or uploaded. Budsync creates <code>Budsync / wallet name / folder name / files</code> in Drive. Deleted local receipts and folders move to Drive Trash on the next sync. Your local copy remains available while disconnected.</p>{googleClientId ? <div className="button-row"><button className="primary" type="button" disabled={driveBusy || !isOnline} onClick={connectDrive}>{driveSession ? 'Reconnect Google Drive' : 'Connect Google Drive'}</button><button className="secondary" type="button" disabled={driveBusy || !driveSession || !isOnline} onClick={uploadReceipts}>Sync receipts now</button><button className="secondary" type="button" disabled={driveBusy || !driveSession || !isOnline} onClick={restoreDrive}>Download Drive changes</button>{driveFolderUrl && <a className="drive-folder-link" href={driveFolderUrl} target="_blank" rel="noopener noreferrer">Open Budsync folder <span aria-hidden="true">↗</span></a>}</div> : <p>Google Drive uploads are not set up for this site. Add a Google OAuth Web client ID as <code>VITE_GOOGLE_CLIENT_ID</code>, then rebuild and deploy the app. Images saved now stay on this device. The README has setup steps.</p>}{driveStatus && <p className="sync-state" role={driveUploadError ? 'alert' : 'status'}>{driveStatus}</p>}</section>
          </>}
          {settingsSection === 'data' && <>
          <section className="data-card settings-card"><div className="settings-card-heading"><span className="settings-icon"><NavIcon name="receipts" size={19} /></span><div><h2>Your data</h2><p>{session ? 'Your account workspace is saved on this device and syncs with your account when online.' : 'Your guest workspace is saved in this browser on this device.'} Receipt images are stored separately on this device unless Google Drive sync is connected.</p></div></div></section>
          <section className="data-card"><h2>Backup & export</h2><p>Download a JSON backup to restore wallet records later. Receipt images and folders stay on this device; download individual images from Receipts. CSV is for viewing transactions in a spreadsheet.</p><div className="button-row"><button className="primary" type="button" onClick={() => download('budsync-backup-' + localDate() + '.json', backupJson(data), 'application/json')}>Download backup</button><button className="secondary" type="button" onClick={() => download('budsync-transactions-' + localDate() + '.csv', transactionsCsv(data), 'text/csv;charset=utf-8')}>Export CSV</button></div></section>
          <section className="data-card"><h2>Restore a backup</h2><p>Choose a Budsync JSON backup. Review its contents before replacing this device’s records.</p><label className="import-label">Choose backup file<input type="file" accept=".json,application/json" onChange={chooseBackup} /></label>{error && <p className="form-error" role="alert">{error}</p>}{pendingBackup && <div className="restore-review"><strong>{pendingBackup.name}</strong><span>{pendingBackup.data.wallets.length} wallets · {pendingBackup.data.entries.length} transactions · {pendingBackup.data.budgets.length} budgets · {pendingBackup.data.goals.length} goals</span><p>Restoring replaces wallets, transactions, budgets, and goals. Local receipt folders and images without a matching receipt expense in this backup are removed, and those deletions sync to connected Google Drive. Download your current backup and any receipt images you need first.</p><div className="button-row"><button className="primary" type="button" onClick={restoreBackup}>Replace with this backup</button><button className="secondary" type="button" onClick={() => setPendingBackup(null)}>Cancel</button></div></div>}</section>
          </>}
          {settingsSection === 'connections' && session && <section className="data-card"><h2>Account sync</h2>
            <p>While the app is open, changes from other devices appear automatically within a few seconds.</p>
            <p className="sync-state" role="status">{syncStatus}</p>
            <div className="button-row"><button className="secondary" type="button" disabled={syncing} onClick={() => checkCloud()}>Check for updates</button><button className="secondary" type="button" onClick={reviewGuest}>Copy guest data here</button><button className="secondary" type="button" onClick={reviewPreviousAccount}>Copy previous account data</button></div>
            {pendingGuest && <div className="restore-review"><strong>Copy guest data into this account?</strong><span>{pendingGuest.wallets.length} wallets · {pendingGuest.entries.length} transactions</span><p>This replaces the account data on this device and queues it for sync. Download a backup of the current account first if you need it.</p><div className="button-row"><button className="primary" type="button" onClick={() => { editData(pendingGuest); setPendingGuest(null); setNotice('Guest records copied into your account and queued for sync.') }}>Copy guest data</button><button className="secondary" type="button" onClick={() => setPendingGuest(null)}>Cancel</button></div></div>}
            {pendingPrevious && <div className="restore-review"><strong>Copy saved data from {pendingPrevious.email}?</strong><span>{pendingPrevious.data.wallets.length} wallets · {pendingPrevious.data.entries.length} transactions</span><p>This is the last account copy saved on this device. It replaces the current Firebase workspace and uploads on the next sync. Export a backup first if you need the current workspace.</p><div className="button-row"><button className="primary" type="button" onClick={() => { editData(pendingPrevious.data); setPendingPrevious(null); setNotice('Previous account data copied into this Firebase account and queued for sync.') }}>Copy previous data</button><button className="secondary" type="button" onClick={() => setPendingPrevious(null)}>Cancel</button></div></div>}
            {conflict && <div className="restore-review" role="alert"><strong>Choose which copy to keep</strong><span>On this device: {data.wallets.length} wallets · {data.entries.length} transactions<br />In your account: {conflict.data.wallets.length} wallets · {conflict.data.entries.length} transactions</span><ul className="conflict-list">{changedRecords(data, conflict.data).slice(0, 12).map((change, index) => <li key={index}>{change}</li>)}</ul><p>Download a backup of this device before choosing the account copy. Choosing this device will replace the newer account copy.</p><div className="button-row"><button className="secondary" type="button" onClick={() => resolveConflict('cloud')}>Use account copy</button><button className="primary" type="button" onClick={() => resolveConflict('device')}>Upload this device copy</button></div></div>}
          </section>}
        </div>}
        <PolicyLinks />
      </main>
    </div>

    <nav className="mobile-dock" aria-label="Mobile navigation">
      {[['overview', 'Home'], ['wallets', 'Wallets']].map(([id, label]) => <button type="button" key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}><NavIcon name={id} /><span>{label}</span></button>)}
      <button className="dock-add" type="button" aria-label="Add transaction" onClick={() => openEntry()}><NavIcon name="plus" size={26} /><span>Add</span></button>
      {[['transactions', 'Activity'], ['receipts', 'Receipts']].map(([id, label]) => <button type="button" key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}><NavIcon name={id} /><span>{label}</span></button>)}
    </nav>

    {modal?.kind === 'entry' && <EntryModal form={form} setForm={setForm} error={error} setError={setError} modal={modal} wallets={data.wallets} balances={balances} previous={data.entries.find((entry) => entry.id === modal.id)} hidden={balanceHidden} categoryOptions={categoryOptions} onClose={() => setModal(null)} onSave={saveEntry} />}
    {modal?.kind === 'wallet' && <WalletModal form={walletForm} setForm={setWalletForm} error={error} setError={setError} editing={Boolean(modal.id)} onClose={() => setModal(null)} onSave={saveWallet} />}
    {data.setupComplete && !data.introComplete && <IntroTour step={introStep} onStep={setIntroStep} onFinish={() => { editData((current) => ({ ...current, introComplete: true })); setIntroStep(0) }} />}
  </div>
}

function IntroTour({ step, onStep, onFinish }) {
  const pages = [
    { kicker: 'YOUR MONEY, ORGANIZED', title: 'Start with your wallets', body: 'Personal, Organization, Savings, and E-Wallet each keep their own balance. Set opening balances in Wallets, and Budsync will calculate totals from your records.', icon: '◫' },
    { kicker: 'RECORD AS YOU GO', title: 'Add income, expenses, and transfers', body: 'Record money in or out of a wallet. Transfers move the same amount between two wallets, so they do not change your combined balance.', icon: '↔' },
    { kicker: 'SEE YOUR PROGRESS', title: 'Use your dashboard and Insights', body: 'The dashboard summarizes balances and recent activity. In Insights, you can set category budgets and savings targets. Your records save locally; account sync is optional.', icon: '▥' },
  ]
  const current = pages[step]
  return <div className="intro-backdrop"><section className="intro-card" role="dialog" aria-modal="true" aria-labelledby="intro-title" aria-describedby="intro-description"><button className="intro-skip" type="button" onClick={onFinish} autoFocus>Skip intro</button><span className="intro-kicker">{current.kicker} <span>· {step + 1} OF {pages.length}</span></span><div className="intro-icon" aria-hidden="true">{current.icon}</div><h2 id="intro-title">{current.title}</h2><p id="intro-description">{current.body}</p><div className="intro-dots" aria-label={`Step ${step + 1} of ${pages.length}`}>{pages.map((page, index) => <span key={page.title} className={index === step ? 'active' : ''} />)}</div><div className="intro-actions">{step > 0 && <button className="secondary" type="button" onClick={() => onStep(step - 1)}>Back</button>}<button className="primary" type="button" onClick={() => step === pages.length - 1 ? onFinish() : onStep(step + 1)}>{step === pages.length - 1 ? 'Start using Budsync' : 'Next'}</button></div></section></div>
}

function PolicyLinks() {
  return <footer className="policy-links"><span>Budsync is a personal finance tracker. It does not connect to banks.</span><nav aria-label="Legal"><a href="/privacy.html">Privacy policy</a><a href="/terms.html">Terms of service</a></nav></footer>
}

function Metric({ label, value, detail, tone, icon }) {
  return <div className="metric"><span className={'metric-icon ' + tone}>{icon}</span><div><small>{label}</small><strong>{value}</strong><small>{detail}</small></div></div>
}

function CashFlowChart({ items, range, onRange, hidden }) {
  const [selected, setSelected] = useState(null)
  const highest = Math.max(0, ...items.flatMap((item) => [item.income, item.expenses]))
  const chosen = items.find((item) => item.key === selected) || items.at(-1)
  return <section className="chart-card" aria-labelledby="cash-flow-title"><div className="widget-head"><div><span className="widget-kicker">FINANCIAL PULSE</span><h2 id="cash-flow-title">Cash flow</h2><p>Income and expenses from recorded activity</p></div><div className="range-tabs" role="group" aria-label="Chart period">{[3, 6, 12].map((months) => <button type="button" key={months} className={range === months ? 'active' : ''} aria-pressed={range === months} onClick={() => { onRange(months); setSelected(null) }}>{months}M</button>)}</div></div>{highest > 0 ? <><div className="chart-plot" role="group" aria-label="Select a month to see its cash flow">{items.map((item) => <div className={'chart-month' + (chosen?.key === item.key ? ' selected' : '')} key={item.key}><div className="chart-pair"><button type="button" className="chart-bar income-bar" style={{ height: `${item.income / highest * 100}%` }} aria-label={hidden ? `${item.label} income amount hidden` : `${item.label} income ${php(item.income)}`} onClick={() => setSelected(item.key)} disabled={!item.income} /><button type="button" className="chart-bar expense-bar" style={{ height: `${item.expenses / highest * 100}%` }} aria-label={hidden ? `${item.label} expenses amount hidden` : `${item.label} expenses ${php(item.expenses)}`} onClick={() => setSelected(item.key)} disabled={!item.expenses} /></div><span>{item.label}</span></div>)}</div><div className="chart-detail" aria-live="polite"><strong>{chosen?.label}</strong><span><i className="legend-dot income-dot" /> Income {hidden ? '••••' : php(chosen?.income || 0)}</span><span><i className="legend-dot expense-dot" /> Expenses {hidden ? '••••' : php(chosen?.expenses || 0)}</span></div></> : <div className="chart-empty"><span>↗</span><strong>Your cash flow starts here</strong><p>Add income or expenses to see a monthly picture.</p></div>}</section>
}

function SpendingPanel({ report, budgets, hidden }) {
  const watchedBudgets = [...budgets].sort((a, b) => budgetUsage(report.categories, b).spent / b.limit - budgetUsage(report.categories, a).spent / a.limit).slice(0, 3)
  return <section className="spending-card" aria-labelledby="spending-title"><div className="widget-head"><div><span className="widget-kicker">THIS MONTH</span><h2 id="spending-title">Spending mix</h2><p>Where your expenses went</p></div></div>{report.categories.length ? <div className="spending-list">{report.categories.slice(0, 5).map(([name, amount]) => <div className="spending-item" key={name}><div><strong>{name}</strong><span>{hidden ? '••••' : php(amount)}</span></div><div className="spending-track" role="meter" aria-label={`${name} share of expenses`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(amount / report.expenses * 100)}><i style={{ width: `${amount / report.expenses * 100}%` }} /></div></div>)}</div> : <div className="spending-empty"><span>◎</span><strong>No spending yet</strong><p>Your categories will appear after your first expense this month.</p></div>}{watchedBudgets.length > 0 && <div className="dashboard-budget"><h3>Budget watch</h3><div className="dashboard-budget-list">{watchedBudgets.map((budget) => <BudgetProgress key={budget.id} budget={budget} report={report} hidden={hidden} />)}</div>{budgets.length > watchedBudgets.length && <small className="budget-more">Showing the {watchedBudgets.length} budgets closest to their limits.</small>}</div>}</section>
}

function BudgetProgress({ budget, report, hidden = false }) {
  const { spent, remaining, percent } = budgetUsage(report.categories, budget)
  return <div className="plan-progress"><div className="plan-progress-top"><strong>{budget.category}</strong><span>{hidden ? '••••' : `${php(spent)} of ${php(budget.limit)}`}</span></div><div className={'plan-track' + (remaining < 0 ? ' over-limit' : remaining <= budget.limit * .2 ? ' near-limit' : '')} role="meter" aria-label={`${budget.category} budget used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-valuetext={hidden ? 'Amount hidden' : `${php(spent)} spent of ${php(budget.limit)}`}><i style={{ width: `${percent}%` }} /></div><small>{hidden ? '₱ ••••••' : remaining < 0 ? `${php(Math.abs(remaining))} over budget` : `${php(remaining)} remaining`}</small></div>
}

function NavIcon({ name, size = 20 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  const paths = {
    overview: <><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M9 21v-7h6v7" /></>,
    transactions: <><path d="M4 6h16M4 12h16M4 18h16" /><path d="M7 4v4M17 10v4M10 16v4" /></>,
    wallets: <><rect x="3" y="6" width="18" height="15" rx="3" /><path d="M3 9V6a3 3 0 0 1 3-3h12" /><path d="M16 13h5v4h-5a2 2 0 0 1 0-4z" /></>,
    receipts: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    reports: <><path d="M4 20V12M10 20V5M16 20v-9M22 20V8" /><path d="M2 20h20" /></>,
    account: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon: <path d="M20 15.6A8 8 0 0 1 8.4 4 8 8 0 1 0 20 15.6z" />,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.5" /></>,
    eyeOff: <><path d="M3 3l18 18M10.7 6.1A12 12 0 0 1 12 6c6.5 0 10 6 10 6a15 15 0 0 1-3.1 3.6M6.3 7.3C3.5 9.1 2 12 2 12s3.5 6 10 6c1.2 0 2.3-.2 3.3-.5" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    income: <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>,
    expense: <><path d="M12 5v14" /><path d="m18 13-6 6-6-6" /></>,
    transfer: <><path d="M7 7h13l-3-3" /><path d="m20 7-3 3M17 17H4l3 3" /><path d="m4 17 3-3" /></>,
    adjustment: <><path d="M12 4v16M4 12h16" /><circle cx="12" cy="12" r="9" /></>,
    chevronRight: <path d="m9 18 6-6-6-6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  }
  return <svg {...common}>{paths[name]}</svg>
}

function SectionHeading({ title, subtitle, action, onAction }) {
  return <div className="section-head"><div><h2>{title}</h2><p>{subtitle}</p></div>{action && <button type="button" onClick={onAction}>{action} →</button>}</div>
}

function WalletCard({ wallet, balance, summary, detailed, hidden, recent, onShow, onTransfer, onEdit, onArchive }) {
  const activity = (summary?.income || 0) + (summary?.expenses || 0)
  return <div className={'wallet-card wallet-' + wallet.color}><div className="wallet-card-top"><span className={'wallet-icon ' + wallet.color}>{wallet.name[0]}</span><span className="wallet-type">{wallet.type}{wallet.archived ? ' · Archived' : ''}</span></div><h3>{wallet.name}</h3><span className="wallet-balance-label">Available balance</span><strong>{shownMoney(balance, hidden)}</strong>{recent && !detailed && <p className="wallet-recent">Recent: {entryName(recent)}</p>}{detailed && <><div className="opening"><span>Opening balance</span><b>{shownMoney(wallet.openingBalance, hidden)}</b></div><div className="wallet-flow"><span>This month · Income {shownMoney(summary?.income || 0, hidden)}</span><span>Expenses {shownMoney(summary?.expenses || 0, hidden)}</span>{activity > 0 && <div className="wallet-flow-track" aria-label={hidden ? 'Income and expense proportions' : `Income ${php(summary.income)}, expenses ${php(summary.expenses)}`}><i style={{ width: `${summary.income / activity * 100}%` }} /><i style={{ width: `${summary.expenses / activity * 100}%` }} /></div>}</div></>}<div className="wallet-actions">{onShow && <button type="button" onClick={onShow}>View activity <span aria-hidden="true">↗</span></button>}{onTransfer && !wallet.archived && <button type="button" onClick={onTransfer}>Transfer</button>}{detailed && <><button type="button" onClick={onEdit}>Edit</button><button type="button" onClick={onArchive}>{wallet.archived ? 'Restore' : 'Archive'}</button></>}</div></div>
}

function TransactionRow({ entry, walletName, onEdit, onDelete, onRestore, deleted = false, walletFilter = 'all', hidden = false }) {
  const sign = walletFilter === 'all' ? (entry.type === 'expense' || (entry.type === 'adjustment' && entry.adjustmentEffect === 'decrease') ? -1 : 1) : Math.sign(entryImpact({ ...entry, deletedAt: null }, walletFilter))
  const subtitle = entry.type === 'transfer' ? walletName(entry.fromWalletId) + ' → ' + walletName(entry.toWalletId) : walletName(entry.walletId)
  return <div className="transaction"><span className={'transaction-icon ' + (entry.type === 'income' ? 'green' : entry.type === 'expense' ? 'coral' : entry.type === 'transfer' ? 'blue' : 'purple')}>{entry.type === 'transfer' ? '⇄' : entry.type === 'adjustment' ? '±' : sign < 0 ? '↑' : '↓'}</span><div className="transaction-info"><strong>{entryName(entry)}</strong><span>{subtitle} · {dateLabel(entry.date)}</span>{entry.note && <small>{entry.note}</small>}{entry.updatedAt && <small className="edit-note">Edited {new Date(entry.updatedAt).toLocaleString('en-PH')} · {entry.editNote}</small>}{(entry.editHistory?.length || 0) > 1 && <small className="edit-note">{entry.editHistory.length} recorded edits</small>}</div><div className="transaction-amount"><strong className={entry.type === 'transfer' && walletFilter === 'all' ? '' : sign < 0 ? 'negative' : 'positive'}>{hidden ? '₱ ••••••' : `${entry.type === 'transfer' && walletFilter === 'all' ? '' : sign < 0 ? '−' : '+'}${php(entry.amount)}`}</strong><span>{entry.type === 'transfer' && walletFilter === 'all' ? 'Between wallets' : entry.type}</span></div><div className="row-actions">{deleted ? <button type="button" onClick={onRestore}>Restore</button> : <><button type="button" onClick={onEdit}>Edit</button><button type="button" onClick={onDelete}>Delete</button></>}</div></div>
}

function EmptyState({ filtered, onAdd }) {
  return <div className="empty"><span>☷</span><strong>{filtered ? 'No matching transactions' : 'No transactions yet'}</strong><p>{filtered ? 'Try another search, wallet, or date range.' : 'Your activity will appear here after your first entry.'}</p>{!filtered && <button type="button" onClick={onAdd}>Add your first transaction →</button>}</div>
}

function Reports({ report, month, onMonth, budgets, goals, wallets, balances, hidden, categoryOptions, onAddBudget, onRemoveBudget, onAddGoal, onRemoveGoal }) {
  return <>
    <div className="page-head"><div><div className="eyebrow">YOUR MONEY IN MOTION</div><h1>Insights</h1><p>Understand spending and track the plans you set.</p></div><label className="report-month">Month<input type="month" value={month} onChange={(event) => onMonth(event.target.value || localDate().slice(0, 7))} /></label></div>
    <div className="report-summary"><Metric label="Income" value={shownMoney(report.income, hidden)} detail="Transfers excluded" tone="green" icon="↓" /><Metric label="Expenses" value={shownMoney(report.expenses, hidden)} detail="Transfers excluded" tone="coral" icon="↑" /><Metric label="Net activity" value={shownMoney(report.net, hidden)} detail="Income less expenses" tone="blue" icon="±" /></div>
    <p className="report-note">Transfers and balance adjustments are excluded from income, expenses, and net activity.</p>
    <div className="report-grid"><section className="data-card"><h2>Expenses by category</h2>{report.categories.length ? report.categories.map(([name, amount]) => <div className="report-row" key={name}><span>{name}</span><strong>{shownMoney(amount, hidden)}</strong><div className="report-track"><i style={{ width: (amount / report.expenses * 100) + '%' }} /></div></div>) : <p>No expenses recorded for this month.</p>}</section><section className="data-card"><h2>By wallet</h2>{report.byWallet.map((item) => <div className="report-wallet-row" key={item.id}><strong>{item.name}</strong><span>Income {shownMoney(item.income, hidden)} · Expenses {shownMoney(item.expenses, hidden)}</span></div>)}</section></div>
    <PlanningPanel report={report} budgets={budgets} goals={goals} wallets={wallets} balances={balances} hidden={hidden} categoryOptions={categoryOptions} onAddBudget={onAddBudget} onRemoveBudget={onRemoveBudget} onAddGoal={onAddGoal} onRemoveGoal={onRemoveGoal} />
  </>
}

function PlanningPanel({ report, budgets, goals, wallets, balances, hidden, categoryOptions, onAddBudget, onRemoveBudget, onAddGoal, onRemoveGoal }) {
  const [budgetForm, setBudgetForm] = useState({ category: '', limit: '' })
  const [goalForm, setGoalForm] = useState({ name: '', target: '', walletId: wallets[0]?.id || '' })
  const [budgetError, setBudgetError] = useState('')
  const [goalError, setGoalError] = useState('')
  const submitBudget = (event) => {
    event.preventDefault()
    const category = categoryOptions.expense.find((option) => option.toLowerCase() === budgetForm.category.trim().toLowerCase()) || budgetForm.category.trim()
    if (budgets.length >= 100) return setBudgetError('You can save up to 100 budgets.')
    if (!category || category.length > 60 || !validAmount(budgetForm.limit)) return setBudgetError('Enter a category and a positive PHP limit.')
    if (budgets.some((item) => item.category.toLowerCase() === category.toLowerCase())) return setBudgetError('A budget for this category already exists.')
    onAddBudget(category, Number(budgetForm.limit))
    setBudgetForm({ category: '', limit: '' })
    setBudgetError('')
  }
  const submitGoal = (event) => {
    event.preventDefault()
    const name = goalForm.name.trim()
    if (goals.length >= 100) return setGoalError('You can save up to 100 savings targets.')
    if (!name || name.length > 60 || !validAmount(goalForm.target) || !wallets.some((wallet) => wallet.id === goalForm.walletId)) return setGoalError('Enter a name, a positive target, and a wallet.')
    onAddGoal(name, Number(goalForm.target), goalForm.walletId)
    setGoalForm({ name: '', target: '', walletId: wallets[0]?.id || '' })
    setGoalError('')
  }
  return <><SectionHeading title="Plans & goals" subtitle="Targets are based on your recorded activity and wallet balances." /><div className="planning-grid"><section className="data-card plan-card" aria-labelledby="budgets-title"><div className="widget-head"><div><span className="widget-kicker">SPENDING GUARDRAILS</span><h2 id="budgets-title">Monthly budgets</h2><p>Set a limit for any expense category.</p></div></div>{budgets.length ? <div className="plan-list">{budgets.map((budget) => <div className="plan-item" key={budget.id}><BudgetProgress budget={budget} report={report} hidden={hidden} /><button type="button" onClick={() => onRemoveBudget(budget.id)} aria-label={`Remove ${budget.category} budget`}>Remove</button></div>)}</div> : <p className="plan-empty">No budgets yet. Add one to see your monthly progress.</p>}<form className="plan-form" onSubmit={submitBudget}><label>Category<input required list="budget-categories" maxLength="60" placeholder="e.g. Food" value={budgetForm.category} onChange={(event) => setBudgetForm({ ...budgetForm, category: event.target.value })} /><datalist id="budget-categories">{categoryOptions.expense.map((category) => <option key={category} value={category} />)}</datalist><small>Suggestions include built-in and previously used expense categories.</small></label><label>Monthly limit (PHP)<input required type="number" min="0.01" step="0.01" placeholder="0.00" value={budgetForm.limit} onChange={(event) => setBudgetForm({ ...budgetForm, limit: event.target.value })} /></label>{budgetError && <p className="form-error" role="alert">{budgetError}</p>}<button className="secondary" type="submit">Add budget</button></form></section><section className="data-card plan-card" aria-labelledby="goals-title"><div className="widget-head"><div><span className="widget-kicker">LOOKING AHEAD</span><h2 id="goals-title">Savings targets</h2><p>Follow a wallet balance toward a goal.</p></div></div>{goals.length ? <div className="plan-list">{goals.map((goal) => { const wallet = wallets.find((item) => item.id === goal.walletId); const progress = Math.max(0, balances[goal.walletId] || 0); const percent = Math.min(100, progress / goal.target * 100); return <div className="plan-item" key={goal.id}><div className="plan-progress"><div className="plan-progress-top"><strong>{goal.name}</strong><span>{shownMoney(progress, hidden)} of {shownMoney(goal.target, hidden)}</span></div><div className="plan-track goal-track" role="meter" aria-label={`${goal.name} target progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-valuetext={hidden ? 'Amount hidden' : `${php(progress)} of ${php(goal.target)}`}><i style={{ width: `${percent}%` }} /></div><small>{wallet?.name || 'Wallet'} · {Math.round(percent)}% of target</small></div><button type="button" onClick={() => onRemoveGoal(goal.id)} aria-label={`Remove ${goal.name} target`}>Remove</button></div> })}</div> : <p className="plan-empty">No savings targets yet. Choose a wallet and a target amount.</p>}<form className="plan-form" onSubmit={submitGoal}><label>Goal name<input required maxLength="60" placeholder="e.g. Emergency fund" value={goalForm.name} onChange={(event) => setGoalForm({ ...goalForm, name: event.target.value })} /></label><label>Target amount (PHP)<input required type="number" min="0.01" step="0.01" placeholder="0.00" value={goalForm.target} onChange={(event) => setGoalForm({ ...goalForm, target: event.target.value })} /></label><label>Wallet<select value={goalForm.walletId} onChange={(event) => setGoalForm({ ...goalForm, walletId: event.target.value })}>{wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select></label>{goalError && <p className="form-error" role="alert">{goalError}</p>}<button className="secondary" type="submit">Add target</button></form><p className="plan-explain">Targets track existing balances; no money is moved.</p></section></div></>
}

function EntryModal({ form, setForm, error, setError, modal, wallets, balances, previous, hidden, categoryOptions, onClose, onSave }) {
  const selectedIds = [form.walletId, form.fromWalletId, form.toWalletId]
  const preview = previewEntryBalances(wallets, balances, form, previous)
  const update = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      walletId: field === 'type' && !current.walletId ? wallets.find((wallet) => !wallet.archived)?.id || '' : current.walletId,
    }))
    setError('')
  }
  const options = wallets.map((wallet) => <option key={wallet.id} value={wallet.id} disabled={wallet.archived && !selectedIds.includes(wallet.id)}>{wallet.name}{wallet.archived ? ' (archived)' : ''}</option>)
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><div className="eyebrow">{modal.id ? 'UPDATE RECORD' : 'NEW RECORD'}</div><h2 id="modal-title">{modal.id ? 'Edit transaction' : 'Add transaction'}</h2><p>Keep your wallet activity up to date.</p></div><button type="button" onClick={onClose} aria-label="Close">×</button></div><form onSubmit={onSave}><div className="type-tabs" role="group" aria-label="Transaction type">{['income', 'expense', 'transfer', 'adjustment'].map((type) => <button type="button" key={type} className={form.type === type ? 'selected' : ''} onClick={() => update('type', type)}>{type === 'adjustment' ? 'Adjust' : type[0].toUpperCase() + type.slice(1)}</button>)}</div><div className="form-fields"><div className="field-pair"><label>Amount<span className="amount-wrap"><b>₱</b><input required type="number" min="0.01" step="0.01" value={form.amount} placeholder="0.00" onChange={(event) => update('amount', event.target.value)} /></span></label><label>Date<input required type="date" value={form.date} onChange={(event) => update('date', event.target.value)} /></label></div>{form.type === 'transfer' ? <div className="field-pair"><label>From wallet<select value={form.fromWalletId} onChange={(event) => update('fromWalletId', event.target.value)}>{options}</select></label><label>To wallet<select value={form.toWalletId} onChange={(event) => update('toWalletId', event.target.value)}>{options}</select></label></div> : <label>Wallet<select value={form.walletId} onChange={(event) => update('walletId', event.target.value)}>{options}</select></label>}{form.type === 'adjustment' && <label>Effect<select value={form.adjustmentEffect} onChange={(event) => update('adjustmentEffect', event.target.value)}><option value="increase">Increase balance</option><option value="decrease">Decrease balance</option></select></label>}{['income', 'expense'].includes(form.type) && <label>Category <em>Choose from suggestions or type a new category</em><input list="category-options" maxLength="60" value={form.category} placeholder={form.type === 'income' ? 'e.g. Salary' : 'e.g. Food'} onChange={(event) => update('category', event.target.value)} /><datalist id="category-options">{categoryOptions[form.type].map((category) => <option key={category} value={category} />)}</datalist></label>}<label>{form.type === 'adjustment' ? 'Reason note' : 'Note'} {form.type !== 'adjustment' && <em>Optional</em>}<textarea rows="2" maxLength="300" required={form.type === 'adjustment'} value={form.note} placeholder={form.type === 'adjustment' ? 'Explain this balance correction' : 'Add a little context'} onChange={(event) => update('note', event.target.value)} /></label>{modal.id && <label>Reason for edit<textarea rows="2" maxLength="300" required value={form.editNote} placeholder="What changed and why?" onChange={(event) => update('editNote', event.target.value)} /></label>}{preview && <div className="entry-preview"><strong>Balance after saving</strong>{preview.changes.map((wallet) => <div key={wallet.id}><span>{wallet.name}</span><span>{shownMoney(wallet.before, hidden)} → {shownMoney(wallet.after, hidden)}</span></div>)}<small>{preview.combinedDelta === 0 ? 'Combined balance unchanged' : 'Combined balance change: ' + shownMoney(preview.combinedDelta, hidden)}</small></div>}{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit">{modal.id ? 'Save changes' : 'Save transaction'}</button></div></form></div></div>
}

function WalletModal({ form, setForm, error, setError, editing, onClose, onSave }) {
  const update = (field, value) => { setForm((current) => ({ ...current, [field]: value })); setError('') }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title"><div className="modal-head"><div><div className="eyebrow">{editing ? 'UPDATE WALLET' : 'NEW WALLET'}</div><h2 id="wallet-modal-title">{editing ? 'Edit wallet' : 'Add wallet'}</h2><p>Balances are calculated from opening balance and entries.</p></div><button type="button" onClick={onClose} aria-label="Close">×</button></div><form onSubmit={onSave}><div className="form-fields"><label>Wallet name<input required maxLength="60" value={form.name} placeholder="e.g. Travel fund" onChange={(event) => update('name', event.target.value)} /></label><label>Opening balance<span className="amount-wrap"><b>₱</b><input required type="number" min="0" step="0.01" value={form.openingBalance} onChange={(event) => update('openingBalance', event.target.value)} /></span></label>{editing && <label>Reason for change<textarea required rows="2" maxLength="300" value={form.editNote} placeholder="What changed and why?" onChange={(event) => update('editNote', event.target.value)} /></label>}{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit">{editing ? 'Save wallet' : 'Create wallet'}</button></div></form></div></div>
}

export default App
