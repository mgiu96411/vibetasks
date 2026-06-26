// Project rail grouped into user-managed spaces.
// Spaces are collapsible sections; projects can be created directly in a
// section or moved between sections from the project row.
// Spaces can be reordered by dragging the section header.

import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Project, Space } from 'shared';
import { useStore, type Filter } from '../store';
import SidebarSettings from './SidebarSettings';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'claude', label: "Claude's" },
];

const DEFAULT_SPACE_ID = 'space-current';

// ---- sortable space section -------------------------------------------------

interface SpaceSectionProps {
  space: Space;
  spaceProjects: Project[];
  activeProjectId: string | null;
  collapsed: Set<string>;
  toggleSpace: (id: string) => void;
  renamingSpaceId: string | null;
  spaceRenameDraft: string;
  setRenamingSpaceId: (id: string | null) => void;
  setSpaceRenameDraft: (v: string) => void;
  commitSpaceRename: (space: Space) => void;
  confirmDeleteSpaceId: string | null;
  setConfirmDeleteSpaceId: (id: string | null) => void;
  deleteSpace: (id: string) => void;
  renameSpace: (id: string, name: string) => void;
  setActiveProject: (id: string) => void;
  renamingProjectId: string | null;
  projectRenameDraft: string;
  setRenamingProjectId: (id: string | null) => void;
  setProjectRenameDraft: (v: string) => void;
  commitProjectRename: (project: Project) => void;
  confirmDeleteProjectId: string | null;
  setConfirmDeleteProjectId: (id: string | null) => void;
  deleteProject: (id: string) => void;
  addingProjectSpaceId: string | null;
  projectDraft: string;
  setAddingProjectSpaceId: (id: string | null) => void;
  setProjectDraft: (v: string) => void;
  commitNewProject: (spaceId: string) => void;
}

function SortableSpaceSection({
  space,
  spaceProjects,
  activeProjectId,
  collapsed,
  toggleSpace,
  renamingSpaceId,
  spaceRenameDraft,
  setRenamingSpaceId,
  setSpaceRenameDraft,
  commitSpaceRename,
  confirmDeleteSpaceId,
  setConfirmDeleteSpaceId,
  deleteSpace,
  setActiveProject,
  renamingProjectId,
  projectRenameDraft,
  setRenamingProjectId,
  setProjectRenameDraft,
  commitProjectRename,
  confirmDeleteProjectId,
  setConfirmDeleteProjectId,
  deleteProject,
  addingProjectSpaceId,
  projectDraft,
  setAddingProjectSpaceId,
  setProjectDraft,
  commitNewProject,
}: SpaceSectionProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: space.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const isCollapsed = collapsed.has(space.id);
  const isDefault = space.id === DEFAULT_SPACE_ID;

  return (
    <section className="space-section" key={space.id} ref={setNodeRef} style={style}>
      <div className="space-header">
        {/* drag handle */}
        <span
          className="space-drag-handle"
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          ⠿
        </span>

        <button
          className="space-toggle"
          title={isCollapsed ? 'Expand space' : 'Collapse space'}
          onClick={() => toggleSpace(space.id)}
        >
          {isCollapsed ? '›' : '⌄'}
        </button>

        {renamingSpaceId === space.id ? (
          <input
            className="space-name-input"
            autoFocus
            value={spaceRenameDraft}
            onChange={(event) => setSpaceRenameDraft(event.target.value)}
            onBlur={() => commitSpaceRename(space)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitSpaceRename(space);
              if (event.key === 'Escape') {
                setRenamingSpaceId(null);
                setSpaceRenameDraft('');
              }
            }}
          />
        ) : (
          <button className="space-name" onClick={() => toggleSpace(space.id)}>
            {space.name}
          </button>
        )}

        <span className="space-count">{spaceProjects.length}</span>

        {confirmDeleteSpaceId === space.id ? (
          <span className="space-actions confirming">
            <button
              className="space-action danger"
              onClick={() => {
                setConfirmDeleteSpaceId(null);
                void deleteSpace(space.id);
              }}
            >
              Delete?
            </button>
            <button
              className="space-action"
              onClick={() => setConfirmDeleteSpaceId(null)}
            >
              ✕
            </button>
          </span>
        ) : (
          <span className="space-actions">
            <button
              className="space-action"
              title="Rename space"
              onClick={() => {
                setRenamingSpaceId(space.id);
                setSpaceRenameDraft(space.name);
                setConfirmDeleteSpaceId(null);
              }}
            >
              ✎
            </button>
            {!isDefault && (
              <button
                className="space-action"
                title={
                  spaceProjects.length
                    ? 'Move projects out before deleting'
                    : 'Delete space'
                }
                disabled={spaceProjects.length > 0}
                onClick={() => setConfirmDeleteSpaceId(space.id)}
              >
                ✕
              </button>
            )}
          </span>
        )}
      </div>

      {!isCollapsed && (
        <div className="space-projects">
          {spaceProjects.map((project) => (
            <div key={project.id}>
              <div
                className={`project-item${project.id === activeProjectId ? ' active' : ''}`}
                onClick={() => void setActiveProject(project.id)}
                role="button"
                tabIndex={0}
              >
                <span className="dot" style={{ background: project.color }} />
                {renamingProjectId === project.id ? (
                  <input
                    className="new-project-input rename-input"
                    autoFocus
                    value={projectRenameDraft}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setProjectRenameDraft(event.target.value)}
                    onBlur={() => commitProjectRename(project)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitProjectRename(project);
                      if (event.key === 'Escape') {
                        setRenamingProjectId(null);
                        setProjectRenameDraft('');
                      }
                    }}
                  />
                ) : (
                  <span className="project-name-text">{project.name}</span>
                )}
                {project.source === 'claude' && renamingProjectId !== project.id && (
                  <span className="marker">✦</span>
                )}
                {confirmDeleteProjectId === project.id ? (
                  <span className="project-actions confirming">
                    <button
                      className="proj-action danger"
                      title="Confirm delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmDeleteProjectId(null);
                        void deleteProject(project.id);
                      }}
                    >
                      Delete?
                    </button>
                    <button
                      className="proj-action"
                      title="Cancel"
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmDeleteProjectId(null);
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <span className="project-actions">
                    <button
                      className="proj-action"
                      title="Rename project"
                      onClick={(event) => {
                        event.stopPropagation();
                        setRenamingProjectId(project.id);
                        setProjectRenameDraft(project.name);
                        setConfirmDeleteProjectId(null);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="proj-action"
                      title="Delete project"
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmDeleteProjectId(project.id);
                        setRenamingProjectId(null);
                      }}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            </div>
          ))}

          {addingProjectSpaceId === space.id ? (
            <input
              className="new-project-input space-project-input"
              autoFocus
              placeholder="Project name…"
              value={projectDraft}
              onChange={(event) => setProjectDraft(event.target.value)}
              onBlur={() => commitNewProject(space.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitNewProject(space.id);
                if (event.key === 'Escape') {
                  setProjectDraft('');
                  setAddingProjectSpaceId(null);
                }
              }}
            />
          ) : (
            <button
              className="new-project space-new-project"
              onClick={() => {
                setAddingProjectSpaceId(space.id);
                setProjectDraft('');
              }}
            >
              + Project
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---- main sidebar -----------------------------------------------------------

export default function Sidebar() {
  const spaces = useStore((s) => s.snapshot?.spaces) ?? [];
  const projects = useStore((s) => s.snapshot?.projects) ?? [];
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const createSpace = useStore((s) => s.createSpace);
  const renameSpace = useStore((s) => s.renameSpace);
  const deleteSpace = useStore((s) => s.deleteSpace);
  const reorderSpaces = useStore((s) => s.reorderSpaces);
  const createProject = useStore((s) => s.createProject);
  const renameProject = useStore((s) => s.renameProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addingSpace, setAddingSpace] = useState(false);
  const [spaceDraft, setSpaceDraft] = useState('');
  const [addingProjectSpaceId, setAddingProjectSpaceId] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] = useState('');
  const [renamingSpaceId, setRenamingSpaceId] = useState<string | null>(null);
  const [spaceRenameDraft, setSpaceRenameDraft] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [projectRenameDraft, setProjectRenameDraft] = useState('');
  const [confirmDeleteSpaceId, setConfirmDeleteSpaceId] = useState<string | null>(null);
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function projectsIn(space: Space): Project[] {
    return projects.filter(
      (project) =>
        project.space_id === space.id ||
        (!project.space_id && space.id === DEFAULT_SPACE_ID),
    );
  }

  function toggleSpace(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function commitNewSpace() {
    const name = spaceDraft.trim();
    if (name) void createSpace(name);
    setSpaceDraft('');
    setAddingSpace(false);
  }

  function commitNewProject(spaceId: string) {
    const name = projectDraft.trim();
    if (name) void createProject(name, spaceId);
    setProjectDraft('');
    setAddingProjectSpaceId(null);
  }

  function commitSpaceRename(space: Space) {
    const name = spaceRenameDraft.trim();
    if (name && name !== space.name) void renameSpace(space.id, name);
    setRenamingSpaceId(null);
    setSpaceRenameDraft('');
  }

  function commitProjectRename(project: Project) {
    const name = projectRenameDraft.trim();
    if (name && name !== project.name) void renameProject(project.id, name);
    setRenamingProjectId(null);
    setProjectRenameDraft('');
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = spaces.findIndex((s) => s.id === active.id);
    const newIndex = spaces.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(spaces, oldIndex, newIndex);
    void reorderSpaces(reordered.map((s) => s.id));
  }

  const spaceIds = spaces.map((s) => s.id);

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="logo">✦</span> Vibe Tasks
      </div>

      <div className="rail-label">View</div>
      <div className="sidebar-filter filter">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            className={filter === item.id ? 'active' : ''}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="spaces-label-row">
        <div className="rail-label">Spaces</div>
        <button
          className="add-space-button"
          title="New space"
          onClick={() => setAddingSpace(true)}
        >
          +
        </button>
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={spaceIds} strategy={verticalListSortingStrategy}>
          <div className="space-list">
            {spaces.map((space) => (
              <SortableSpaceSection
                key={space.id}
                space={space}
                spaceProjects={projectsIn(space)}
                activeProjectId={activeProjectId}
                collapsed={collapsed}
                toggleSpace={toggleSpace}
                renamingSpaceId={renamingSpaceId}
                spaceRenameDraft={spaceRenameDraft}
                setRenamingSpaceId={setRenamingSpaceId}
                setSpaceRenameDraft={setSpaceRenameDraft}
                commitSpaceRename={commitSpaceRename}
                confirmDeleteSpaceId={confirmDeleteSpaceId}
                setConfirmDeleteSpaceId={setConfirmDeleteSpaceId}
                deleteSpace={(id) => void deleteSpace(id)}
                renameSpace={renameSpace}
                setActiveProject={(id) => void setActiveProject(id)}
                renamingProjectId={renamingProjectId}
                projectRenameDraft={projectRenameDraft}
                setRenamingProjectId={setRenamingProjectId}
                setProjectRenameDraft={setProjectRenameDraft}
                commitProjectRename={commitProjectRename}
                confirmDeleteProjectId={confirmDeleteProjectId}
                setConfirmDeleteProjectId={setConfirmDeleteProjectId}
                deleteProject={(id) => void deleteProject(id)}
                addingProjectSpaceId={addingProjectSpaceId}
                projectDraft={projectDraft}
                setAddingProjectSpaceId={setAddingProjectSpaceId}
                setProjectDraft={setProjectDraft}
                commitNewProject={commitNewProject}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {addingSpace ? (
        <input
          className="new-project-input new-space-input"
          autoFocus
          placeholder="Space name…"
          value={spaceDraft}
          onChange={(event) => setSpaceDraft(event.target.value)}
          onBlur={commitNewSpace}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitNewSpace();
            if (event.key === 'Escape') {
              setSpaceDraft('');
              setAddingSpace(false);
            }
          }}
        />
      ) : (
        <button className="new-space" onClick={() => setAddingSpace(true)}>
          + New space
        </button>
      )}

      <SidebarSettings />
    </aside>
  );
}
