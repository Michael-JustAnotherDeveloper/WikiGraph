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
  ],
  edges: [{ from: 'https://a.test/page', to: 'https://b.test/stub' }],
};

function ArticleProbe() {
  const { uuid } = useParams();
  return <div data-testid="article">{uuid}</div>;
}

function renderGraph(onKChange: (k: number) => void = () => {}) {
  return render(
    <MemoryRouter initialEntries={['/graph/start']}>
      <Routes>
        <Route
          path="/graph/:uuidOrUrl"
          element={<Graph data={fixture} k={1} onKChange={onKChange} />}
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
    set fillStyle(value: string) {
      ops.push(['fillStyle', value]);
    },
    set strokeStyle(value: string) {
      ops.push(['strokeStyle', value]);
    },
    set lineWidth(value: number) {
      ops.push(['lineWidth', value]);
    },
  };
  return { ops, ctx: ctx as unknown as CanvasRenderingContext2D };
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

    expect(graphData.nodes).toHaveLength(2);
    expect(graphData.nodes.map((n) => n.id)).toEqual([
      'https://a.test/page',
      'https://b.test/stub',
    ]);
    expect(graphData.links).toEqual([
      { source: 'https://a.test/page', target: 'https://b.test/stub' },
    ]);
  });

  it('distinguishes resolved pages (violet, opaque) from stubs (translucent gray, dashed)', async () => {
    renderGraph();
    await screen.findByTestId('force-graph');

    const paint = fg.props?.nodeCanvasObject as (
      node: unknown,
      ctx: CanvasRenderingContext2D,
    ) => void;
    const graphData = fg.props?.graphData as GraphData;
    const [pageNode, stubNode] = graphData.nodes;

    const page = makeCtx();
    paint(pageNode, page.ctx);
    expect(page.ops).toContainEqual(['fillStyle', '#8b5cf6']);
    expect(page.ops).toContainEqual(['fill']);
    expect(page.ops.filter(([op]) => op === 'setLineDash')).toHaveLength(0);

    const stub = makeCtx();
    paint(stubNode, stub.ctx);
    expect(stub.ops).toContainEqual(['fillStyle', 'rgba(102, 102, 102, 0.45)']);
    expect(stub.ops).toContainEqual(['setLineDash', [3, 2]]);
    expect(stub.ops).toContainEqual(['strokeStyle', '#666666']);
    expect(stub.ops).toContainEqual(['stroke']);
    expect(stub.ops).toContainEqual(['setLineDash', []]);
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
