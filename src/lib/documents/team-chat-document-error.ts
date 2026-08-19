export function extractDocumentIndexHintUrl(_message: string): string | null {
  return null;
}

export function isDocumentPermissionError(message: string): boolean {
  return /permission|insufficient|rls|denied/i.test(message);
}

export function teamChatDocumentErrorHint(message: string): string | null {
  if (isDocumentPermissionError(message)) {
    return "Team chat query was denied. Ensure your user profile has organizationId set and you belong to this workspace.";
  }
  if (/index|composite/i.test(message)) {
    return "Team chat needs a Postgres index on pg_documents. Check server logs and run pending migrations.";
  }
  return null;
}
