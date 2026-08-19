/** firebase/app client shim */

export class FirebaseError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "FirebaseError";
  }
}

export type FirebaseApp = { name: string };

export function initializeApp(_config: unknown): FirebaseApp {
  return { name: "[DEFAULT]" };
}

export function getApps(): FirebaseApp[] {
  return [{ name: "[DEFAULT]" }];
}

export function getApp(): FirebaseApp {
  return { name: "[DEFAULT]" };
}
