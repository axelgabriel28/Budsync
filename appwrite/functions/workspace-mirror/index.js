import { createHash, createVerify } from 'node:crypto'

const endpoint = process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1'
const databaseId = 'budsync'
const tableId = 'workspaces'
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID
let certificateCache
let certificateExpiresAt = 0

function response(res, status, body) {
  return res.json(body, status)
}

function getHeader(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : ''
}

async function firebaseCertificates() {
  if (certificateCache && Date.now() < certificateExpiresAt) return certificateCache
  const result = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com')
  if (!result.ok) throw new Error('Firebase token verification is temporarily unavailable.')
  const cacheControl = result.headers.get('cache-control') || ''
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 300)
  certificateCache = await result.json()
  certificateExpiresAt = Date.now() + maxAge * 1000
  return certificateCache
}

async function verifyFirebaseToken(token) {
  if (!firebaseProjectId || !token) throw new Error('Firebase sign-in is required.')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Firebase sign-in expired. Sign in again.')
  let header
  let claims
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  } catch {
    throw new Error('Firebase sign-in expired. Sign in again.')
  }
  const now = Math.floor(Date.now() / 1000)
  if (header.alg !== 'RS256' || !header.kid || claims.aud !== firebaseProjectId
    || claims.iss !== `https://securetoken.google.com/${firebaseProjectId}`
    || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128
    || claims.exp <= now || claims.iat > now + 60) {
    throw new Error('Firebase sign-in expired. Sign in again.')
  }
  const cert = (await firebaseCertificates())[header.kid]
  if (!cert) throw new Error('Firebase sign-in expired. Sign in again.')
  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${parts[0]}.${parts[1]}`)
  verifier.end()
  if (!verifier.verify(cert, Buffer.from(parts[2], 'base64url'))) {
    throw new Error('Firebase sign-in expired. Sign in again.')
  }
  return claims.sub
}

function ownerId(firebaseUserId) {
  return createHash('sha256').update(firebaseUserId).digest('hex').slice(0, 21)
}

function rowId(owner, revision, chunkIndex) {
  return `u${owner}-${revision.toString(36).padStart(8, '0')}-${chunkIndex.toString(36).padStart(3, '0')}`
}

function headId(owner) {
  return `u${owner}-head`
}

function splitPayload(payload) {
  const chunks = []
  let chunk = ''
  let bytes = 0
  for (const character of payload) {
    const size = Buffer.byteLength(character)
    if (bytes + size > 48_000 && chunk) {
      chunks.push(chunk)
      chunk = ''
      bytes = 0
    }
    chunk += character
    bytes += size
  }
  if (chunk || !chunks.length) chunks.push(chunk)
  return chunks
}

async function appwriteRequest(path, key, method = 'GET', body) {
  const project = process.env.APPWRITE_FUNCTION_PROJECT_ID
  if (!key || !project) throw new Error('Appwrite function is missing its database credentials.')
  const result = await fetch(`${endpoint}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': project,
      'X-Appwrite-Key': key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await result.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!result.ok) {
    if (result.status === 404) return null
    const detail = typeof data?.message === 'string' ? data.message : 'No error detail returned.'
    throw new Error(`Appwrite database request failed (${result.status}): ${detail}`)
  }
  return data
}

const rowsPath = `/tablesdb/${databaseId}/tables/${tableId}/rows`

async function readWorkspace(owner, key) {
  const head = await appwriteRequest(`${rowsPath}/${headId(owner)}`, key)
  if (!head) return null
  const { revision, chunkCount } = head.data
  if (!Number.isInteger(revision) || !Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 500) {
    throw new Error('The Appwrite workspace copy could not be read.')
  }
  const parts = await Promise.all(Array.from({ length: chunkCount }, (_, chunkIndex) =>
    appwriteRequest(`${rowsPath}/${rowId(owner, revision, chunkIndex)}`, key)))
  if (parts.some((part) => !part || part.data.revision !== revision || part.data.chunkIndex < 0)) {
    throw new Error('The Appwrite workspace copy is incomplete.')
  }
  return { revision, data: JSON.parse(parts.map((part) => part.data.payload).join('')) }
}

async function writeWorkspace(owner, revision, data, key) {
  const head = await appwriteRequest(`${rowsPath}/${headId(owner)}`, key)
  if (head && revision <= head.data.revision) return { applied: false, revision: head.data.revision }
  const chunks = splitPayload(JSON.stringify(data))
  if (chunks.length > 500) throw new Error('This workspace is too large for the Appwrite mirror.')

  for (let start = 0; start < chunks.length; start += 100) {
    const rows = chunks.slice(start, start + 100).map((payload, offset) => {
      const chunkIndex = start + offset
      return {
        rowId: rowId(owner, revision, chunkIndex),
        data: { owner, revision, chunkIndex, chunkCount: chunks.length, payload },
        permissions: [],
      }
    })
    for (const row of rows) await appwriteRequest(rowsPath, key, 'POST', row)
  }

  const headData = { owner, revision, chunkIndex: -1, chunkCount: chunks.length, payload: '' }
  if (head) {
    await appwriteRequest(`${rowsPath}/${headId(owner)}`, key, 'PATCH', { data: headData })
  } else {
    await appwriteRequest(rowsPath, key, 'POST', {
      rowId: headId(owner), data: headData, permissions: [],
    })
  }

  if (head) {
    const queries = [
      JSON.stringify({ method: 'equal', attribute: 'owner', values: [owner] }),
      JSON.stringify({ method: 'notEqual', attribute: 'revision', values: [revision] }),
    ]
    const search = new URLSearchParams()
    for (const query of queries) search.append('queries[]', query)
    await appwriteRequest(`${rowsPath}?${search}`, key, 'DELETE')
  }
  return { applied: true, revision }
}

export default async ({ req, res }) => {
  if (!firebaseProjectId) return response(res, 503, { error: 'Firebase project is not configured.' })
  try {
    const appwriteKey = process.env.APPWRITE_FUNCTION_API_KEY || getHeader(req.headers, 'x-appwrite-key')
    const token = getHeader(req.headers, 'x-firebase-id-token')
    const owner = ownerId(await verifyFirebaseToken(token))
    if (req.method === 'GET') return response(res, 200, await readWorkspace(owner, appwriteKey))
    if (req.method !== 'POST') return response(res, 405, { error: 'Method not allowed.' })
    const body = req.bodyJson || JSON.parse(req.bodyText || '{}')
    if (!Number.isInteger(body.revision) || body.revision < 1 || !body.data || typeof body.data !== 'object') {
      return response(res, 400, { error: 'Invalid workspace snapshot.' })
    }
    return response(res, 200, await writeWorkspace(owner, body.revision, body.data, appwriteKey))
  } catch (cause) {
    const message = cause.message || 'Appwrite mirror request failed.'
    if (message.startsWith('Firebase sign-in')) return response(res, 401, { error: message })
    return response(res, 500, { error: message })
  }
}
