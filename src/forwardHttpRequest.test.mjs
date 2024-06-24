import { mock, test } from 'node:test';
import net from 'node:net';
import assert from 'node:assert';
import { DoAbortError } from '@quanxiaoxiao/http-request';
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

test('forwardRequest 1', async () => {
  const port = getPort();
  const onRequestSocketData = mock.fn(() => {});
  const onFail = mock.fn(() => {});
  const onSuccess = mock.fn(() => {});
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
  })
    .then(
      onSuccess,
      onFail,
    );
  await waitFor(1000);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onRequestSocketData.mock.calls.length, 1);
  assert.equal(onRequestSocketClose.mock.calls.length, 0);
  assert.equal(
    onRequestSocketData.mock.calls[0].arguments[0].toString(),
    'GET / HTTP/1.1\r\nContent-Length: 0\r\n\r\n',
  );
  await waitFor(500);
  assert.equal(onFail.mock.calls.length, 0);
  controller.abort();
  await waitFor(100);
  assert.equal(onFail.mock.calls.length, 1);
  assert.equal(onSuccess.mock.calls.length, 0);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  assert(onFail.mock.calls[0].arguments[0] instanceof DoAbortError);
  assert.deepEqual(
    ctx.response,
    {
      httpVersion: null,
      statusCode: null,
      statusText: null,
      headers: {},
      headersRaw: [],
      body: null,
    },
  );
  server.close();
});

test('forwardRequest 2', async () => {
  const port = getPort();
  const onRequestSocketData = mock.fn(() => {});
  const onFail = mock.fn(() => {});
  const onSuccess = mock.fn(() => {});
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
  })
    .then(
      onSuccess,
      onFail,
    );
  await waitFor(1000);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  assert.equal(onSuccess.mock.calls.length, 1);
  assert.equal(onFail.mock.calls.length, 0);
  assert.equal(ctx.response.statusCode, 200);
  assert.deepEqual(ctx.response.headers, {
    name: 'quan',
    'content-length': 2,
  });
  assert.deepEqual(ctx.response.headersRaw, ['name', 'quan', 'Content-Length', '2']);
  assert.equal(ctx.response.body.toString(), 'ok');
  server.close();
});
