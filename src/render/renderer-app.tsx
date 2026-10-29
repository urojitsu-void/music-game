import { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

import type { Layout } from '../build/config.ts';
import type { Chart } from '../chart/schema.ts';
import {
  renderFrame, type CanvasLike, type RenderTheme,
} from './canvas-renderer.ts';

export interface RendererInitialization {
  readonly chart: Chart;
  readonly layout: Layout;
  readonly theme: RenderTheme | null;
  readonly width: number;
  readonly height: number;
}

export interface RendererApi {
  initialize(options: RendererInitialization): void;
  render(timeSeconds: number): void;
}

declare global {
  interface Window {
    renderer?: RendererApi;
  }
}

export function RendererScreen(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initializationRef = useRef<RendererInitialization | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error('Renderer canvas is unavailable');
    const api: RendererApi = {
      initialize(options) {
        if (!Number.isInteger(options.width) || options.width <= 0
          || !Number.isInteger(options.height) || options.height <= 0) {
          throw new RangeError('Renderer dimensions must be positive integers');
        }
        initializationRef.current = options;
        canvas.width = options.width;
        canvas.height = options.height;
      },
      render(timeSeconds) {
        const initialization = initializationRef.current;
        if (!initialization) throw new Error('Renderer must be initialized before rendering');
        renderFrame(
          canvas as unknown as CanvasLike,
          initialization.chart,
          timeSeconds,
          initialization.layout,
          initialization.theme,
          { mode: 'autoplay' },
        );
      },
    };
    window.renderer = api;
    return () => {
      if (window.renderer === api) delete window.renderer;
    };
  }, []);

  return <canvas ref={canvasRef} aria-label="Rhythm game renderer" />;
}

if (typeof document !== 'undefined') {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Renderer root element is missing');
  createRoot(rootElement).render(<RendererScreen />);
}
