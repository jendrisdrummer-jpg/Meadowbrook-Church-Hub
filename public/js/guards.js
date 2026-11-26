// Plain wording helpers for the safety prompts (no page code here, so tests can load it).

const n = (x, one, many) => `${x} ${x === 1 ? one : many}`;

// Reads the /impact counts. `one` = the prompt is about a single service.
// Returns null when nobody is scheduled, so the dialog stays as it was.
export function impactNote(i, { one = false } = {}) {
  if (!i || !i.volunteers) return null;
  const where = one ? 'this service' : 'these services';
  const lead = `${n(i.volunteers, 'volunteer is', 'volunteers are')} scheduled`;
  return { lead, rest: ` in ${where} (${i.accepted} accepted).` };
}

// What the server's 409 for a possible duplicate person holds, or null for any other error.
// Leaders and stations only get { id, first_name, last_name }; staff also get contact details.
export function duplicateOf(err) {
  const d = err?.status === 409 ? err.data?.duplicate : null;
  return d && d.id ? d : null;
}

export const personLabel = (p) => [p.first_name, p.last_name].filter(Boolean).join(' ');
