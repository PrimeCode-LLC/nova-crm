import { FirebaseError } from "firebase/app";

export function readAuthErrorCode(error: unknown): string | null {
  if (error instanceof FirebaseError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const c = (error as { code: unknown }).code;
    return typeof c === "string" ? c : null;
  }
  return null;
}

/**
 * Maps Firebase Auth error codes to short, user-facing copy (client + Admin SDK).
 */
export function formatFirebaseAuthError(error: unknown): string {
  const code = readAuthErrorCode(error);
  const fallback =
    error instanceof Error ? error.message : "Something went wrong. Try again.";

  if (!code) return fallback;

  const messages: Record<string, string> = {
    "auth/email-already-in-use":
      "An account already exists for this email. Sign in with your existing password instead of creating a new account.",
    "auth/email-already-exists":
      "An account already exists for this email.",
    "auth/wrong-password": "Incorrect password. Try again or use “Forgot password”.",
    "auth/invalid-credential":
      "Incorrect email or password. If you recently joined via invite, use the password you chose at signup.",
    "auth/user-not-found": "No account found for this email.",
    "auth/invalid-email": "That email address doesn’t look valid.",
    "auth/weak-password": "Password is too weak. Use at least 8 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/account-exists-with-different-credential":
      "This email is linked to a different sign-in method. Use email/password or Google, whichever you used originally.",
  };

  return messages[code] ?? fallback;
}

export function isEmailAlreadyRegisteredError(error: unknown): boolean {
  return readAuthErrorCode(error) === "auth/email-already-in-use";
}
