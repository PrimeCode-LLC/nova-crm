/** Firebase SDK embeds this URL when a composite index is missing. */
export function extractFirebaseIndexCreateUrl(message: string): string | null {
  const m = message.match(/https:\/\/console\.firebase\.google\.com[^\s]+/i);
  if (!m) return null;
  return m[0].replace(/[)\]"'.,;:]+$/, "");
}

export function isFirestorePermissionError(message: string): boolean {
  return /permission|insufficient/i.test(message);
}

export function teamChatFirestoreErrorHint(message: string): string | null {
  const indexUrl = extractFirebaseIndexCreateUrl(message);
  if (indexUrl) {
    return "Team chat needs a Firestore composite index. Open the link in the browser console error, or run: firebase deploy --only firestore:indexes";
  }
  if (isFirestorePermissionError(message)) {
    return "Firestore blocked this Team chat query. Deploy firestore.rules and firestore.indexes.json to your Firebase project (firebase deploy --only firestore), and ensure your signed-in user document has organizationId set for this workspace.";
  }
  return null;
}
