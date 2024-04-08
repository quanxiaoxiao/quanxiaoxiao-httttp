/* eslint no-proto: 0 */
import { mock, test } from 'node:test';
import { PassThrough } from 'node:stream';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert';
import _ from 'lodash';
import { decodeHttpRequest, encodeHttp } from '@quanxiaoxiao/http-utils';
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

test('forwardRequest error', async () => {
  try {
    await forwardRequest({
      ctx: {},
    });
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof assert.AssertionError);
  }
  try {
    await forwardRequest({
      ctx: {
        requestForward: [],
      },
    });
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof assert.AssertionError);
  }
  try {
    await forwardRequest({
      ctx: {
        request: {},
        requestForward: {
          headers: 'aaa',
        },
      },
    });
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof assert.AssertionError);
  }
});

test('forwardRequest headers 1', async () => {
  const onForwardConnecting = mock.fn((ctx) => {
    assert.deepEqual(ctx.requestForward.headers, { name: 'quan' });
    ctx.requestForward.headers = 'xxx';
  });
  const ctx = {
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
      port: 9998,
    },
  };
  const controller = new AbortController();
  try {
    await forwardRequest({
      ctx,
      signal: controller.signal,
      onForwardConnecting,
    });
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof assert.AssertionError);
    assert.equal(onForwardConnecting.mock.calls.length, 1);
  }
});

test('forwardRequest headers 2', async () => {
  const onForwardConnecting = mock.fn((ctx) => {
    assert.deepEqual(ctx.requestForward.headers, { name: 'quan' });
    ctx.requestForward.headers = 'xxx';
  });
  const ctx = {
    request: {
      method: 'GET',
      path: '/aaa',
      body: null,
      _headers: {
        name: 'rice',
      },
    },
    requestForward: {
      hostname: '127.0.0.1',
      headers: {
        name: 'quan',
      },
      port: 9998,
    },
  };
  const controller = new AbortController();
  try {
    await forwardRequest({
      ctx,
      signal: controller.signal,
      onForwardConnecting,
    });
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof assert.AssertionError);
    assert.equal(onForwardConnecting.mock.calls.length, 1);
  }
});

test('forwardRequest headers 3', async () => {
  const onForwardConnecting = mock.fn((ctx) => {
    assert.deepEqual(ctx.requestForward.headers, { name: 'rice' });
    ctx.requestForward.headers = 'xxx';
  });
  const ctx = {
    request: {
      method: 'GET',
      path: '/aaa',
      body: null,
      headers: {
        name: 'quan',
      },
      _headers: {
        name: 'rice',
      },
    },
    requestForward: {
      hostname: '127.0.0.1',
      port: 9998,
    },
  };
  const controller = new AbortController();
  try {
    await forwardRequest({
      ctx,
      signal: controller.signal,
      onForwardConnecting,
    });
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof assert.AssertionError);
    assert.equal(onForwardConnecting.mock.calls.length, 1);
  }
});

test('forwardRequest headers 4', async () => {
  const onForwardConnecting = mock.fn((ctx) => {
    assert.deepEqual(ctx.requestForward.headers, { name: 'rice' });
    ctx.requestForward.headers = 'xxx';
  });
  const ctx = {
    request: {
      method: 'GET',
      path: '/aaa',
      body: null,
      headersRaw: ['foo', 'bar'],
      headers: {
        name: 'quan',
      },
      _headers: {
        name: 'rice',
      },
    },
    requestForward: {
      hostname: '127.0.0.1',
      port: 9998,
    },
  };
  const controller = new AbortController();
  try {
    await forwardRequest({
      ctx,
      signal: controller.signal,
      onForwardConnecting,
    });
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof assert.AssertionError);
    assert.equal(onForwardConnecting.mock.calls.length, 1);
  }
});

test('forwardRequest headers 5', async () => {
  const onForwardConnecting = mock.fn((ctx) => {
    assert.deepEqual(ctx.requestForward.headers, ['foo', 'bar']);
    ctx.requestForward.headers = 'xxx';
  });
  const ctx = {
    request: {
      method: 'GET',
      path: '/aaa',
      body: null,
      headersRaw: ['foo', 'bar'],
      headers: {
        name: 'quan',
      },
    },
    requestForward: {
      hostname: '127.0.0.1',
      port: 9998,
    },
  };
  const controller = new AbortController();
  try {
    await forwardRequest({
      ctx,
      signal: controller.signal,
      onForwardConnecting,
    });
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof assert.AssertionError);
    assert.equal(onForwardConnecting.mock.calls.length, 1);
  }
});

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
    assert.equal(error.isConnect, false);
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
    assert(error.isConnect);
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
    assert(error.isConnect);
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
  const port = getPort();
  const _socket = new PassThrough();
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
  await waitFor(100);
  await forwardRequest({
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
  await waitFor(200);
  assert(ctx.requestForward.onBody.destroyed);
  assert.equal(ctx.response.body, null);
  assert.equal(ctx.response.bytesBody, 11);
  assert.equal(_socket.write.mock.calls.length, 6);
  assert.equal(_socket.write.mock.calls[0].arguments[0].toString(), 'HTTP/1.1 200\r\nTransfer-Encoding: chunked\r\n\r\n');
  assert.equal(_socket.write.mock.calls[1].arguments[0].toString(), '2\r\naa\r\n');
  assert.equal(_socket.write.mock.calls[2].arguments[0].toString(), '3\r\nbbb\r\n');
  assert.equal(_socket.write.mock.calls[3].arguments[0].toString(), '3\r\nccc\r\n');
  assert.equal(_socket.write.mock.calls[4].arguments[0].toString(), '3\r\nddd\r\n');
  assert.equal(_socket.write.mock.calls[5].arguments[0].toString(), '0\r\n\r\n');
  server.close();
});

test('forwardRequest request body with stream', async () => {
  const port = getPort();
  const pathname = path.resolve(process.cwd(), '_temp', 'test_111');
  const ws = fs.createWriteStream(pathname);
  const server = net.createServer((socket) => {
    const decode = decodeHttpRequest({
      onBody: (chunk) => {
        const ret = ws.write(chunk);
        if (ret === false) {
          socket.pause();
        }
      },
    });
    ws.on('drain', () => {
      if (socket.readable && socket.isPaused()) {
        socket.resume();
      }
    });
    socket.on('data', (chunk) => {
      decode(chunk)
        .then((ret) => {
          if (ret.complete) {
            socket.write('HTTP/1.1 200\r\nContent-Length: 2\r\n\r\nok');
            ws.end();
          }
        });
    });
  });

  let isPaused = false;
  const count = 20000;
  const content = 'adsfadsfa dfadsfw';
  let i = 0;

  const handleFinish = mock.fn(() => {});

  ws.on('finish', handleFinish);

  server.listen(port);

  const controller = new AbortController();
  const _socket = new PassThrough();
  const bodyStream = new PassThrough();
  const ctx = {
    socket: _socket,
    request: {
      method: 'POST',
      path: '/aaa',
      body: null,
    },
    requestForward: {
      hostname: '127.0.0.1',
      port,
      protocol: 'http:',
      body: bodyStream,
    },
  };

  const walk = () => {
    while (!isPaused && i < count) {
      const s = `${_.times(800).map(() => content).join('')}:${i}`;
      const ret = bodyStream.write(s);
      if (ret === false) {
        isPaused = true;
      }
      i++;
    }
    if (i >= count && !bodyStream.writableEnded) {
      bodyStream.end();
    }
  };

  bodyStream.on('drain', () => {
    isPaused = false;
    setTimeout(() => {
      walk();
    });
  });

  await forwardRequest({
    signal: controller.signal,
    ctx,
    onForwardConnect: () => {
      setTimeout(() => {
        walk();
      }, 100);
    },
  });

  assert.equal(ctx.response.body.toString(), 'ok');
  assert.equal(ctx.response.statusCode, 200);
  assert.equal(typeof ctx.requestForward.timeOnRequestSend, 'number');
  assert.equal(typeof ctx.requestForward.timeOnResponseEnd, 'number');

  assert(ctx.requestForward.body.destroyed);

  await waitFor(300);
  assert.equal(handleFinish.mock.calls.length, 1);
  server.close();
  const buf = fs.readFileSync(pathname);
  assert(new RegExp(`:${count - 1}$`).test(buf));
  fs.unlinkSync(pathname);
});

test('forwardRequest response onbody with stream', async () => {
  const port = getPort();
  let isPaused = false;
  const count = 6000;
  const content = 'adsfadsfa dfadsfw';
  let i = 0;
  const pathname = path.resolve(process.cwd(), '_temp', 'test_222');
  const ws = fs.createWriteStream(pathname);

  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    const encode = encodeHttp({
      statusCode: 200,
    });
    const walk = () => {
      while (!isPaused && i < count) {
        const s = `${_.times(800).map(() => content).join('')}:${i}`;
        const ret = socket.write(encode(Buffer.from(s)));
        if (ret === false) {
          isPaused = true;
        }
        i++;
      }
      if (i >= count && !socket.writableEnded) {
        socket.end(encode());
      }
    };
    socket.on('drain', () => {
      isPaused = false;
      setTimeout(() => {
        walk();
      });
    });
    setTimeout(() => {
      walk();
    }, 1000);
  });
  server.listen(port);

  await waitFor(100);

  const _socket = new PassThrough();

  const onBody = new PassThrough();

  _socket.pipe(ws);

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
      body: null,
      onBody,
    },
  };

  await forwardRequest({
    ctx,
  });
  await waitFor(100);
  assert(!ws.writableEnded);
  assert(!_socket.destroyed);
  assert(!_socket.writableEnded);
  ws.end();
  await waitFor(200);
  server.close();
  const buf = fs.readFileSync(pathname);
  fs.unlinkSync(pathname);
  assert(new RegExp(`:${count - 1}\r\n0\r\n\r\n$`).test(buf.toString()));
});

test('forwardRequest response onbody with stream, server socket close', async () => {
  const port = getPort();
  let isPaused = false;
  const count = 20000;
  const content = 'adsfadsfa dfadsfw';
  let i = 0;
  const pathname = path.resolve(process.cwd(), '_temp', 'test_3333');
  const ws = fs.createWriteStream(pathname);

  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    const encode = encodeHttp({
      statusCode: 200,
    });
    const walk = () => {
      while (!isPaused && i < count) {
        const s = `${_.times(800).map(() => content).join('')}:${i}`;
        const ret = socket.write(encode(Buffer.from(s)));
        if (ret === false) {
          isPaused = true;
        }
        i++;
      }
      if (i >= count && !socket.destroyed) {
        setTimeout(() => {
          if (!socket.destroyed) {
            socket.destroy();
          }
        }, 1000);
      }
    };
    socket.on('drain', () => {
      isPaused = false;
      setTimeout(() => {
        walk();
      });
    });
    setTimeout(() => {
      walk();
    }, 100);
  });
  server.listen(port);

  const _socket = new PassThrough();

  _socket.pipe(ws);

  const onBody = new PassThrough();

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
      body: null,
      onBody,
    },
  };
  const controller = new AbortController();
  try {
    await forwardRequest({
      signal: controller.signal,
      ctx,
    });
    throw new Error('xxx');
  } catch (error) {
    assert(error.isConnect);
    assert(!ws.writableEnded);
    ws.end();
  }
  await waitFor(100);
  server.close();
  fs.unlinkSync(pathname);
});

test('forwardRequest request body with stream, server socket close', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    let i = 0;
    const decode = decodeHttpRequest({
      onBody: () => {
        i++;
      },
    });
    socket.on('data', (chunk) => {
      decode(chunk)
        .then(() => {
          if (i >= 20000) {
            if (!socket.destroyed) {
              socket.destroy();
            }
          }
        });
    });
  });

  let isPaused = false;
  let i = 0;
  const content = 'adsfadsfa dfadsfw';

  server.listen(port);

  const controller = new AbortController();
  const _socket = new PassThrough();
  const bodyStream = new PassThrough();
  const ctx = {
    socket: _socket,
    request: {
      method: 'POST',
      path: '/aaa',
      body: null,
    },
    requestForward: {
      hostname: '127.0.0.1',
      port,
      protocol: 'http:',
      body: bodyStream,
    },
  };

  const walk = () => {
    while (!isPaused) {
      const s = `${_.times(800).map(() => content).join('')}:${i}`;
      const ret = bodyStream.write(s);
      if (ret === false) {
        isPaused = true;
      }
      i++;
    }
  };

  bodyStream.on('drain', () => {
    isPaused = false;
    setTimeout(() => {
      walk();
    });
  });

  try {
    await forwardRequest({
      signal: controller.signal,
      ctx,
      onForwardConnect: () => {
        setTimeout(() => {
          walk();
        }, 100);
      },
    });
    throw new Error('xxx');
  } catch (error) {
    assert(error.message !== 'xxx');
  }

  await waitFor(300);
  assert(bodyStream.destroyed);

  server.close();
});
