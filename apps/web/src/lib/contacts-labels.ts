/** Browser-safe: kept apart from contacts.ts, which pulls in the database client. */
export const OPT_IN_LABEL: Record<string, { label: string; tone: string }> = {
  OPTED_IN: { label: 'opt-in', tone: 'bg-ok-bg text-ok' },
  OPTED_OUT: { label: 'berhenti', tone: 'bg-danger-bg text-danger' },
  UNKNOWN: { label: 'belum jelas', tone: 'bg-muted text-fg-muted' },
}
