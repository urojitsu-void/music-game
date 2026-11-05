import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';

import { validateChart } from '../chart/validation.ts';
import { DEFAULT_PLAYLIST_URL } from './data-config.ts';

export interface PlayServerOptions {
  readonly root: string;
  readonly outputDirectory: string;
  readonly debug: boolean;
  readonly playlistUrl?: string;
  readonly releaseFetch?: (
    url: string, init?: RequestInit,
  ) => Promise<Response>;
  readonly host?: string;
  readonly port?: number;
}

export interface RunningPlayServer {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
});

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function parsePath(request: IncomingMessage): string | null {
  const raw = (request.url ?? '/').split('?', 1)[0] ?? '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('\\') || decoded.includes('\0')) return null;
  if (decoded.split('/').some((segment) => segment === '..')) return null;
  return decoded;
}

function within(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
}

function byteRange(value: string, size: number): { readonly start: number; readonly end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match) return null;
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (!startText && !endText) return null;
  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function serveFile(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  allowedRoot: string,
): Promise<void> {
  if (!within(allowedRoot, path)) {
    sendText(response, 400, 'Bad request');
    return;
  }
  let file;
  try {
    file = await stat(path);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      sendText(response, 404, 'Not found');
      return;
    }
    throw error;
  }
  if (!file.isFile()) {
    sendText(response, 404, 'Not found');
    return;
  }
  const contentType = CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const rangeHeader = request.headers.range;
  if (rangeHeader) {
    const range = byteRange(rangeHeader, file.size);
    if (!range) {
      response.writeHead(416, { 'Content-Range': `bytes */${file.size}` });
      response.end();
      return;
    }
    const length = range.end - range.start + 1;
    response.writeHead(206, {
      'Content-Type': contentType,
      'Content-Length': length,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`,
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(path, range).pipe(response);
    return;
  }
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': file.size,
    'Accept-Ranges': 'bytes',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(path).pipe(response);
}

async function proxyReleaseAsset(
  request: IncomingMessage,
  response: ServerResponse,
  assetName: string,
  playlistUrl: string,
  releaseFetch: NonNullable<PlayServerOptions['releaseFetch']>,
): Promise<void> {
  if (!assetName || !/^[A-Za-z0-9._-]+$/.test(assetName)) {
    sendText(response, 400, 'Bad request');
    return;
  }
  const targetUrl = new URL(encodeURIComponent(assetName), new URL('.', playlistUrl)).href;
  const headers = new Headers();
  if (request.headers.range) headers.set('Range', request.headers.range);
  const upstream = await releaseFetch(targetUrl, {
    method: request.method,
    headers,
    redirect: 'follow',
  });
  const responseHeaders: Record<string, string> = {
    'Content-Type': CONTENT_TYPES[extname(assetName).toLowerCase()]
      ?? upstream.headers.get('content-type')
      ?? 'application/octet-stream',
  };
  for (const name of ['content-length', 'accept-ranges', 'content-range', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders[name] = value;
  }
  response.writeHead(upstream.status, responseHeaders);
  if (request.method === 'HEAD' || upstream.body === null) {
    response.end();
    return;
  }
  Readable.fromWeb(
    upstream.body as Parameters<typeof Readable.fromWeb>[0],
  ).pipe(response);
}

function createHandler(options: PlayServerOptions) {
  const root = resolve(options.root);
  const outputDirectory = resolve(options.outputDirectory);
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const path = parsePath(request);
      if (path === null) {
        sendText(response, 400, 'Bad request');
        return;
      }
      if (path === '/api/runtime' && request.method === 'GET') {
        sendJson(response, 200, {
          debug: options.debug,
          playlistUrl: '/api/release/playlist.json',
        });
        return;
      }
      if (path.startsWith('/api/release/')
        && (request.method === 'GET' || request.method === 'HEAD')) {
        await proxyReleaseAsset(
          request,
          response,
          path.slice('/api/release/'.length),
          options.playlistUrl ?? DEFAULT_PLAYLIST_URL,
          options.releaseFetch ?? fetch,
        );
        return;
      }
      if (path.startsWith('/api/debug/')) {
        if (!options.debug) {
          sendText(response, 404, 'Not found');
          return;
        }
        if (path === '/api/debug/status' && request.method === 'GET') {
          sendJson(response, 200, {
            debug: true,
            outputDirectory,
            generation: 'not-implemented',
          });
          return;
        }
        if (path === '/api/debug/generate' && request.method === 'POST') {
          sendJson(response, 501, { error: 'Debug generation is not implemented yet' });
          return;
        }
        if (path === '/api/debug/output/background.mp4' && (request.method === 'GET' || request.method === 'HEAD')) {
          await serveFile(request, response, resolve(outputDirectory, 'background.mp4'), outputDirectory);
          return;
        }
        if (path === '/api/debug/output' && request.method === 'GET') {
          try {
            await stat(resolve(outputDirectory, 'background.mp4'));
            const chart = validateChart(JSON.parse(
              await readFile(resolve(outputDirectory, 'chart.json'), 'utf8'),
            ) as unknown);
            sendJson(response, 200, {
              id: 'debug-output',
              title: 'output',
              backgroundVideoUrl: '/api/debug/output/background.mp4',
              chart,
            });
          } catch (error) {
            const missing = typeof error === 'object' && error !== null
              && 'code' in error && error.code === 'ENOENT';
            sendJson(response, missing ? 404 : 422, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }
        sendText(response, 404, 'Not found');
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendText(response, 405, 'Method not allowed');
        return;
      }
      const relativePath = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
      await serveFile(request, response, resolve(root, relativePath), root);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    }
  };
}

export async function startPlayServer(options: PlayServerOptions): Promise<RunningPlayServer> {
  const host = options.host ?? '127.0.0.1';
  const server = createServer((request, response) => {
    void createHandler(options)(request, response);
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Play server address is unavailable');
  return {
    host,
    port: address.port,
    url: `http://${host}:${address.port}`,
    close: () => new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    }),
  };
}
