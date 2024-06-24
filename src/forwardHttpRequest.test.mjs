import { mock, test } from 'node:test';
import net from 'node:net';
import { PassThrough } from 'node:stream';
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

test('forwardRequest request body 1', async () => {
  const port = getPort();
  const onRequestSocketData = mock.fn(() => {});
  const onRequestSocketClose = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', onRequestSocketData);
    socket.on('close', onRequestSocketClose);
    const encode = encodeHttp({
      statusCode: 200,
      headers: {
        name: 'quan',
      },
    });
    setTimeout(() => {
      socket.write(Buffer.concat([
        encode('ccc'),
        encode(),
      ]));
    }, 100);
  });
  server.listen(port);
  await waitFor(100);
  const ctx = {};
  forwardHttpRequest({
    ctx,
    options: {
      path: '/test',
      port,
      body: 'aaa',
    },
  });
  await waitFor(1000);
  assert.equal(onRequestSocketData.mock.calls.length, 1);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  assert.equal(ctx.response.headers['transfer-encoding'], 'chunked');
  assert.equal(
    onRequestSocketData.mock.calls[0].arguments[0].toString(),
    'GET /test HTTP/1.1\r\nContent-Length: 3\r\n\r\naaa',
  );
  assert.equal(ctx.response.statusCode, 200);
  assert.equal(ctx.response.body.toString(), 'ccc');
  server.close();
});

test('forwardRequest request body 2', async () => {
  const port = getPort();
  const onRequestSocketData = mock.fn(() => {});
  const onRequestSocketClose = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', onRequestSocketData);
    socket.on('close', onRequestSocketClose);
    setTimeout(() => {
      socket.write(encodeHttp({
        statusCode: 200,
        body: 'ok',
      }));
    }, 100);
  });
  server.listen(port);
  await waitFor(100);
  const ctx = {};
  forwardHttpRequest({
    ctx,
    options: {
      path: '/test',
      headers: {
        name: 'foo',
        'content-length': 8,
      },
      port,
      body: 'aaa',
    },
  });
  await waitFor(1000);
  assert.equal(onRequestSocketData.mock.calls.length, 1);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  assert.equal(
    onRequestSocketData.mock.calls[0].arguments[0].toString(),
    'GET /test HTTP/1.1\r\nname: foo\r\nContent-Length: 3\r\n\r\naaa',
  );
  assert.equal(ctx.response.statusCode, 200);
  server.close();
});

test('forwardRequest request body 3', async () => {
  const port = getPort();
  const onRequestSocketData = mock.fn(() => {});
  const onRequestSocketClose = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', onRequestSocketData);
    socket.on('close', onRequestSocketClose);
    setTimeout(() => {
      socket.write(encodeHttp({
        statusCode: 200,
        body: 'ok',
      }));
    }, 500);
  });
  server.listen(port);
  await waitFor(100);
  const ctx = {};
  const requestBodyStream = new PassThrough();
  forwardHttpRequest({
    ctx,
    options: {
      path: '/test',
      headers: {
        name: 'foo',
        'content-length': 6,
      },
      port,
      body: requestBodyStream,
    },
  });
  await waitFor(100);
  requestBodyStream.write('aa');
  await waitFor(100);
  requestBodyStream.write('bbbb');
  await waitFor(1000);
  assert.equal(onRequestSocketData.mock.calls.length, 3);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  assert.equal(
    onRequestSocketData.mock.calls[0].arguments[0].toString(),
    'GET /test HTTP/1.1\r\nname: foo\r\nContent-Length: 6\r\n\r\n',
  );
  assert.equal(
    onRequestSocketData.mock.calls[1].arguments[0].toString(),
    'aa',
  );
  assert.equal(
    onRequestSocketData.mock.calls[2].arguments[0].toString(),
    'bbbb',
  );
  assert.equal(ctx.response.statusCode, 200);
  assert.equal(ctx.response.body.toString(), 'ok');
  server.close();
});

test('forwardRequest request body 4', async () => {
  const port = getPort();
  const onRequestSocketData = mock.fn(() => {});
  const onRequestSocketClose = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', onRequestSocketData);
    socket.on('close', onRequestSocketClose);
  });
  server.listen(port);
  await waitFor(100);
  const ctx = {};
  const requestBodyStream = new PassThrough();
  forwardHttpRequest({
    ctx,
    options: {
      path: '/test',
      headers: {
        name: 'foo',
        'content-length': 4,
      },
      port,
      body: requestBodyStream,
    },
  });
  await waitFor(100);
  requestBodyStream.write('aa');
  await waitFor(100);
  requestBodyStream.write('bbbb');
  await waitFor(1000);
  assert.equal(onRequestSocketData.mock.calls.length, 2);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  assert.equal(
    onRequestSocketData.mock.calls[0].arguments[0].toString(),
    'GET /test HTTP/1.1\r\nname: foo\r\nContent-Length: 4\r\n\r\n',
  );
  assert.equal(ctx.response.statusCode, 500);
  assert(ctx.error instanceof Error);
  server.close();
});

test('forwardRequest request body 5', async () => {
  const port = getPort();
  const onRequestSocketData = mock.fn(() => {});
  const onRequestSocketClose = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', onRequestSocketData);
    socket.on('close', onRequestSocketClose);
    setTimeout(() => {
      socket.write(encodeHttp({
        statusCode: 200,
        body: 'ok',
      }));
    }, 500);
  });
  server.listen(port);
  await waitFor(100);
  const ctx = {};
  const requestBodyStream = new PassThrough();
  forwardHttpRequest({
    ctx,
    options: {
      path: '/test',
      headers: {
        name: 'foo',
      },
      port,
      body: requestBodyStream,
    },
  });
  await waitFor(100);
  requestBodyStream.write('aa');
  await waitFor(100);
  requestBodyStream.write('bbbb');
  await waitFor(100);
  requestBodyStream.end();
  await waitFor(1000);
  assert.equal(onRequestSocketData.mock.calls.length, 4);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  assert.equal(
    onRequestSocketData.mock.calls[0].arguments[0].toString(),
    'GET /test HTTP/1.1\r\nname: foo\r\nTransfer-Encoding: chunked\r\n\r\n',
  );
  assert.equal(
    onRequestSocketData.mock.calls[1].arguments[0].toString(),
    '2\r\naa\r\n',
  );
  assert.equal(
    onRequestSocketData.mock.calls[2].arguments[0].toString(),
    '4\r\nbbbb\r\n',
  );
  assert.equal(
    onRequestSocketData.mock.calls[3].arguments[0].toString(),
    '0\r\n\r\n',
  );
  assert.equal(ctx.response.statusCode, 200);
  assert.equal(ctx.response.body.toString(), 'ok');
  server.close();
});

test('forwardRequest request body 6', async () => {
  const port = getPort();
  const onRequestSocketData = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', onRequestSocketData);
    setTimeout(() => {
      socket.destroy();
    }, 200);
  });
  server.listen(port);
  await waitFor(100);
  const ctx = {};
  const requestBodyStream = new PassThrough();
  forwardHttpRequest({
    ctx,
    options: {
      path: '/test',
      headers: {
        name: 'foo',
      },
      port,
      body: requestBodyStream,
    },
  });
  await waitFor(100);
  requestBodyStream.write('aa');
  await waitFor(1000);
  assert(requestBodyStream.destroyed);
  assert.equal(onRequestSocketData.mock.calls.length, 2);
  assert(ctx.error instanceof Error);
  assert.equal(ctx.response.statusCode, 500);
  server.close();
});
