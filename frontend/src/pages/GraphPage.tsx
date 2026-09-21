import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ForceGraph2D from 'react-force-graph-2d';

import { fetchBacklinks, fetchGraph, GraphNode } from '../api/client';
import { useUiStore } from '../store/ui';

interface ForceNode extends GraphNode {
  id: string;
  x?: number;
  y?: number;
}

/** Цвета графа рисуются на canvas, поэтому берём их из тех же CSS-токенов.
 *  Читаем в эффекте: во время рендера data-theme на <html> ещё старый. */
function useGraphColors(theme: string) {
  const [colors, setColors] = useState({
    page: '#0e9a84',
    stub: '#97a2b8',
    edge: 'rgba(151,162,184,0.4)',
    text: '#131a2a',
  });

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    setColors({
      page: read('--node-page', '#0e9a84'),
      stub: read('--node-stub', '#97a2b8'),
      edge: read('--edge', 'rgba(151,162,184,0.4)'),
      text: read('--text', '#131a2a'),
    });
  }, [theme]);

  return colors;
}

function useContainerSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 520 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

export function GraphPage() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const k = Math.min(5, Math.max(1, Number(searchParams.get('k')) || 2));

  const navigate = useNavigate();
  const notify = useUiStore((s) => s.notify);
  const theme = useUiStore((s) => s.theme);
  const colors = useGraphColors(theme);
  const { ref, size } = useContainerSize();

  const graph = useQuery({
    queryKey: ['graph', id, k],
    queryFn: () => fetchGraph(id, k),
  });

  const backlinks = useQuery({
    queryKey: ['backlinks', id],
    queryFn: () => fetchBacklinks(id),
  });

  // react-force-graph мутирует переданные объекты, поэтому собираем
  // свежие копии на каждый ответ бэкенда.
  const data = useMemo(() => {
    if (!graph.data) return { nodes: [], links: [] };
    return {
      nodes: graph.data.nodes.map((node) => ({ ...node, id: node.url })),
      links: graph.data.edges.map((edge) => ({ source: edge.from, target: edge.to })),
    };
  }, [graph.data]);

  const onNodeClick = useCallback(
    (node: ForceNode) => {
      if (node.resolved && node.uuid) {
        navigate(`/page/${node.uuid}`);
        return;
      }
      notify(`Страница ${node.url} ещё не залита`);
    },
    [navigate, notify],
  );

  const paintNode = useCallback(
    (node: ForceNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const radius = node.resolved ? 6 : 5;
      ctx.globalAlpha = node.resolved ? 1 : 0.45;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI);
      ctx.fillStyle = node.resolved ? colors.page : colors.stub;
      ctx.fill();

      // Подписи появляются только на достаточном зуме, иначе каша.
      if (scale > 1.1) {
        const label = node.title ?? node.url;
        ctx.globalAlpha = node.resolved ? 0.9 : 0.5;
        ctx.font = `${11 / scale}px 'IBM Plex Sans', sans-serif`;
        ctx.fillStyle = colors.text;
        ctx.textAlign = 'center';
        ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + radius + 10 / scale);
      }
      ctx.globalAlpha = 1;
    },
    [colors],
  );

  return (
    <div className="content--wide">
      <div className="glass graph-toolbar">
        <Link to="/" className="button-quiet">
          Поиск
        </Link>
        <label>
          Глубина обхода
          <input
            type="range"
            min={1}
            max={5}
            value={k}
            onChange={(e) => setSearchParams({ k: e.target.value })}
          />
          <strong>{k}</strong>
        </label>
        {graph.data && (
          <span className="result-meta">
            {graph.data.nodes.length} вершин · {graph.data.edges.length} рёбер
          </span>
        )}
      </div>

      {graph.isError && (
        <div className="glass state">
          <strong>Граф не загрузился</strong>
          {(graph.error as Error).message}
        </div>
      )}

      <div className="glass graph-canvas" ref={ref}>
        {graph.isLoading && <div className="state">Строим граф…</div>}
        {graph.data && (
          <>
            <ForceGraph2D
              width={size.width}
              height={size.height}
              graphData={data}
              backgroundColor="rgba(0,0,0,0)"
              linkColor={() => colors.edge}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={1}
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={(node: ForceNode, color, ctx) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x ?? 0, node.y ?? 0, 9, 0, 2 * Math.PI);
                ctx.fill();
              }}
              nodeLabel={(node: ForceNode) =>
                node.resolved ? (node.description ?? node.title ?? node.url) : node.url
              }
              onNodeClick={onNodeClick}
              cooldownTicks={120}
            />
            <div className="glass graph-legend">
              <span>
                <i className="legend-dot" style={{ background: colors.page }} />
                залитая страница
              </span>
              <span>
                <i
                  className="legend-dot"
                  style={{ background: colors.stub, opacity: 0.45 }}
                />
                ещё не залита
              </span>
            </div>
          </>
        )}
      </div>

      {backlinks.data && backlinks.data.length > 0 && (
        <div className="glass graph-aside">
          <h3>Основные ссылки </h3>
          <ul className="backlink-list">
            {backlinks.data.map((url) => (
              <li key={url}>
                <Link to={`/graph/${encodeURIComponent(url)}`} className="pill">
                  {url}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}