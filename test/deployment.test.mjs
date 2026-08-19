import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyDeployment } from '../scripts/deployment-check.mjs';

test('deployment check rejects non-HTTPS endpoints before sending data', async () => {
  let called = false;
  await assert.rejects(() => verifyDeployment('http://api.example', undefined, async () => { called = true; }), /HTTPS/);
  assert.equal(called, false);
});

test('deployment check proves health, Android CORS, validation, and cross-site rejection', async () => {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ path: url.pathname, method: options.method ?? 'GET', origin: options.headers?.Origin });
    if (url.pathname === '/api/health') return new Response(JSON.stringify({ configured: true, model: 'test-model', contractVersion: '1.0' }), { headers: { 'Access-Control-Allow-Origin': 'https://localhost' } });
    if (options.headers?.Origin === 'https://evil.example') return new Response('{}', { status: 403 });
    if (options.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': 'https://localhost' } });
    return new Response('{}', { status: 400, headers: { 'Access-Control-Allow-Origin': 'https://localhost' } });
  };
  assert.deepEqual(await verifyDeployment('https://api.example', 'https://localhost', request), {
    url: 'https://api.example', model: 'test-model', contractVersion: '1.0',
  });
  assert.deepEqual(calls, [
    { path: '/api/health', method: 'GET', origin: 'https://localhost' },
    { path: '/api/analyze', method: 'OPTIONS', origin: 'https://localhost' },
    { path: '/api/analyze', method: 'POST', origin: 'https://localhost' },
    { path: '/api/analyze', method: 'OPTIONS', origin: 'https://evil.example' },
  ]);
});

test('deployment check rejects a reachable server without its model key', async () => {
  const request = async () => new Response(JSON.stringify({ configured: false, model: 'test-model', contractVersion: '1.0' }), {
    headers: { 'Access-Control-Allow-Origin': 'https://localhost' },
  });
  await assert.rejects(() => verifyDeployment('https://api.example', 'https://localhost', request), /密钥尚未配置/);
});
