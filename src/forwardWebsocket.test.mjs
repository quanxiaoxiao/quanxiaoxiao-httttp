import { mock, test } from 'node:test';
import assert from 'node:assert';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import forwardWebsocket from './forwardWebsocket.mjs';

const _getPort = () => {
  let _port = 5850;
  return () => {
    const port = _port;
    _port += 1;
    return port;
  };
};

const waitFor = async (t = 100) => {
  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, t);
  });
};

const getPort = _getPort();

test('forwardWebsocket 1', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    setTimeout(() => {
      socket.destroy();
    }, 100);
  });

  server.listen(port);

  const onForwardConnect = mock.fn(() => {});
  const onHttpResponseEnd = mock.fn((ctx) => {
    assert.equal(typeof ctx.requestForward.timeOnRequestSend, 'number');
    assert.equal(ctx.requestForward.timeOnResponseEnd, null);
    assert.equal(ctx.requestForward.timeOnResponse, null);
    assert(ctx.error instanceof Error);
  });

  const ctx = {
    socket: new PassThrough(),
    request: {
      method: 'GET',
      path: '/aaa',
      body: null,
      headers: {
        name: 'rice',
      },
    },
    requestForward: {
      hostname: '127.0.0.1',
      headers: {
        name: 'quan',
      },
      port,
    },
  };

  forwardWebsocket({
    ctx,
    onForwardConnect,
    onHttpResponseEnd,
  });

  await waitFor(1000);
  assert.equal(onForwardConnect.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  server.close();
});

test('forwardWebsocket 2', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    setTimeout(() => {
      socket.end('HTTP/1.1 200 OK\r\nServer: quan\r\n\r\n');
    }, 100);
  });

  server.listen(port);

  const onForwardConnect = mock.fn(() => {});
  const onHttpResponseEnd = mock.fn((ctx) => {
    assert.equal(ctx.error, null);
    assert.equal(typeof ctx.requestForward.timeOnResponse, 'number');
    assert.equal(typeof ctx.requestForward.timeOnResponse, 'number');
    assert.equal(typeof ctx.requestForward.timeOnResponseEnd, 'number');
  });

  const ctx = {
    socket: new PassThrough(),
    request: {
      method: 'GET',
      path: '/aaa',
      body: null,
      headers: {
        name: 'rice',
      },
    },
    requestForward: {
      hostname: '127.0.0.1',
      headers: {
        name: 'quan',
      },
      port,
    },
  };

  forwardWebsocket({
    ctx,
    onForwardConnect,
    onHttpResponseEnd,
  });

  await waitFor(1000);
  assert.equal(onForwardConnect.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  server.close();
});
