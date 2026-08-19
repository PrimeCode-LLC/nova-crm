/** firebase/auth client shim — Clerk handles auth; legacy pages redirect to /sign-in. */

export type IdTokenResult = {
  token: string;
  claims: Record<string, unknown>;
};

export type User = {
  uid: string;
  email: string | null;
  displayName?: string | null;
  providerData: { providerId: string }[];
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  getIdTokenResult: (forceRefresh?: boolean) => Promise<IdTokenResult>;
};

export type UserCredential = { user: User };

export class GoogleAuthProvider {
  addScope(_scope: string) {}
  setCustomParameters(_params: Record<string, string>) {}
  static credentialFromResult(_result: UserCredential): { accessToken?: string } {
    return {};
  }
}

export class EmailAuthProvider {
  static credential(_email: string, _password: string) {
    return {};
  }
}

function stubUser(): User {
  return {
    uid: "",
    email: null,
    providerData: [],
    async getIdToken() {
      return "";
    },
    async getIdTokenResult() {
      return { token: "", claims: {} };
    },
  };
}

export function getAuth(_app?: unknown): { currentUser: User | null } {
  return { currentUser: null };
}

export async function signInWithCustomToken(): Promise<never> {
  throw new Error("Firebase Auth removed. Sign in via Clerk at /sign-in.");
}

export async function signOut(_auth?: unknown): Promise<void> {
  if (typeof window !== "undefined") {
    window.location.href = "/api/auth/logout";
  }
}

export async function sendPasswordResetEmail(): Promise<never> {
  throw new Error("Firebase password reset removed. Use Clerk forgot-password flow.");
}

export async function confirmPasswordReset(): Promise<never> {
  throw new Error("Firebase password reset removed.");
}

export async function createUserWithEmailAndPassword(): Promise<never> {
  throw new Error("Firebase signup removed. Use /sign-up.");
}

export async function signInWithEmailAndPassword(..._args: unknown[]): Promise<never> {
  throw new Error("Firebase login removed. Use /sign-in.");
}

export async function signInWithPopup(..._args: unknown[]): Promise<never> {
  throw new Error("Firebase OAuth removed. Use Clerk or Google Calendar connect flow.");
}

export async function linkWithPopup(
  _user: User,
  _provider: GoogleAuthProvider,
): Promise<UserCredential> {
  throw new Error("Firebase link removed. Use /api/scheduling/oauth/google.");
}

export async function reauthenticateWithPopup(
  _user: User,
  _provider: GoogleAuthProvider,
): Promise<UserCredential> {
  throw new Error("Firebase reauth removed. Use /api/scheduling/oauth/google.");
}

export async function reauthenticateWithCredential(): Promise<never> {
  throw new Error("Firebase reauth removed. Use Clerk account settings.");
}

export async function updatePassword(): Promise<never> {
  throw new Error("Firebase password update removed. Use Clerk account settings.");
}

export async function updateProfile(): Promise<never> {
  throw new Error("Firebase profile update removed. Use Clerk user profile.");
}

export async function reload(_user: User): Promise<void> {}

export function onAuthStateChanged(
  _auth: unknown,
  cb: (user: User | null) => void,
  onError?: (err: Error) => void,
): () => void {
  try {
    cb(null);
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
  return () => {};
}

export type Auth = ReturnType<typeof getAuth>;

export { stubUser };
