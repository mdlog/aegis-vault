import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeMutationRequest } from '../src/api.js';

function makeRequest({ headers = {}, ip = '127.0.0.1', remoteAddress = '127.0.0.1', hostname = 'localhost' } = {}) {
  return {
    ip,
    hostname,
    socket: {
      remoteAddress,
    },
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}

test('manual mutation requests require the configured API key', () => {
  const auth = authorizeMutationRequest(
    makeRequest(),
    'test-secret'
  );

  assert.deepEqual(auth, {
    ok: false,
    status: 401,
    error: 'Missing or invalid API key',
  });
});

test('manual mutation requests accept the configured API key', () => {
  const auth = authorizeMutationRequest(
    makeRequest({
      headers: {
        'x-api-key': 'test-secret',
      },
    }),
    'test-secret'
  );

  assert.deepEqual(auth, { ok: true });
});

test('manual mutation requests are localhost-only when no API key is configured', () => {
  const auth = authorizeMutationRequest(
    makeRequest({
      ip: '203.0.113.10',
      remoteAddress: '203.0.113.10',
      hostname: 'example.com',
    }),
    ''
  );

  assert.deepEqual(auth, {
    ok: false,
    status: 403,
    error: 'Manual mutation routes are limited to localhost when no API key is configured',
  });
});
