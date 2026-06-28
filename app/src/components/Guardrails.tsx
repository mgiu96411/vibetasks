// Guardrails panel (right column, top). A numbered, click-to-edit list — NOT a
// textarea — of the project's always-loaded inviolable rules (note.guardrails,
// stored as a JSON array). Each change (add / edit / remove) saves the whole
// list via store.setGuardrails. Re-seeded from the snapshot on project switch /
// external (MCP) change. Caps mirror the backend: 20 items, 200 chars each,
// 2400 total — re-applied on add AND edit.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

const MAX_ITEMS = 20;
const SOFT_ITEMS = 10;
const ITEM_CHAR_CAP = 200;
const TOTAL_CHAR_CAP = 2400;

function parse(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; }
  catch { return []; }
}

export default function Guardrails() {
  const note = useStore((s) => s.snapshot?.note ?? null);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setGuardrails = useStore((s) => s.setGuardrails);

  const persisted = note?.guardrails ?? null;
  const [items, setItems] = useState<string[]>(() => parse(persisted));
  const [draft, setDraft] = useState('');
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const syncedRef = useRef(persisted);

  // Re-seed from persisted state on project switch / external change. Cancel any
  // in-progress edit too — its index may no longer point at the same rule.
  useEffect(() => {
    if (persisted !== syncedRef.current) {
      setItems(parse(persisted));
      syncedRef.current = persisted;
      setEditingIdx(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, persisted]);

  const totalChars = items.reduce((n, s) => n + s.length, 0);

  function commit(next: string[]) {
    setItems(next);
    syncedRef.current = JSON.stringify(next);
    setGuardrails(next).catch(() => {
      // toast already shown by store; revert optimistic state
      setItems(parse(persisted));
      syncedRef.current = persisted;
    });
  }

  function add() {
    const t = draft.trim();
    if (!t || items.length >= MAX_ITEMS) return;
    if (totalChars + t.length > TOTAL_CHAR_CAP) return;
    if (items.includes(t)) { setDraft(''); return; }
    commit([...items, t.slice(0, ITEM_CHAR_CAP)]);
    setDraft('');
  }

  function remove(i: number) {
    commit(items.filter((_, idx) => idx !== i));
  }

  function startEdit(i: number) {
    setEditingIdx(i);
    setEditDraft(items[i]);
  }

  function cancelEdit() {
    setEditingIdx(null);
  }

  function commitEdit(i: number) {
    const t = editDraft.trim();
    setEditingIdx(null);
    if (t === items[i]) return;                                   // unchanged
    if (!t) { remove(i); return; }                                // cleared → delete the rule
    if (items.some((x, idx) => idx !== i && x === t)) return;     // would duplicate → drop the edit
    if (totalChars - items[i].length + t.length > TOTAL_CHAR_CAP) return; // over total cap → keep original
    commit(items.map((x, idx) => (idx === i ? t.slice(0, ITEM_CHAR_CAP) : x)));
  }

  const full = items.length >= MAX_ITEMS;
  const nearTotalCap = totalChars >= TOTAL_CHAR_CAP - 200;
  const countClass = items.length >= SOFT_ITEMS || nearTotalCap ? 'gr-count warn' : 'gr-count';

  return (
    <div className="panel guardrails-panel">
      <div className="panel-title">
        🛡 Guardrails
        <span className={countClass}>{items.length}/{MAX_ITEMS}</span>
      </div>

      {items.length === 0 && (
        <div className="gr-empty">Add a rule Claude always follows.</div>
      )}

      {items.length > 0 && (
        <div className="gr-list">
          {items.map((it, i) => (
            <div className="gr-item" key={`${i}-${it}`}>
              <span className="gr-num">{i + 1}</span>
              {editingIdx === i ? (
                <input
                  className="gr-edit"
                  autoFocus
                  maxLength={ITEM_CHAR_CAP}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={() => commitEdit(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(i); }
                    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                  }}
                />
              ) : (
                <span
                  className="gr-text"
                  title="Click to edit"
                  onClick={() => startEdit(i)}
                >
                  {it}
                </span>
              )}
              <button className="gr-del" title="Remove" aria-label="Remove guardrail" onClick={() => remove(i)}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className="gr-add">
        <input
          maxLength={ITEM_CHAR_CAP}
          placeholder={full ? 'Max 20 — remove one first' : 'New rule…'}
          disabled={!activeProjectId || full}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button disabled={!activeProjectId || full || !draft.trim() || totalChars + draft.trim().length > TOTAL_CHAR_CAP} onClick={add}>Add</button>
      </div>
    </div>
  );
}
