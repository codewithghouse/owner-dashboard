/**
 * syncClaims.ts
 * Calls the `syncUserClaims` Cloud Function to populate Firebase custom claims
 * ({ schoolId, role, branchId }) on the user's ID token, then force-refreshes
 * the token so Firestore security rules see the new claims.
 */
import { getFunctions, httpsCallable } from "firebase/functions";
import type { User } from "firebase/auth";

const FUNCTIONS_REGION = "us-central1";

export async function syncClaimsAndRefreshToken(user: User): Promise<{
  role: string;
  schoolId: string | null;
  branchId?: string | null;
} | null> {
  try {
    const fns = getFunctions(undefined, FUNCTIONS_REGION);
    const call = httpsCallable<unknown, { role: string; schoolId: string; branchId?: string }>(
      fns,
      "syncUserClaims",
    );
    const res = await call({});
    await user.getIdToken(true);
    return res.data ?? null;
  } catch (err: any) {
    console.warn("[syncClaims] failed:", err?.message || err);
    return null;
  }
}