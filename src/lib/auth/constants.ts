/** Nova CRM httpOnly session (Firebase Admin session cookie). Not Clerk's cookie. */
export const SESSION_COOKIE_NAME = "__nova_session";

/** Session cookie max age (ms). Firebase allows up to 14 days. */
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 5;
