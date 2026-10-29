const endpoint = (import.meta.env.VITE_APPWRITE_ENDPOINT || '').replace(/\/$/, '')
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID
const functionId = import.meta.env.VITE_APPWRITE_FUNCTION_ID

export const appwriteMirrorReady = Boolean(endpoint && projectId && functionId)

async function execute(method, token, body) {
  if (!appwriteMirrorReady) return null
  const response = await fetch(`${endpoint}/functions/${encodeURIComponent(functionId)}/executions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': projectId,
    },
    body: JSON.stringify({
      body: body === undefined ? '' : JSON.stringify(body),
      async: false,
      path: '/',
      method,
      headers: { 'X-Firebase-ID-Token': token, 'Content-Type': 'application/json' },
    }),
  })
  const execution = await response.json().catch(() => null)
  if (!response.ok) throw new Error(execution?.message || 'Appwrite mirror request failed.')
  const status = Number(execution?.responseStatusCode || 0)
  let result
  try { result = execution?.responseBody ? JSON.parse(execution.responseBody) : null } catch { result = null }
  if (status < 200 || status >= 300) throw new Error(result?.error || 'Appwrite mirror request failed.')
  return result
}

export async function saveAppwriteMirror(revision, data, token) {
  return execute('POST', token, { revision, data })
}
