/** firebase-admin/auth shim — auth handled by Clerk; stubs for legacy call sites. */

import type { App } from "@/lib/db/pg-firestore/shim-app";

export type DecodedIdToken = {
  uid: string;
  email?: string;
  name?: string;
  auth_time?: number;
  organizationId?: string;
  orgRole?: string;
  [key: string]: unknown;
};

export type UserRecord = {
  uid: string;
  email?: string;
  displayName?: string;
  disabled?: boolean;
  customClaims?: Record<string, unknown>;
};

export type Auth = {
  app: App;
  generatePasswordResetLink: (email: string, actionCodeSettings?: unknown) => Promise<string>;
  verifyIdToken: (token: string, checkRevoked?: boolean) => Promise<DecodedIdToken>;
  verifySessionCookie: (cookie: string, checkRevoked?: boolean) => Promise<DecodedIdToken>;
  revokeRefreshTokens: (uid: string) => Promise<void>;
  createCustomToken: (uid: string, claims?: Record<string, unknown>) => Promise<string>;
  createUser: (props: unknown) => Promise<UserRecord>;
  getUserByEmail: (email: string) => Promise<UserRecord | null>;
  deleteUser: (uid: string) => Promise<void>;
  getUser: (uid: string) => Promise<UserRecord>;
  setCustomUserClaims: (uid: string, claims: Record<string, unknown>) => Promise<void>;
};

function authMethods(app: App): Auth {
  return {
    app,
    async generatePasswordResetLink() {
      throw new Error("Firebase password reset removed. Use Clerk.");
    },
    async verifyIdToken(token: string) {
      return { uid: token.slice(0, 32) };
    },
    async verifySessionCookie(cookie: string) {
      return { uid: cookie.slice(0, 32) };
    },
    async revokeRefreshTokens() {},
    async createCustomToken() {
      throw new Error("Firebase custom tokens removed.");
    },
    async createUser() {
      throw new Error("Firebase Auth removed. Use Clerk sign-up.");
    },
    async getUserByEmail(email: string) {
      return { uid: email, email };
    },
    async deleteUser() {},
    async getUser(uid: string) {
      return { uid, disabled: false };
    },
    async setCustomUserClaims() {},
  };
}

export function getAuth(app: App): Auth {
  return authMethods(app);
}

export async function createCustomToken(
  auth: Auth,
  uid: string,
  claims?: Record<string, unknown>,
): Promise<string> {
  return auth.createCustomToken(uid, claims);
}

export async function getUser(auth: Auth, uid: string): Promise<UserRecord> {
  return auth.getUser(uid);
}

export async function setCustomUserClaims(
  auth: Auth,
  uid: string,
  claims: Record<string, unknown>,
): Promise<void> {
  return auth.setCustomUserClaims(uid, claims);
}

export async function createUser(auth: Auth, props: unknown): Promise<UserRecord> {
  return auth.createUser(props);
}

export async function updateUser(_auth: Auth, _uid: string, _props: unknown): Promise<UserRecord> {
  throw new Error("Firebase Auth user update removed.");
}

export async function deleteUser(auth: Auth, uid: string): Promise<void> {
  return auth.deleteUser(uid);
}

export async function getUserByEmail(auth: Auth, email: string): Promise<UserRecord | null> {
  return auth.getUserByEmail(email);
}
