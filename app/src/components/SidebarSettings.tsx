// Global app settings pinned to the bottom of the sidebar: which terminal the
// ▶ Start / Open Claude buttons launch into, and the path to the Claude binary.
// Both persist to localStorage via the store setters — the same values the
// Command Palette settings commands read/write.

import { useState } from 'react';
import {
  TERMINALS,
  getTerminalApp,
  setTerminalApp,
  isCustomTerminal,
  getClaudeBin,
  setClaudeBin,
} from '../store';

const CUSTOM = '__custom__';

export default function SidebarSettings() {
  const [open, setOpen] = useState(false);

  const initial = getTerminalApp();
  const initialCustom = isCustomTerminal(initial);
  const [terminal, setTerminal] = useState(initial);
  const [customMode, setCustomMode] = useState(initialCustom);
  const [customDraft, setCustomDraft] = useState(initialCustom ? initial : '');
  const [claudeBin, setClaudeBinDraft] = useState(getClaudeBin());

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
              {TERMINALS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
              <option value={CUSTOM}>Custom…</option>
            </select>
          </label>

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
