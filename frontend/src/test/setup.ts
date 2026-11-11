import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Required so manual act() calls (used in the Graph tests) are recognized.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
});

// jsdom (used by the Graph tests) does not implement ResizeObserver.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// jsdom does not implement canvas 2D contexts; Graph tests never reach real
// canvas code, but guard anyway so stray calls fail softly in tests.
if (typeof HTMLCanvasElement !== 'undefined') {
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
  };
  HTMLCanvasElement.prototype.getContext = vi
    .fn()
    .mockReturnValue(ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
