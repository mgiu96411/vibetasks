// The dependency / subtask graph view — the human-facing render of get_map.
//
// Builds a React Flow (@xyflow/react) canvas from the current snapshot:
//   - one node per task (respecting the All/Mine/Claude filter, same as Board),
//     labelled with the title + a "✦" marker when created by Claude, and tinted
//     by status/priority via the theme CSS vars (--done / --p-* / --accent).
//   - edges from task_link:  depends_on -> solid arrow,  related -> dashed.
//   - parent -> subtask edges in a distinct (dotted, accent) style.
// Nodes are auto-laid-out top-down with dagre (layered). The view fits on load
// and whenever the derived graph changes (e.g. Claude writes via the MCP and
// the polling loop refreshes the snapshot). Clicking a node opens its detail.

import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import type { Status, Priority, Task, TaskLink } from 'shared';
import { useStore, type Filter } from '../store';

const NODE_W = 184;
const NODE_H = 44;

function matchesFilter(task: Task, filter: Filter): boolean {
  if (filter === 'mine') return task.source === 'you';
  if (filter === 'claude') return task.source === 'claude';
  return true;
}

// Border color: status first (complete = done green), else priority rail color,
// else the neutral accent. Background stays panel-dark so text reads on the bg.
function nodeColors(status: Status, priority: Priority): {
  border: string;
  text: string;
} {
  if (status === 'complete') return { border: 'var(--done)', text: 'var(--done)' };
  if (status === 'dropped') return { border: 'var(--faint)', text: 'var(--faint)' };
  if (status === 'now') return { border: 'var(--accent)', text: 'var(--text)' };
  if (priority === 'high') return { border: 'var(--p-high)', text: 'var(--text)' };
  if (priority === 'med') return { border: 'var(--p-med)', text: 'var(--text)' };
  if (priority === 'low') return { border: 'var(--p-low)', text: 'var(--text)' };
  return { border: 'var(--border)', text: 'var(--text)' };
}

// Run dagre layered layout over the nodes/edges and stamp x/y positions.
function layout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 70, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id);
    return {
      ...n,
      position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom,
    };
  });
}

export default function GraphView() {
  const snapshot = useStore((s) => s.snapshot);
  const filter = useStore((s) => s.filter);
  const selectTask = useStore((s) => s.selectTask);

  const tasks = snapshot?.tasks ?? [];
  const links: TaskLink[] = snapshot?.links ?? [];

  const { nodes, edges } = useMemo(() => {
    const visible = tasks.filter((t) => matchesFilter(t, filter));
    const visibleIds = new Set(visible.map((t) => t.id));

    const rawNodes: Node[] = visible.map((t) => {
      const c = nodeColors(t.status, t.priority);
      const label =
        t.source === 'claude' ? `✦ ${t.title}` : t.title;
      return {
        id: t.id,
        data: { label },
        position: { x: 0, y: 0 },
        style: {
          width: NODE_W,
          minHeight: NODE_H,
          background: 'linear-gradient(180deg, var(--card-top), var(--card-bot))',
          border: `1px solid ${c.border}`,
          borderLeft: `3px solid ${c.border}`,
          borderRadius: 'var(--radius)',
          color: c.text,
          fontSize: 12,
          fontFamily: 'inherit',
          padding: '8px 12px',
          textAlign: 'left' as const,
          boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
        },
      };
    });

    const rawEdges: Edge[] = [];

    // Dependency / related links from task_link.
    for (const l of links) {
      if (!visibleIds.has(l.from_task_id) || !visibleIds.has(l.to_task_id)) {
        continue;
      }
      const isDep = l.type === 'depends_on';
      rawEdges.push({
        id: `link:${l.type}:${l.from_task_id}->${l.to_task_id}`,
        source: l.from_task_id,
        target: l.to_task_id,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: isDep ? 'var(--accent)' : 'var(--muted)',
          strokeWidth: 1.5,
          strokeDasharray: isDep ? undefined : '5 5',
        },
        markerEnd: isDep
          ? { type: MarkerType.ArrowClosed, color: 'var(--accent)' }
          : undefined,
      });
    }

    // Parent -> subtask edges (distinct dotted accent-soft style).
    for (const t of visible) {
      if (t.parent_id && visibleIds.has(t.parent_id)) {
        rawEdges.push({
          id: `subtask:${t.parent_id}->${t.id}`,
          source: t.parent_id,
          target: t.id,
          type: 'smoothstep',
          style: {
            stroke: 'var(--faint)',
            strokeWidth: 1.5,
            strokeDasharray: '2 4',
          },
          markerEnd: { type: MarkerType.Arrow, color: 'var(--faint)' },
        });
      }
    }

    return { nodes: layout(rawNodes, rawEdges), edges: rawEdges };
  }, [tasks, links, filter]);

  const onNodeClick: NodeMouseHandler = (_e, node) => {
    selectTask(node.id);
  };

  if (nodes.length === 0) {
    return <div className="placeholder">No tasks to graph yet.</div>;
  }

  return (
    <div className="graph-view">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={1.75}
      >
        <Background color="rgba(255,255,255,0.05)" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
