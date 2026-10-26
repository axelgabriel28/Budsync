export const storageKey = 'budsync-v1'

export const starterWallets = [
  { id: 'personal', name: 'Personal', type: 'Everyday', openingBalance: 1000, currency: 'PHP', color: 'blue', archived: false },
  { id: 'organization', name: 'Organization', type: 'Shared funds', openingBalance: 500, currency: 'PHP', color: 'purple', archived: false },
  { id: 'savings', name: 'Savings', type: 'Set aside', openingBalance: 300, currency: 'PHP', color: 'teal', archived: false },
  { id: 'ewallet', name: 'E-Wallet', type: 'Digital wallet', openingBalance: 0, currency: 'PHP', color: 'orange', archived: false },
]

export const blankData = () => ({
  version: 2, wallets: starterWallets.map((wallet) => ({ ...wallet, openingBalance: 0 })),
  entries: [], budgets: [], goals: [], sampleBalances: false, setupComplete: false, introComplete: false, receiptSyncCutoff: null,
})

const validMoney = (amount, allowZero = false) => Number.isFinite(amount)
  && (allowZero ? amount >= 0 : amount > 0)
  && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6

const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateData(input) {
  if (!input || ![1, 2].includes(input.version) || !Array.isArray(input.wallets) || !Array.isArray(input.entries)) {
    throw new Error('This is not a supported Budsync backup.')
  }
  if (input.wallets.length === 0 || input.wallets.length > 100 || input.entries.length > 50000) {
    throw new Error('The backup has an unsupported number of wallets or entries.')
  }
  const walletIds = new Set()
  const wallets = input.wallets.map((wallet) => {
    if (!wallet || typeof wallet.id !== 'string' || !wallet.id || walletIds.has(wallet.id)
      || typeof wallet.name !== 'string' || !wallet.name.trim() || wallet.name.length > 60
      || !validMoney(wallet.openingBalance, true) || wallet.currency !== 'PHP') {
      throw new Error('The backup contains an invalid wallet.')
    }
    walletIds.add(wallet.id)
    return {
      id: wallet.id,
      name: wallet.name.trim(),
      type: typeof wallet.type === 'string' ? wallet.type.slice(0, 60) : 'Custom',
      openingBalance: wallet.openingBalance,
      currency: 'PHP',
      color: ['blue', 'purple', 'teal', 'orange'].includes(wallet.color) ? wallet.color : 'blue',
      archived: Boolean(wallet.archived),
      updatedAt: typeof wallet.updatedAt === 'string' ? wallet.updatedAt : null,
      editNote: typeof wallet.editNote === 'string' ? wallet.editNote.slice(0, 300) : '',
    }
  })
  if (wallets.every((wallet) => wallet.archived)) throw new Error('At least one wallet must remain active.')
  const entryIds = new Set()
  const entries = input.entries.map((entry) => {
    if (!entry || typeof entry.id !== 'string' || !entry.id || entryIds.has(entry.id)
      || !['income', 'expense', 'adjustment', 'transfer'].includes(entry.type)
      || !validMoney(entry.amount) || !validDate(entry.date)) {
      throw new Error('The backup contains an invalid transaction.')
    }
    entryIds.add(entry.id)
    if (entry.type === 'transfer') {
      if (!walletIds.has(entry.fromWalletId) || !walletIds.has(entry.toWalletId) || entry.fromWalletId === entry.toWalletId) {
        throw new Error('The backup contains an invalid transfer.')
      }
    } else if (!walletIds.has(entry.walletId)) {
      throw new Error('The backup contains a transaction with an unknown wallet.')
    }
    if (entry.type === 'adjustment' && !['increase', 'decrease'].includes(entry.adjustmentEffect)) {
      throw new Error('The backup contains an invalid balance adjustment.')
    }
    return {
      id: entry.id,
      type: entry.type,
      walletId: entry.type === 'transfer' ? null : entry.walletId,
      fromWalletId: entry.type === 'transfer' ? entry.fromWalletId : null,
      toWalletId: entry.type === 'transfer' ? entry.toWalletId : null,
      adjustmentEffect: entry.type === 'adjustment' ? entry.adjustmentEffect : null,
      amount: entry.amount,
      date: entry.date,
      category: typeof entry.category === 'string' ? entry.category.slice(0, 60) : '',
      note: typeof entry.note === 'string' ? entry.note.slice(0, 300) : '',
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
      editNote: typeof entry.editNote === 'string' ? entry.editNote.slice(0, 300) : '',
      deletedAt: typeof entry.deletedAt === 'string' ? entry.deletedAt : null,
      editHistory: Array.isArray(entry.editHistory) ? entry.editHistory.filter((item) => item && typeof item.at === 'string' && typeof item.note === 'string').map((item) => ({ at: item.at, note: item.note.slice(0, 300) })) : [],
      receiptId: typeof entry.receiptId === 'string' ? entry.receiptId.slice(0, 100) : null,
      receiptFolderId: typeof entry.receiptFolderId === 'string' ? entry.receiptFolderId.slice(0, 100) : null,
    }
  })
  if (!Array.isArray(input.budgets ?? []) || !Array.isArray(input.goals ?? [])
    || (input.budgets?.length || 0) > 100 || (input.goals?.length || 0) > 100) {
    throw new Error('The backup has invalid budgets or savings goals.')
  }
  if (input.receiptSyncCutoff != null && (typeof input.receiptSyncCutoff !== 'string' || Number.isNaN(Date.parse(input.receiptSyncCutoff)))) {
    throw new Error('The backup has an invalid receipt sync date.')
  }
  const budgetIds = new Set()
  const budgetCategories = new Set()
  const budgets = (input.budgets || []).map((budget) => {
    if (!budget || typeof budget.id !== 'string' || !budget.id || budgetIds.has(budget.id)
      || typeof budget.category !== 'string' || !budget.category.trim() || budget.category.length > 60
      || budgetCategories.has(budget.category.trim().toLowerCase()) || !validMoney(budget.limit)) {
      throw new Error('The backup contains an invalid budget.')
    }
    budgetIds.add(budget.id)
    budgetCategories.add(budget.category.trim().toLowerCase())
    return { id: budget.id, category: budget.category.trim(), limit: budget.limit }
  })
  const goalIds = new Set()
  const goals = (input.goals || []).map((goal) => {
    if (!goal || typeof goal.id !== 'string' || !goal.id || goalIds.has(goal.id)
      || typeof goal.name !== 'string' || !goal.name.trim() || goal.name.length > 60
      || !validMoney(goal.target) || !walletIds.has(goal.walletId)) {
      throw new Error('The backup contains an invalid savings goal.')
    }
    goalIds.add(goal.id)
    return { id: goal.id, name: goal.name.trim(), target: goal.target, walletId: goal.walletId }
  })
  if (budgets.length > 100 || goals.length > 100) throw new Error('The backup has too many budgets or savings goals.')
  return { version: 2, wallets, entries, budgets, goals,
    sampleBalances: Boolean(input.sampleBalances), setupComplete: input.setupComplete !== false,
    introComplete: input.introComplete !== false,
    receiptSyncCutoff: typeof input.receiptSyncCutoff === 'string' ? input.receiptSyncCutoff : null }
}

export function parseBackup(text) {
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error('Choose a valid JSON backup file.') }
  if (parsed?.format !== 'budsync-backup' || parsed?.version !== 2) throw new Error('Choose a Budsync V2 backup file.')
  return validateData(parsed)
}

export function backupJson(data) {
  return JSON.stringify({ format: 'budsync-backup', ...data, exportedAt: new Date().toISOString() }, null, 2)
}

function csvCell(value) {
  const text = String(value ?? '')
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

export function transactionsCsv(data) {
  const names = Object.fromEntries(data.wallets.map((wallet) => [wallet.id, wallet.name]))
  const columns = ['Date', 'Type', 'Wallet', 'From wallet', 'To wallet', 'Amount PHP', 'Effect', 'Category', 'Note', 'Edit note', 'Updated at']
  const rows = data.entries.filter((entry) => !entry.deletedAt).map((entry) => [
    entry.date, entry.type, names[entry.walletId] || '', names[entry.fromWalletId] || '',
    names[entry.toWalletId] || '', entry.amount.toFixed(2), entry.adjustmentEffect || '',
    entry.category || '', entry.note || '', entry.editNote || '', entry.updatedAt || '',
  ])
  return '\ufeff' + [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}
