import { initializeApp } from 'firebase/app'
import { GoogleAuthProvider, getAuth, getRedirectResult, signInWithPopup, signInWithRedirect, signOut as firebaseSignOut } from 'firebase/auth'
import { getDatabase, get, ref, runTransaction } from 'firebase/database'
import { decodeSnapshot, encodeSnapshot, nextSnapshot } from './cloudSnapshot.js'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const cloudReady = Object.values(config).every(Boolean)
const app = cloudReady ? initializeApp(config) : null
const auth = app ? getAuth(app) : null
const database = app ? getDatabase(app) : null

const account = (user) => user ? { user: { id: user.uid, email: user.email } } : null
const googleProvider = new GoogleAuthProvider()

async function currentUser() {
  if (!cloudReady) throw new Error('Firebase is not configured.')
  await auth.authStateReady()
  if (!auth.currentUser) throw new Error('Sign in again to continue syncing.')
  return auth.currentUser
}

const snapshotRef = (user) => ref(database, `workspaces/${user.uid}`)

export async function readSession() {
  if (!cloudReady) return null
  await auth.authStateReady()
  const redirectResult = await getRedirectResult(auth)
  return account(redirectResult?.user || auth.currentUser)
}

export async function signInWithGoogle() {
  if (!cloudReady) throw new Error('Firebase is not configured.')
  try {
    const result = await signInWithPopup(auth, googleProvider)
    return account(result.user)
  } catch (cause) {
    if (cause.code !== 'auth/popup-blocked') throw cause
    await signInWithRedirect(auth, googleProvider)
    return null
  }
}

export async function signOut() {
  if (auth) await firebaseSignOut(auth)
}

export async function firebaseIdToken() {
  return (await currentUser()).getIdToken()
}

export async function fetchSnapshot() {
  const saved = await get(snapshotRef(await currentUser()))
  return saved.exists() ? decodeSnapshot(saved.val()) : null
}

export async function applySnapshot(revision, data) {
  const user = await currentUser()
  const payload = encodeSnapshot(data)
  const result = await runTransaction(snapshotRef(user), (current) => nextSnapshot(current, revision, payload), { applyLocally: false })
  const decoded = decodeSnapshot(result.snapshot.val())
  if (result.committed) {
    if (!decoded) throw new Error('Firebase confirmed the save but returned no snapshot. Check for updates before editing again.')
    return { applied: true, ...decoded }
  }
  const latest = decoded || await fetchSnapshot()
  return { applied: false, ...(latest || { revision: 0, data: null }) }
}
