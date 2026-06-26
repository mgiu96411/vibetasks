// Board-level "Next Goal" banner: shows the project's current milestone,
// subgoals, and following goal. Inline-editable; collapses to a single line.

import { useState, useRef, useEffect } from 'react';
import type { Goal } from 'shared';
import { useStore } from '../store';

export default function NextGoal() {
  const note = useStore((s) => s.snapshot?.note ?? null);
  const setGoal = useStore((s) => s.setGoal);

  const goals: Goal | null = (() => {
    if (!note?.goals) return null;
    try { return JSON.parse(note.goals) as Goal; } catch { return null; }
  })();

  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const [draftGoal, setDraftGoal] = useState('');
  const [draftSubgoals, setDraftSubgoals] = useState('');
  const [draftFollowing, setDraftFollowing] = useState('');
  const goalRef = useRef<HTMLTextAreaElement>(null);

  function openEdit() {
    setDraftGoal(goals?.goal ?? '');
    setDraftSubgoals((goals?.subgoals ?? []).join('\n'));
    setDraftFollowing(goals?.following_goal ?? '');
    setEditing(true);
  }

  useEffect(() => {
    if (editing) goalRef.current?.focus();
  }, [editing]);

  async function save() {
    const subgoals = draftSubgoals
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    await setGoal({ goal: draftGoal.trim(), subgoals, following_goal: draftFollowing.trim() });
    setEditing(false);
  }

  function cancel() { setEditing(false); }

  if (editing) {
    return (
      <div className="next-goal next-goal--editing">
        <div className="ng-field">
          <label className="ng-label">Next goal</label>
          <textarea
            ref={goalRef}
            className="ng-input"
            rows={2}
            value={draftGoal}
            onChange={(e) => setDraftGoal(e.target.value)}
            placeholder="What are we building toward?"
          />
        </div>
        <div className="ng-field">
          <label className="ng-label">Subgoals <span className="ng-hint">(one per line)</span></label>
          <textarea
            className="ng-input"
            rows={3}
            value={draftSubgoals}
            onChange={(e) => setDraftSubgoals(e.target.value)}
            placeholder="Immediate steps..."
          />
        </div>
        <div className="ng-field">
          <label className="ng-label">Following goal</label>
          <textarea
            className="ng-input"
            rows={2}
            value={draftFollowing}
            onChange={(e) => setDraftFollowing(e.target.value)}
            placeholder="What comes after?"
          />
        </div>
        <div className="ng-actions">
          <button className="ng-btn ng-btn--save" onClick={save}>Save</button>
          <button className="ng-btn ng-btn--cancel" onClick={cancel}>Cancel</button>
        </div>
      </div>
    );
  }

  if (!goals?.goal) {
    return (
      <div className="next-goal next-goal--empty" onClick={openEdit} title="Set next goal">
        <span className="ng-empty-icon">↗</span>
        <span className="ng-empty-text">Set next goal</span>
      </div>
    );
  }

  return (
    <div className={`next-goal${collapsed ? ' next-goal--collapsed' : ''}`}>
      <div className="ng-header">
        <span className="ng-eyebrow">Next goal</span>
        <span className="ng-goal-text">{goals.goal}</span>
        <div className="ng-header-actions">
          <button className="ng-icon-btn" onClick={openEdit} title="Edit goal">✏</button>
          <button className="ng-icon-btn" onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? '▾' : '▴'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="ng-body">
          {goals.subgoals.length > 0 && (
            <ul className="ng-subgoals">
              {goals.subgoals.map((s, i) => (
                <li key={i} className="ng-subgoal">{s}</li>
              ))}
            </ul>
          )}
          {goals.following_goal && (
            <div className="ng-following">
              <span className="ng-following-label">Following: </span>
              {goals.following_goal}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
