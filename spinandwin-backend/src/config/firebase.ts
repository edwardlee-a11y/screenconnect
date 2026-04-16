import * as admin from 'firebase-admin';

// ─── Singleton guard ───────────────────────────────────────────────────────
// Firebase Admin throws if initialized more than once — guard against hot reloads.

let initialized = false;

export function initFirebase(): void {
  if (initialized || admin.apps.length > 0) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      '[firebase] FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY must be set',
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      // Railway env vars escape newlines as literal \n — restore them
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
  });

  initialized = true;
}

// ─── Accessor ──────────────────────────────────────────────────────────────
// Call initFirebase() at boot (server.ts) before using these.

export function getFirebaseAuth(): admin.auth.Auth {
  if (!initialized && admin.apps.length === 0) {
    throw new Error('[firebase] Firebase not initialized. Call initFirebase() first.');
  }
  return admin.auth();
}

// ─── Token verification ────────────────────────────────────────────────────

export interface FirebaseTokenPayload {
  uid: string;
  email: string | undefined;
  emailVerified: boolean;
  name: string | undefined;
  picture: string | undefined;
}

/**
 * Verify a Firebase ID token sent from the mobile client.
 * Throws if the token is invalid, expired, or revoked.
 */
export async function verifyFirebaseToken(
  idToken: string,
): Promise<FirebaseTokenPayload> {
  const auth = getFirebaseAuth();

  // checkRevoked: true — respects sign-out / account disabling immediately
  const decoded = await auth.verifyIdToken(idToken, true);

  return {
    uid: decoded.uid,
    email: decoded.email,
    emailVerified: decoded.email_verified ?? false,
    name: decoded.name,
    picture: decoded.picture,
  };
}

/**
 * Fetch a Firebase user record by UID.
 * Use this to get the latest email/displayName after token verification.
 */
export async function getFirebaseUser(
  uid: string,
): Promise<admin.auth.UserRecord> {
  const auth = getFirebaseAuth();
  return auth.getUser(uid);
}

/**
 * Revoke all refresh tokens for a user — forces re-login on all devices.
 * Call this on ban, password change, or suspicious activity.
 */
export async function revokeUserTokens(uid: string): Promise<void> {
  const auth = getFirebaseAuth();
  await auth.revokeRefreshTokens(uid);
}

/**
 * Disable a Firebase user account (banned users).
 */
export async function disableFirebaseUser(uid: string): Promise<void> {
  const auth = getFirebaseAuth();
  await auth.updateUser(uid, { disabled: true });
}
