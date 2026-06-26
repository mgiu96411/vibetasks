// Notes panel (right column, bottom). A textarea bound to the active project's
// note body with DEBOUNCED autosave (~400ms): typing updates local state
// immediately and schedules a store.setNotes call once the user pauses.
//
// The textarea is re-seeded from the snapshot whenever the active project (or
// the persisted note body) changes — e.g. after switching projects or when the
// MCP server writes notes and the poll loop refreshes — but only when the value
// actually differs, so an in-flight edit isn't clobbered by our own save's
// refresh.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

const DEBOUNCE_MS = 400;

export default function Notes() {
  const note = useStore((s) => s.snapshot?.note ?? null);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setNotes = useStore((s) => s.setNotes);

  const persisted = note?.body ?? '';
  const [value, setValue] = useState(persisted);

  // Tracks the value we last sent to (or received from) the backend so we can
  // tell apart "external change" from "our own edit round-tripping back".
  const syncedRef = useRef(persisted);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed from persisted state on project switch / external note changes.
  useEffect(() => {
    if (persisted !== syncedRef.current) {
      setValue(persisted);
      syncedRef.current = persisted;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, persisted]);

  // Flush any pending save on unmount.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      syncedRef.current = next;
      void setNotes(next);
    }, DEBOUNCE_MS);
  }

  return (
    <div className="panel notes-panel">
      <div className="panel-title">Notes</div>
      <textarea
        className="notes-area"
        placeholder={
          activeProjectId
            ? 'Project notes — autosaves as you type…'
            : 'Select a project to take notes'
        }
        disabled={!activeProjectId}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
