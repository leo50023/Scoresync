/**
 * Firebase Admin SDK — server-side only, fully dynamic to avoid crash if not installed
 */

export async function deleteAuthUser(uid) {
  try {
    // Dynamic import — won't crash if firebase-admin not installed
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');

    // Get or create admin app
    let adminApp = getApps().find(a => a.name === 'admin-sdk') || null;

    if (!adminApp) {
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (serviceAccountJson) {
        const sa = JSON.parse(serviceAccountJson);
        adminApp = initializeApp({ credential: cert(sa) }, 'admin-sdk');
      } else {
        const projectId   = process.env.FIREBASE_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
        if (!projectId || !clientEmail || !privateKey) {
          console.warn('[firebaseAdmin] No credentials — skipping Auth deletion');
          return false;
        }
        adminApp = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, 'admin-sdk');
      }
    }

    await getAuth(adminApp).deleteUser(uid);
    console.log(`[firebaseAdmin] Deleted Auth user: ${uid}`);
    return true;
  } catch (err) {
    if (err.code === 'auth/user-not-found') return true;
    // If firebase-admin not installed, fail silently
    if (err.code === 'MODULE_NOT_FOUND' || err.message?.includes('Cannot find')) {
      console.warn('[firebaseAdmin] firebase-admin not installed — skipping Auth deletion');
      return false;
    }
    console.error('[firebaseAdmin] deleteAuthUser failed:', err.message);
    return false;
  }
}
