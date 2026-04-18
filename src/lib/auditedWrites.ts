/**
 * auditedWrites.ts
 * Thin wrappers around Firestore write operations that inject `_lastModifiedBy`
 * so the server-side audit logger can attribute the change to the right user.
 */
import {
  addDoc, setDoc, updateDoc, deleteDoc,
  type CollectionReference, type DocumentReference,
  type DocumentData, type WithFieldValue, type SetOptions, type UpdateData,
} from "firebase/firestore";
import { auth } from "./firebase";

function actor(): string {
  return auth.currentUser?.uid || "anonymous";
}

export function auditedAdd<T extends DocumentData>(
  ref: CollectionReference<T>,
  data: WithFieldValue<T>,
) {
  return addDoc(ref, { ...data, _lastModifiedBy: actor() } as WithFieldValue<T>);
}

export function auditedSet<T extends DocumentData>(
  ref: DocumentReference<T>,
  data: WithFieldValue<T>,
  options?: SetOptions,
) {
  const payload = { ...data, _lastModifiedBy: actor() } as WithFieldValue<T>;
  return options ? setDoc(ref, payload, options) : setDoc(ref, payload);
}

export function auditedUpdate<T extends DocumentData>(
  ref: DocumentReference<T>,
  data: UpdateData<T>,
) {
  return updateDoc(ref, { ...data, _lastModifiedBy: actor() } as UpdateData<T>);
}

// Stamp `_lastModifiedBy` BEFORE deleting so the server-side audit onWrite
// trigger can attribute the delete to the right user (not "system").
export async function auditedDelete<T extends DocumentData>(ref: DocumentReference<T>) {
  try {
    await updateDoc(ref, { _lastModifiedBy: actor() } as unknown as UpdateData<T>);
  } catch (err) {
    // Doc may not exist, or rules may block update — either way, fall through
    // to the delete. If delete itself fails, the caller sees that error.
    console.warn("[auditedDelete] pre-delete stamp failed (non-fatal):", err);
  }
  return deleteDoc(ref);
}