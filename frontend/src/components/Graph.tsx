import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, MouseEvent, Ref } from 'react';
import { Maximize } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import type { GraphNode, GraphResponse } from '../api/types';
import { LoadingView } from './StateViews';

import styles from './Graph.module.css';

/*
 * The graph library is heavy, so it is lazy-loaded per Agents.md §9 and lands
 * in a separate async chunk.
 */

// Minimal structural type for the imperative handle we use; avoids depending
// on the library's internal instance type.
interface ForceGraphHandle {
  zoomToFit?: (durationMs?: number, padding?: number) => void;
}

// Our node objects as passed to the canvas callbacks: API node fields plus
// the force-graph identity and position fields.
export interface ForceGraphNode extends GraphNode {
  id: string;
  x?: number;
  y?: number;
}

interface ForceGraphProps {
  ref?: Ref<ForceGraphHandle>;
  width: number;
  height: number;
  graphData: {
    nodes: ForceGraphNode[];
    links: Array<{ source: string; target: string }>;
  };
  backgroundColor: string;
  linkColor: () => string;
  nodeCanvasObject: (
    node: ForceGraphNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => void;
  nodePointerAreaPaint: (
    node: ForceGraphNode,
    color: string,
    ctx: CanvasRenderingContext2D,
  ) => void;
  nodeLabel: () => string;
  onNodeClick: (node: ForceGraphNode) => void;
  onNodeHover: (node: ForceGraphNode | null) => void;
  onEngineStop: () => void;
}

// Single typed boundary over the library's default export (its own typings
// are generic and do not flow through React.lazy well).
const ForceGraph2D = lazy(async () => {
  const mod = await import('react-force-graph-2d');
  return { default: mod.default as unknown as ComponentType<ForceGraphProps> };
});

type HoverState = {
  text: string;
  x: number;
  y: number;
} | null;

const PAGE_COLOR = '#8b5cf6';
const STUB_COLOR = '#666666';
const STUB_FILL = 'rgba(102, 102, 102, 0.45)';
const NODE_RADIUS = 5;
const HIT_RADIUS = 8;

// Brightness falls off with the hop distance from the start node: the start
// node keeps the full accent color, each next ring of neighbours gets dimmer.
const FADE_PER_HOP = 0.18;
const MIN_PAGE_ALPHA = 0.35;

const LABEL_FONT_SIZE = 9;
const LABEL_ALPHA = 0.6;
const LABEL_OFFSET = 11;
const MIN_LABEL_SCALE = 0.5;

const STUB_TOAST = 'This page has not been uploaded yet.';
const TOAST_DURATION_MS = 3200;

function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

function linkColor(): string {
  return cssVar('--color-border', '#333333');
}

function labelColor(): string {
  const muted = cssVar('--color-text-muted', '#999999');
  const hex = /^#([0-9a-f]{6})$/i.exec(muted);
  if (!hex) return muted;
  const r = parseInt(hex[1].slice(0, 2), 16);
  const g = parseInt(hex[1].slice(2, 4), 16);
  const b = parseInt(hex[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${LABEL_ALPHA})`;
}

function pageFillStyle(distance: number): string {
  const alpha = distance === 0 ? 1 : Math.max(MIN_PAGE_ALPHA, 1 - FADE_PER_HOP * distance);
  const r = parseInt(PAGE_COLOR.slice(1, 3), 16);
  const g = parseInt(PAGE_COLOR.slice(3, 5), 16);
  const b = parseInt(PAGE_COLOR.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// BFS over url-keyed edges from the start node (matched by uuid or url).
// Returns hop distance per node url; unreachable nodes stay absent.
function computeDistances(data: GraphResponse, centerId: string): Map<string, number> {
  const distances = new Map<string, number>();
  const start = data.nodes.find((n) => n.uuid === centerId || n.url === centerId);
  if (!start) return distances;

  const adjacency = new Map<string, string[]>();
  const addEdge = (from: string, to: string) => {
    const list = adjacency.get(from);
    if (list) {
      list.push(to);
    } else {
      adjacency.set(from, [to]);
    }
  };
  for (const edge of data.edges) {
    addEdge(edge.from, edge.to);
    addEdge(edge.to, edge.from);
  }

  distances.set(start.url, 0);
  const queue: string[] = [start.url];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const nextDistance = (distances.get(current) as number) + 1;
    for (const next of adjacency.get(current) ?? []) {
      if (!distances.has(next)) {
        distances.set(next, nextDistance);
        queue.push(next);
      }
    }
  }
  return distances;
}

export function Graph({
  data,
  k,
  centerId,
  onKChange,
}: {
  data: GraphResponse;
  k: number;
  centerId: string;
  onKChange: (k: number) => void;
}) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphHandle | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<HoverState>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const graphData = useMemo(
    () => ({
      nodes: data.nodes.map((n) => ({ ...n, id: n.url })),
      links: data.edges.map((e) => ({ source: e.from, target: e.to })),
    }),
    [data],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showStubToast = () => {
    setToast(STUB_TOAST);
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  };

  const distances = useMemo(() => computeDistances(data, centerId), [data, centerId]);

  const paintNode = (node: ForceGraphNode, ctx: CanvasRenderingContext2D, globalScale = 1) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    ctx.beginPath();
    ctx.arc(x, y, NODE_RADIUS, 0, 2 * Math.PI);
    if (node.resolved) {
      const distance = distances.get(node.url) ?? Number.POSITIVE_INFINITY;
      ctx.fillStyle = pageFillStyle(distance);
      ctx.fill();
    } else {
      ctx.fillStyle = STUB_FILL;
      ctx.fill();
      ctx.setLineDash([3, 2]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = STUB_COLOR;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Article title under the node; stubs have no title (their url shows on hover).
    if (node.resolved && node.title && globalScale >= MIN_LABEL_SCALE) {
      ctx.font = `${LABEL_FONT_SIZE}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = labelColor();
      ctx.textAlign = 'center';
      ctx.fillText(node.title, x, y + NODE_RADIUS + LABEL_OFFSET);
    }
  };

  const paintPointerArea = (node: ForceGraphNode, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, HIT_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  };

  const handleNodeClick = (node: ForceGraphNode) => {
    if (node.resolved && node.uuid) {
      navigate(`/page/${node.uuid}`);
    } else {
      showStubToast();
    }
  };

  const handleNodeHover = (node: ForceGraphNode | null) => {
    if (!node) {
      setHover(null);
      return;
    }
    const text = node.resolved ? (node.description ?? node.title ?? node.url) : node.url;
    setHover((prev) => ({ text, x: prev?.x ?? 0, y: prev?.y ?? 0 }));
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setHover((prev) => (prev ? { ...prev, x, y } : prev));
  };

  const fitToScreen = () => {
    fgRef.current?.zoomToFit?.(400, 24);
  };

  return (
    <div
      ref={containerRef}
      className={styles.viewport}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      {size.width > 0 && size.height > 0 ? (
        <Suspense fallback={<LoadingView label="Loading graph…" />}>
          <ForceGraph2D
            ref={fgRef}
            width={size.width}
            height={size.height}
            graphData={graphData}
            backgroundColor="rgba(0, 0, 0, 0)"
            linkColor={linkColor}
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={paintPointerArea}
            nodeLabel={() => ''}
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
            onEngineStop={fitToScreen}
          />
        </Suspense>
      ) : null}

      <div className={styles.controls}>
        <label className={styles.kField}>
          Depth
          <select
            className={styles.kSelect}
            value={k}
            onChange={(e) => onKChange(Number(e.target.value))}
            aria-label="Depth (hops)"
          >
            {[1, 2, 3, 4, 5].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={styles.iconButton}
          onClick={fitToScreen}
          aria-label="Fit graph to screen"
          title="Fit to screen"
        >
          <Maximize size={14} aria-hidden="true" />
        </button>
      </div>

      <ul className={styles.legend} aria-label="Legend">
        <li className={styles.legendItem}>
          <span className={styles.legendSwatch} data-kind="page" aria-hidden="true" />
          Page
        </li>
        <li className={styles.legendItem}>
          <span className={styles.legendSwatch} data-kind="stub" aria-hidden="true" />
          Stub
        </li>
      </ul>

      {hover ? (
        <div
          className={styles.tooltip}
          style={{ left: hover.x + 12, top: hover.y + 12 }}
          role="tooltip"
        >
          {hover.text}
        </div>
      ) : null}

      {toast ? (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
