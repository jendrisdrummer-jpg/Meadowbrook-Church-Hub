// How far along a study is, in plain words. Every number is optional. A study can run past its
// planned lessons, so that reads "Lesson 13 · planned 12", never "13 of 12". Pure, so tests can use it.
export function progressText(p) {
  if (p.lesson != null) {
    if (!p.planned) return `Lesson ${p.lesson}`;
    return p.lesson > p.planned ? `Lesson ${p.lesson} · planned ${p.planned}` : `Lesson ${p.lesson} of ${p.planned}`;
  }
  if (p.sessions) return `${p.sessions} ${p.sessions === 1 ? 'session' : 'sessions'}`;
  const since = p.since ? new Date(`${p.since}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
  return since ? `Active since ${since}` : 'Active';
}
