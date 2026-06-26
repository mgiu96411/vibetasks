// Titlebar search box. Filters the board in-place via the store `search` field.
// Cmd/Ctrl+F focuses it; Esc clears the query and blurs.

import { useEffect, useRef } from 'react';
import { useStore } from '../store';

export default function SearchBar() {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="titlebar-search">
      <span className="titlebar-search-icon" aria-hidden>🔍</span>
      <input
        ref={inputRef}
        className="titlebar-search-input"
        type="text"
        placeholder="Search tasks…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setSearch('');
            e.currentTarget.blur();
          }
        }}
      />
      {search && (
        <button
          className="titlebar-search-clear"
          title="Clear search"
          onClick={() => setSearch('')}
        >
          ×
        </button>
      )}
    </div>
  );
}
