/**
 * Firebase Admin SDK — server-side only
 * Used for privileged operations like deleting Auth users
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON env var (JSON string of service account)
 * OR individual FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY vars
 */
import { initializeApp as initAdminApp, getApps, cert } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

let adminApp = null;

function getAdminApp() {
  if (adminApp) return adminApp;

  // Try JSON service account first
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson);
      adminApp = initAdminApp({ credential: cert(serviceAccount) }, 'admin-sdk');
      return adminApp;
    } catch (e) {
      console.error('[firebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', e.message);
    }
  }

  // Try individual env vars
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    adminApp = initAdminApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    }, 'admin-sdk');
    return adminApp;
  }

  console.warn('[firebaseAdmin] No service account credentials found — Auth deletion will be skipped.');
  return null;
}

/**
 * Delete a user from Firebase Authentication by UID.
 * Returns true if deleted, false if skipped/failed.
 */
export async function deleteAuthUser(uid) {
  try {
    const app = getAdminApp();
    if (!app) return false;
    const auth = getAdminAuth(app);
    await auth.deleteUser(uid);
    console.log(`[firebaseAdmin] Deleted Auth user: ${uid}`);
    return true;
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      // Already deleted or never existed in Auth — not an error
      return true;
    }
    console.error('[firebaseAdmin] deleteAuthUser failed:', err.message);
    return false;
  }
}
