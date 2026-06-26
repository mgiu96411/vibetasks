// "Last session" recap — a read-only, dated walk-away summary written by Claude
// at wrap-up (note.recap). Renders nothing when empty. The board is the
// present-tense source of truth; this is past-tense, stamped testimony.

import { useStore } from '../store';

function fmt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function LastSession() {
  const note = useStore((s) => s.snapshot?.note ?? null);
  const recap = note?.recap ?? '';
  if (!recap.trim()) return null;
  const when = fmt(note?.recap_at ?? null);
  return (
    <div className="panel last-session">
      <div className="panel-title">Last session{when ? ` · ${when}` : ''}</div>
      <div className="recap-body">{recap}</div>
    </div>
  );
}
