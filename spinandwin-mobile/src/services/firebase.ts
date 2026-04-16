import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signOut,
  type User,
} from 'firebase/auth';
import Constants from 'expo-constants';

// ─── Firebase initialisation ────────────────────────────────────────────────
// Config values come from app.json → extra.firebase so they stay out of source.

const firebaseConfig = (Constants.expoConfig?.extra as Record<string, unknown>)
  ?.firebase as {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
  };

if (!firebaseConfig?.apiKey) {
  console.warn(
    '[Firebase] Missing config in app.json extra.firebase. ' +
    'Replace the placeholder values before running the app.',
  );
}

// Avoid re-initialising when Expo fast-refreshes the module.
const app = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApps()[0];

// Our app stores the session JWT in AsyncStorage via authStore.
// Firebase auth is only used to obtain the initial ID token, so
// in-memory persistence (the default for getAuth) is sufficient.
export const firebaseAuth = getAuth(app);

// ─── Auth helpers ────────────────────────────────────────────────────────────

/** Sign in and return a fresh Firebase ID token. */
export async function firebaseLogin(email: string, password: string): Promise<string> {
  const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
  return credential.user.getIdToken();
}

/**
 * Create a new account, send a verification email, then return the ID token.
 * The backend enforces email verification before allowing play.
 */
export async function firebaseRegister(email: string, password: string): Promise<string> {
  const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
  await sendEmailVerification(credential.user);
  return credential.user.getIdToken();
}

/** Send a password-reset email. */
export async function firebaseResetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(firebaseAuth, email);
}

/**
 * Change the current user's password.
 * Re-authenticates first (Firebase requires it for security-sensitive ops).
 */
export async function firebaseChangePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user || !user.email) throw new Error('No authenticated user.');

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

/** Sign out from Firebase (JWT is revoked separately via the backend). */
export async function firebaseSignOut(): Promise<void> {
  await signOut(firebaseAuth);
}

/** Return the currently signed-in Firebase user, or null. */
export function getCurrentFirebaseUser(): User | null {
  return firebaseAuth.currentUser;
}
