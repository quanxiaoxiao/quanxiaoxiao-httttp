import { test, mock } from 'node:test';
import assert from 'node:assert';
import net from 'node:net';
import { waitFor } from '@quanxiaoxiao/utils';
import forwardRequest from './forwardRequest.mjs';

const _getPort = () => {
  let _port = 4950;
  return () => {
    const port = _port;
    _port += 1;
    return port;
  };
};

const getPort = _getPort();

test('forwardRequest error', async () => {
  try {
    const controller = new AbortController();
    await forwardRequest({
      signal: controller.signal,
      request: {
        method: 'GET',
        path: '/',
        headers: {},
        headersRaw: [],
      },
    }, { port: null });
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof assert.AssertionError);
  }
  try {
    const controller = new AbortController();
    await forwardRequest({
      signal: controller.signal,
      request: {
        method: 'GET',
        path: '/',
        headers: {},
        headersRaw: [],
      },
    }, { port: 999999 });
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof assert.AssertionError);
  }
});

test('forwardRequest connect error', async () => {
  try {
    const controller = new AbortController();
    await forwardRequest({
      signal: controller.signal,
      request: {
        method: 'GET',
        path: '/',
        headers: {},
        headersRaw: [],
      },
    }, { port: 9988 });
    throw new Error('xxx');
  } catch (error) {
    assert.equal(error.statusCode, 502);
  }
});

test('forwardRequest 1', async () => {
  const port = getPort();
  const controller = new AbortController();
  const handleServerSocketOnConnect = mock.fn(() => {
  });
  const onRequest = mock.fn(() => {
    controller.abort();
  });
  const server = net.createServer(handleServerSocketOnConnect);
  server.listen(port);

  await waitFor(100);

  await forwardRequest({
    signal: controller.signal,
    request: {
      method: 'GET',
      path: '/',
      headers: {},
      headersRaw: [],
    },
  }, {
    port,
    onRequest,
  });
  assert.equal(onRequest.mock.calls.length, 0);
  await waitFor(100);
  assert.equal(handleServerSocketOnConnect.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 1);
  assert.deepEqual(
    onRequest.mock.calls[0].arguments[0].headers,
    ['Host', `127.0.0.1:${port}`],
  );

  await waitFor(100);
  server.close();

});

test('forwardRequest 2', async () => {
  const port = getPort();
  const controller = new AbortController();
  const handleServerSocketOnConnect = mock.fn(() => {
  });
  const onRequest = mock.fn(() => {
    controller.abort();
  });
  const server = net.createServer(handleServerSocketOnConnect);
  server.listen(port);

  await waitFor(100);

  await forwardRequest({
    signal: controller.signal,
    request: {
      method: 'GET',
      path: '/',
      headers: {},
      headersRaw: [],
    },
  }, {
    port,
    remoteAddress: '192.168.0.100',
    headers: {
      Host: '192.168.0.111:4444',
    },
    onRequest,
  });
  await waitFor(100);
  assert.equal(handleServerSocketOnConnect.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 1);
  assert.deepEqual(
    onRequest.mock.calls[0].arguments[0].headers,
    ['Host', '192.168.0.111:4444', 'X-Remote-Address', '192.168.0.100'],
  );

  await waitFor(100);
  server.close();

});
