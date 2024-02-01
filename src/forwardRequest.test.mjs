import { mock, test } from 'node:test';
import { PassThrough } from 'node:stream';
import net from 'node:net';
import assert from 'node:assert';
import { errors } from '@quanxiaoxiao/about-net';
import forwardRequest from './forwardRequest.mjs';

const _getPort = () => {
  let _port = 5650;
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

test('forwardRequest unable connect', async () => {
  const controller = new AbortController();
  const ctx = {
    request: {
      method: 'GET',
      path: '/aaa',
      body: null,
    },
    requestForward: {
      hostname: '127.0.0.1',
      port: 9998,
    },
  };
  const onForwardConnect = mock.fn(() => {});
  try {
    await forwardRequest({
      signal: controller.signal,
      ctx,
      onForwardConnect,
    });
    assert.fail();
  } catch (error) {
    assert(error instanceof errors.SocketConnectError);
  }
  assert.equal(onForwardConnect.mock.calls.length, 0);
  await waitFor();
});

test('forwardRequest error close 1', async () => {
  const controller = new AbortController();
  const port = getPort();
  const ctx = {
    request: {
      method: 'GET',
      path: '/aaa',
      body: null,
    },
    requestForward: {
      hostname: '127.0.0.1',
      port,
      protocol: 'http:',
    },
  };
  const onForwardConnect = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      assert.equal(chunk.toString(), 'GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n');
      setTimeout(() => {
        socket.destroy();
      }, 50);
    });
  });
  server.listen(port);
  try {
    await forwardRequest({
      signal: controller.signal,
      ctx,
      onForwardConnect,
    });
  } catch (error) {
    assert(error instanceof errors.SocketCloseError);
  }
  assert.equal(onForwardConnect.mock.calls.length, 1);
  await waitFor(300);
  server.close();
});

test('forwardRequest error close 2', async () => {
  const controller = new AbortController();
  const port = getPort();
  const ctx = {
    request: {
      method: 'GET',
      path: '/aaa',
      body: null,
    },
    requestForward: {
      hostname: '127.0.0.1',
      port,
      protocol: 'http:',
    },
  };
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      assert.equal(chunk.toString(), 'GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n');
      socket.write('HTTP/1.1 200\r\nContent-Length: 3\r\n\r\naa');
      setTimeout(() => {
        socket.destroy();
      }, 50);
    });
  });
  server.listen(port);
  try {
    await forwardRequest({
      signal: controller.signal,
      ctx,
    });
  } catch (error) {
    assert(error instanceof errors.SocketCloseError);
  }
  await waitFor(300);
  server.close();
});

test('forwardRequest', async () => {
  const controller = new AbortController();
  const port = getPort();
  const ctx = {
    request: {
      method: 'GET',
      path: '/aaa',
      body: null,
    },
    requestForward: {
      hostname: '127.0.0.1',
      port,
      protocol: 'http:',
    },
  };
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      assert.equal(chunk.toString(), 'GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n');
      socket.end('HTTP/1.1 206\r\nContent-Length: 3\r\nServer: quan\r\n\r\naaa');
    });
  });
  server.listen(port);
  await forwardRequest({
    signal: controller.signal,
    ctx,
  });
  assert.equal(ctx.requestForward.path, '/aaa');
  assert.equal(ctx.requestForward.method, 'GET');
  assert.equal(ctx.response.statusCode, 206);
  assert.equal(ctx.response.bytesBody, 3);
  assert.equal(ctx.response.body.toString(), 'aaa');
  assert.deepEqual(ctx.response.headers, { 'content-length': 3, server: 'quan' });
  await waitFor(300);
  server.close();
});

test('forwardRequest response body with stream, content is empty', async () => {
  const controller = new AbortController();
  const port = getPort();
  const _socket = new PassThrough();
  mock.method(_socket, 'write');
  const ctx = {
    socket: _socket,
    request: {
      method: 'GET',
      path: '/aaa',
      body: null,
    },
    requestForward: {
      hostname: '127.0.0.1',
      port,
      protocol: 'http:',
      onBody: new PassThrough(),
    },
  };
  const server = net.createServer((socket) => {
    socket.on('data', () => {
      socket.write('HTTP/1.1 200\r\nContent-Length: 0\r\n\r\n');
    });
  });
  server.listen(port);
  await forwardRequest({
    signal: controller.signal,
    ctx,
  });
  assert.equal(ctx.response.headers['content-length'], 0);
  assert(ctx.requestForward.onBody.destroyed);
  assert.equal(ctx.response.body, null);
  assert.equal(ctx.response.bytesBody, 0);
  await waitFor(200);
  server.close();
});

test('forwardRequest response body with stream', async () => {
  const controller = new AbortController();
  const _socket = new PassThrough();
  /*
  const _write = _socket.write;
  _socket.write = (chunk) => _write.call(_socket, chunk);
  */
  mock.method(_socket, 'write');
  const port = getPort();
  const ctx = {
    socket: _socket,
    request: {
      method: 'GET',
      path: '/aaa',
      body: null,
    },
    requestForward: {
      hostname: '127.0.0.1',
      port,
      protocol: 'http:',
      onBody: new PassThrough(),
    },
  };
  const server = net.createServer((socket) => {
    socket.on('data', () => {
      socket.write('HTTP/1.1 200\r\nContent-Length: 11\r\n\r\naa');
    });
    setTimeout(() => {
      socket.write('bbb');
    }, 50);
    setTimeout(() => {
      socket.write('ccc');
    }, 80);
    setTimeout(() => {
      socket.write('ddd');
    }, 100);
  });
  server.listen(port);
  await forwardRequest({
    signal: controller.signal,
    ctx,
  });
  assert(ctx.requestForward.onBody.destroyed);
  assert.equal(ctx.response.body, null);
  assert.equal(ctx.response.bytesBody, 11);
  assert.equal(_socket.write.mock.calls.length, 6);
  assert.equal(_socket.write.mock.calls[0].arguments[0].toString(), 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n');
  assert.equal(_socket.write.mock.calls[1].arguments[0].toString(), '2\r\naa\r\n');
  assert.equal(_socket.write.mock.calls[2].arguments[0].toString(), '3\r\nbbb\r\n');
  assert.equal(_socket.write.mock.calls[3].arguments[0].toString(), '3\r\nccc\r\n');
  assert.equal(_socket.write.mock.calls[4].arguments[0].toString(), '3\r\nddd\r\n');
  assert.equal(_socket.write.mock.calls[5].arguments[0].toString(), '0\r\n\r\n');
  await waitFor(200);
  server.close();
});
