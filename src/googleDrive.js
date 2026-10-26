const api = 'https://www.googleapis.com/drive/v3/files'
const uploadApi = 'https://www.googleapis.com/upload/drive/v3/files'
const folderMime = 'application/vnd.google-apps.folder'
const scope = 'https://www.googleapis.com/auth/drive.file'

export const googleClientId = import.meta.env?.VITE_GOOGLE_CLIENT_ID?.trim() || ''
let identityScriptPromise

export function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (identityScriptPromise) return identityScriptPromise
  identityScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => window.google?.accounts?.oauth2
      ? resolve()
      : reject(new Error('Google sign-in did not finish loading. Refresh Budsync and try again.'))
    script.onerror = () => reject(new Error('Google sign-in could not load. Check your connection.'))
    document.head.append(script)
  }).catch((error) => {
    identityScriptPromise = undefined
    throw error
  })
  return identityScriptPromise
}

export async function connectGoogleDrive() {
  if (!googleClientId) return Promise.reject(new Error('Add VITE_GOOGLE_CLIENT_ID to .env.local and restart Vite.'))
  await loadGoogleIdentity()
  if (!window.google?.accounts?.oauth2) return Promise.reject(new Error('Google sign-in is still loading. Try again.'))
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: googleClientId, scope,
      callback: (result) => result.error ? reject(new Error(result.error_description || result.error)) : resolve({
        token: result.access_token, expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000,
      }),
      error_callback: (result) => reject(new Error(result.message || 'Google authorization was cancelled.')),
    })
    client.requestAccessToken()
  })
}

async function request(token, url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail.error?.message || `Google Drive request failed (${response.status}).`)
  }
  return response.status === 204 ? null : response
}

const escapeQuery = (value) => String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")

export async function listChildren(token, parentId) {
  const files = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ q: `'${escapeQuery(parentId)}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,appProperties)', pageSize: '1000' })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await request(token, `${api}?${params}`)
    const page = await response.json()
    files.push(...(page.files || []))
    pageToken = page.nextPageToken || ''
  } while (pageToken)
  return files
}

export async function findRoot(token, owner) {
  const params = new URLSearchParams({ q: `name = 'Budsync' and mimeType = '${folderMime}' and appProperties has { key='budsyncOwner' and value='${escapeQuery(owner)}' } and trashed = false`,
    fields: 'nextPageToken,files(id,name,mimeType,appProperties)', pageSize: '100' })
  const response = await request(token, `${api}?${params}`)
  return (await response.json()).files?.[0] || null
}

export async function createFolder(token, name, parentId, properties) {
  const response = await request(token, api, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: folderMime, ...(parentId ? { parents: [parentId] } : {}), appProperties: properties }) })
  return response.json()
}

export async function updateFolder(token, file, name, parentId, previousParentId) {
  const params = new URLSearchParams()
  if (previousParentId && previousParentId !== parentId) {
    params.set('addParents', parentId)
    params.set('removeParents', previousParentId)
  }
  const response = await request(token, `${api}/${file.id}${params.size ? `?${params}` : ''}`, { method: 'PATCH',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
  return response.json()
}

export async function uploadFile(token, existingId, parentId, name, content, mimeType, properties) {
  const boundary = `budsync_${crypto.randomUUID()}`
  const metadata = { name, mimeType, appProperties: properties, ...(!existingId ? { parents: [parentId] } : {}) }
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    content, `\r\n--${boundary}--`], { type: `multipart/related; boundary=${boundary}` })
  const url = existingId ? `${uploadApi}/${existingId}?uploadType=multipart` : `${uploadApi}?uploadType=multipart`
  const response = await request(token, url, { method: existingId ? 'PATCH' : 'POST', headers: { 'Content-Type': body.type }, body })
  return response.json()
}

export async function downloadFile(token, id) {
  const response = await request(token, `${api}/${id}?alt=media`)
  return response.blob()
}

export async function trashFile(token, id) {
  await request(token, `${api}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
}
