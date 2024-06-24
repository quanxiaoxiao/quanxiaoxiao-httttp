import { mock, test } from 'node:test';
import net from 'node:net';
import assert from 'node:assert';
import { encodeHttp } from '@quanxiaoxiao/http-utils';
import { waitFor } from '@quanxiaoxiao/utils';
import forwardHttpRequest from './forwardHttpRequest.mjs';

const _getPort = () => {
  let _port = 5250;
  return () => {
    const port = _port;
    _port += 1;
    return port;
  };
};

const getPort = _getPort();

test('forwardRequest request body invalid', () => {
  assert.throws(
    () => {
      forwardHttpRequest({
        ctx: {},
        options: {
          body: 33,
          port: 9999,
        },
      });
    },
    (error) => error instanceof assert.AssertionError,
  );

  assert.throws(
    () => {
      forwardHttpRequest({
        ctx: {},
        options: {
          body: {},
          port: 9999,
        },
      });
    },
    (error) => error instanceof assert.AssertionError,
  );

  assert.throws(
    () => {
      forwardHttpRequest({
        ctx: {},
        options: {
          body: false,
          port: 9999,
        },
      });
    },
    (error) => error instanceof assert.AssertionError,
  );

  assert.throws(
    () => {
      forwardHttpRequest({
        ctx: {},
        options: {
          body: [],
          port: 9999,
        },
      });
    },
    (error) => error instanceof assert.AssertionError,
  );
});

test('forwardRequest unable connect server', async () => {
  const ctx = {};
  forwardHttpRequest({
    ctx,
    options: {
      port: 9999,
    },
  });
  await waitFor(1000);
  assert.equal(ctx.response.statusCode, 502);
  assert(ctx.error instanceof Error);
});

test('forwardRequest 1', async () => {
  const port = getPort();
  const onRequestSocketData = mock.fn(() => {});
  const onRequestSocketClose = mock.fn(() => {});
  const onConnect = mock.fn((socket) => {
    socket.on('data', onRequestSocketData);
    socket.on('close', onRequestSocketClose);
  });
  const server = net.createServer(onConnect);
  server.listen(port);
  const controller = new AbortController();
  await waitFor(100);
  const ctx = {};
  forwardHttpRequest({
    signal: controller.signal,
    ctx,
    options: {
      port,
    },
  });
  await waitFor(1000);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onRequestSocketData.mock.calls.length, 1);
  assert.equal(onRequestSocketClose.mock.calls.length, 0);
  assert.equal(
    onRequestSocketData.mock.calls[0].arguments[0].toString(),
    'GET / HTTP/1.1\r\nContent-Length: 0\r\n\r\n',
  );
  await waitFor(500);
  controller.abort();
  await waitFor(100);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  assert.equal(ctx.response.statusCode, null);
  server.close();
});

test('forwardRequest 2', async () => {
  const port = getPort();
  const onRequestSocketData = mock.fn(() => {});
  const onRequestSocketClose = mock.fn(() => {});
  const onConnect = mock.fn((socket) => {
    socket.on('data', onRequestSocketData);
    socket.on('close', onRequestSocketClose);
    setTimeout(() => {
      socket.write(encodeHttp({
        statusCode: 200,
        headers: {
          name: 'quan',
        },
        body: 'ok',
      }));
    }, 100);
  });
  const server = net.createServer(onConnect);
  server.listen(port);
  const onRequest = mock.fn(() => {});
  await waitFor(100);
  const ctx = {};
  forwardHttpRequest({
    ctx,
    options: {
      port,
      onRequest,
    },
  });
  await waitFor(1000);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  assert.equal(ctx.response.statusCode, 200);
  assert.deepEqual(ctx.response.headers, {
    name: 'quan',
    'content-length': 2,
  });
  assert.deepEqual(ctx.response.headersRaw, ['name', 'quan', 'Content-Length', '2']);
  assert.equal(ctx.response.body.toString(), 'ok');
  server.close();
});
