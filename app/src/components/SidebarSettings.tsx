// Global app settings pinned to the bottom of the sidebar: which terminal the
// ▶ Start / Open Claude buttons launch into, and the path to the Claude binary.
// Both persist to localStorage via the store setters — the same values the
// Command Palette settings commands read/write.

import { useEffect, useState } from 'react';
import {
  TERMINALS,
  getTerminalApp,
  setTerminalApp,
  isCustomTerminal,
  getClaudeBin,
  setClaudeBin,
} from '../store';
import { detectTerminals } from '../api';

const CUSTOM = '__custom__';

export default function SidebarSettings() {
  const [open, setOpen] = useState(false);

  const initial = getTerminalApp();
  const initialCustom = isCustomTerminal(initial);
  const [terminal, setTerminal] = useState(initial);
  const [customMode, setCustomMode] = useState(initialCustom);
  const [customDraft, setCustomDraft] = useState(initialCustom ? initial : '');
  const [claudeBin, setClaudeBinDraft] = useState(getClaudeBin());
  // null until probed; then the set of first-class terminal ids that are
  // actually installed. Used to gray out missing options.
  const [installed, setInstalled] = useState<Set<string> | null>(null);

  useEffect(() => {
    let alive = true;
    void detectTerminals(TERMINALS.map((t) => t.id))
      .then((ids) => {
        if (alive) setInstalled(new Set(ids));
      })
      .catch(() => {
        // On failure, leave `installed` null so nothing is grayed out
        // (fail-open — never block a working terminal behind a probe error).
      });
    return () => {
      alive = false;
    };
  }, []);

  function onSelectChange(v: string) {
    if (v === CUSTOM) {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    setTerminal(v);
    setTerminalApp(v);
  }

  function onCustomChange(text: string) {
    setCustomDraft(text);
    setTerminalApp(text); // empty coerces to Ghostty in storage; UI stays in custom mode
    setTerminal(text.trim() || 'Ghostty');
  }

  function onClaudeBinChange(text: string) {
    setClaudeBinDraft(text);
    setClaudeBin(text);
  }

  const selectValue = customMode ? CUSTOM : terminal;

  return (
    <div className="sidebar-settings">
      <button
        className="settings-toggle"
        onClick={() => setOpen((o) => !o)}
        title="App settings"
      >
        <span className={`settings-caret ${open ? 'open' : ''}`}>▸</span>
        ⚙ Settings
      </button>

      {open && (
        <div className="settings-body">
          <label className="settings-row">
            <span className="settings-label">Terminal</span>
            <select
              className="settings-select"
              value={selectValue}
              onChange={(e) => onSelectChange(e.target.value)}
            >
              {TERMINALS.map((t) => {
                // `installed === null` means the probe hasn't resolved (or
                // failed) — show everything enabled. Once probed, gray out
                // any terminal whose .app wasn't found, but never disable the
                // currently-selected one (keep selection/persistence intact).
                const missing =
                  installed !== null && !installed.has(t.id) && t.id !== terminal;
                return (
                  <option key={t.id} value={t.id} disabled={missing}>
                    {t.label}
                    {missing ? ' (not installed)' : ''}
                  </option>
                );
              })}
              <option value={CUSTOM}>Custom…</option>
            </select>
          </label>

          {!customMode && installed !== null && !installed.has(terminal) && (
            <span className="settings-note settings-warn">
              {terminal} isn’t installed — Start may fail.
            </span>
          )}

          {customMode && (
            <input
              className="settings-input"
              placeholder="App name (e.g. WezTerm)"
              value={customDraft}
              onChange={(e) => onCustomChange(e.target.value)}
            />
          )}

          <label className="settings-row settings-row-stacked">
            <span className="settings-label">Claude binary</span>
            <input
              className="settings-input"
              placeholder="~/.local/bin/claude"
              value={claudeBin}
              onChange={(e) => onClaudeBinChange(e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
