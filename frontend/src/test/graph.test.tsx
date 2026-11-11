import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

import type { GraphResponse } from '../api/types';
import { Graph } from '../components/Graph';

const fg = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  zoomToFit: vi.fn(),
}));

vi.mock('react-force-graph-2d', async () => {
  const React = await import('react');
  return {
    __esModule: true,
    default: React.forwardRef(function MockForceGraph(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      fg.props = props;
      React.useImperativeHandle(ref, () => ({ zoomToFit: fg.zoomToFit }));
      return <div data-testid="force-graph" />;
    }),
  };
});

// Chain: Page A (start, dist 0) — Stub B (dist 1) — Page C (dist 2).
const fixture: GraphResponse = {
  nodes: [
    {
      uuid: 'u1',
      url: 'https://a.test/page',
      title: 'Page A',
      description: 'Description of A',
      resolved: true,
    },
    {
      uuid: null,
      url: 'https://b.test/stub',
      title: null,
      description: null,
      resolved: false,
    },
    {
      uuid: 'u2',
      url: 'https://c.test/page',
      title: 'Page C',
      description: null,
      resolved: true,
    },
  ],
  edges: [
    { from: 'https://a.test/page', to: 'https://b.test/stub' },
    { from: 'https://b.test/stub', to: 'https://c.test/page' },
  ],
};

function ArticleProbe() {
  const { uuid } = useParams();
  return <div data-testid="article">{uuid}</div>;
}

function renderGraph(onKChange: (k: number) => void = () => {}, centerId = 'https://a.test/page') {
  return render(
    <MemoryRouter initialEntries={['/graph/start']}>
      <Routes>
        <Route
          path="/graph/:uuidOrUrl"
          element={<Graph data={fixture} k={1} centerId={centerId} onKChange={onKChange} />}
        />
        <Route path="/page/:uuid" element={<ArticleProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

type GraphData = {
  nodes: Array<Record<string, unknown>>;
  links: Array<{ source: string; target: string }>;
};

function makeCtx() {
  const ops: Array<Array<unknown>> = [];
  const ctx = {
    beginPath: () => ops.push(['beginPath']),
    arc: (...args: Array<number>) => ops.push(['arc', ...args]),
    fill: () => ops.push(['fill']),
    stroke: () => ops.push(['stroke']),
    setLineDash: (dash: Array<number>) => ops.push(['setLineDash', dash]),
    fillText: (text: string, x: number, y: number) => ops.push(['fillText', text, x, y]),
    set fillStyle(value: string) {
      ops.push(['fillStyle', value]);
    },
    set strokeStyle(value: string) {
      ops.push(['strokeStyle', value]);
    },
    set lineWidth(value: number) {
      ops.push(['lineWidth', value]);
    },
    set font(value: string) {
      ops.push(['font', value]);
    },
    set textAlign(value: string) {
      ops.push(['textAlign', value]);
    },
  };
  return { ops, ctx: ctx as unknown as CanvasRenderingContext2D };
}

function paint(node: Record<string, unknown>, ctx: CanvasRenderingContext2D, globalScale?: number) {
  const paintFn = fg.props?.nodeCanvasObject as (
    node: unknown,
    ctx: CanvasRenderingContext2D,
    globalScale?: number,
  ) => void;
  paintFn(node, ctx, globalScale);
}

function fillStyles(ops: Array<Array<unknown>>): Array<string> {
  return ops.filter(([op]) => op === 'fillStyle').map(([, value]) => value as string);
}

describe('Graph', () => {
  beforeAll(() => {
    // jsdom reports 0x0; the component only mounts the canvas for non-zero boxes.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 600,
    });
  });

  beforeEach(() => {
    fg.props = null;
    fg.zoomToFit.mockClear();
  });

  it('renders nodes from a fixture keyed by url with links mapped from edges', async () => {
    renderGraph();

    await screen.findByTestId('force-graph');
    const graphData = fg.props?.graphData as GraphData;

    expect(graphData.nodes).toHaveLength(3);
    expect(graphData.nodes.map((n) => n.id)).toEqual([
      'https://a.test/page',
      'https://b.test/stub',
      'https://c.test/page',
    ]);
    expect(graphData.links).toEqual([
      { source: 'https://a.test/page', target: 'https://b.test/stub' },
      { source: 'https://b.test/stub', target: 'https://c.test/page' },
    ]);
  });

  it('keeps the start node at full accent opacity and fades neighbours by hop distance', async () => {
    renderGraph();
    await screen.findByTestId('force-graph');
    const graphData = fg.props?.graphData as GraphData;
    const [pageA, , pageC] = graphData.nodes;

    const start = makeCtx();
    paint(pageA, start.ctx);
    expect(fillStyles(start.ops)).toContain('rgba(139, 92, 246, 1)');

    const ring2 = makeCtx();
    paint(pageC, ring2.ctx);
    expect(fillStyles(ring2.ops)).toContain('rgba(139, 92, 246, 0.64)');
  });

  it('matches the start node by uuid as well as by url', async () => {
    renderGraph(() => {}, 'u1');
    await screen.findByTestId('force-graph');
    const graphData = fg.props?.graphData as GraphData;
    const [pageA] = graphData.nodes;

    const start = makeCtx();
    paint(pageA, start.ctx);
    expect(fillStyles(start.ops)).toContain('rgba(139, 92, 246, 1)');
  });

  it('distinguishes resolved pages from stubs (translucent gray, dashed)', async () => {
    renderGraph();
    await screen.findByTestId('force-graph');
    const graphData = fg.props?.graphData as GraphData;
    const [pageA, stubB] = graphData.nodes;

    const page = makeCtx();
    paint(pageA, page.ctx);
    expect(page.ops.filter(([op]) => op === 'setLineDash')).toHaveLength(0);

    const stub = makeCtx();
    paint(stubB, stub.ctx);
    expect(stub.ops).toContainEqual(['fillStyle', 'rgba(102, 102, 102, 0.45)']);
    expect(stub.ops).toContainEqual(['setLineDash', [3, 2]]);
    expect(stub.ops).toContainEqual(['strokeStyle', '#666666']);
    expect(stub.ops).toContainEqual(['stroke']);
    expect(stub.ops).toContainEqual(['setLineDash', []]);
  });

  it('draws the article title under resolved nodes and skips stubs', async () => {
    renderGraph();
    await screen.findByTestId('force-graph');
    const graphData = fg.props?.graphData as GraphData;
    const [pageA, stubB, pageC] = graphData.nodes;

    const a = makeCtx();
    paint(pageA, a.ctx);
    expect(a.ops).toContainEqual(['fillText', 'Page A', 0, 16]);
    expect(a.ops).toContainEqual(['textAlign', 'center']);
    expect(a.ops.some(([op, value]) => op === 'font' && String(value).includes('9px'))).toBe(true);
    expect(fillStyles(a.ops)).toContain('rgba(153, 153, 153, 0.6)');

    const c = makeCtx();
    paint(pageC, c.ctx);
    expect(c.ops).toContainEqual(['fillText', 'Page C', 0, 16]);

    const stub = makeCtx();
    paint(stubB, stub.ctx);
    expect(stub.ops.filter(([op]) => op === 'fillText')).toHaveLength(0);
  });

  it('hides titles when zoomed out below the label threshold', async () => {
    renderGraph();
    await screen.findByTestId('force-graph');
    const graphData = fg.props?.graphData as GraphData;
    const [pageA] = graphData.nodes;

    const zoomedOut = makeCtx();
    paint(pageA, zoomedOut.ctx, 0.3);
    expect(zoomedOut.ops.filter(([op]) => op === 'fillText')).toHaveLength(0);
  });

  it('shows the description on page hover and the url on stub hover', async () => {
    renderGraph();
    await screen.findByTestId('force-graph');

    const hover = fg.props?.onNodeHover as (node: unknown) => void;
    const graphData = fg.props?.graphData as GraphData;
    const [pageNode, stubNode] = graphData.nodes;

    act(() => hover(pageNode));
    expect(screen.getByText('Description of A')).toBeInTheDocument();

    act(() => hover(stubNode));
    expect(screen.getByText('https://b.test/stub')).toBeInTheDocument();

    act(() => hover(null));
    expect(screen.queryByText('https://b.test/stub')).not.toBeInTheDocument();
  });

  it('navigates to the article on page click and toasts on stub click', async () => {
    renderGraph();
    await screen.findByTestId('force-graph');

    const click = fg.props?.onNodeClick as (node: unknown) => void;
    const graphData = fg.props?.graphData as GraphData;
    const [pageNode, stubNode] = graphData.nodes;

    act(() => click(stubNode));
    expect(screen.getByText('This page has not been uploaded yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('article')).not.toBeInTheDocument();

    act(() => click(pageNode));
    expect(await screen.findByTestId('article')).toHaveTextContent('u1');
  });

  it('exposes the depth selector wired to onKChange and a fit-to-screen control', async () => {
    const onKChange = vi.fn();
    renderGraph(onKChange);
    await screen.findByTestId('force-graph');

    const select = screen.getByLabelText('Depth (hops)');
    expect(select).toHaveValue('1');

    fireEvent.change(select, { target: { value: '3' } });
    expect(onKChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByLabelText('Fit graph to screen'));
    expect(fg.zoomToFit).toHaveBeenCalled();
  });

  it('renders the Page/Stub legend', async () => {
    renderGraph();
    await screen.findByTestId('force-graph');

    const legend = screen.getByLabelText('Legend');
    expect(legend).toHaveTextContent('Page');
    expect(legend).toHaveTextContent('Stub');
  });
});
