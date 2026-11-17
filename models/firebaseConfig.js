import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}. Set it in your .env file or deployment config.`);
  return val;
}

const firebaseConfig = {
  apiKey:            requireEnv('FIREBASE_API_KEY'),
  authDomain:        requireEnv('FIREBASE_AUTH_DOMAIN'),
  projectId:         requireEnv('FIREBASE_PROJECT_ID'),
  storageBucket:     requireEnv('FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: requireEnv('FIREBASE_MESSAGING_SENDER_ID'),
  appId:             requireEnv('FIREBASE_APP_ID'),
  measurementId:     process.env.FIREBASE_MEASUREMENT_ID || '',
};

// ── Singleton guard — re-use existing app across Vercel warm re-invocations ──
const app  = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

export { db, auth, firebaseConfig };
