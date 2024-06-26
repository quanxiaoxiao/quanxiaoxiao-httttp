import { mock, test } from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import assert from 'node:assert';
import _ from 'lodash';
import {
  encodeHttp,
  decodeHttpRequest,
} from '@quanxiaoxiao/http-utils';
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

test('forwardHttpRequest request body invalid', () => {
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

test('forwardHttpRequest unable connect server',  async () => {
  const ctx = {};
  try {
    await forwardHttpRequest({
      ctx,
      options: {
        port: 9999,
      },
    });
  } catch (error) {
    assert.equal(error, ctx.error);
    assert.equal(ctx.error.statusCode, 502);
  }
});

test('forwardHttpRequest 1',  async () => {
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
  setTimeout(() => {
    controller.abort();
  }, 500);
  try {
    await forwardHttpRequest({
      signal: controller.signal,
      ctx,
      options: {
        port,
      },
    });
  } catch (error) {
    assert.equal(error, ctx.error);
    assert.equal(onConnect.mock.calls.length, 1);
    assert.equal(onRequestSocketData.mock.calls.length, 1);
    assert.equal(onRequestSocketClose.mock.calls.length, 0);
    assert.equal(
      onRequestSocketData.mock.calls[0].arguments[0].toString(),
      'GET / HTTP/1.1\r\nContent-Length: 0\r\n\r\n',
    );
    assert.equal(ctx.response.statusCode, null);
    assert.equal(ctx.response.statusText, null);
    assert.deepEqual(ctx.response.headers, {});
    assert.deepEqual(ctx.response.headersRaw, []);
    await waitFor(100);
    assert.equal(onRequestSocketClose.mock.calls.length, 1);
  }
  server.close();
});

test('forwardHttpRequest 2',  async () => {
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
  await forwardHttpRequest({
    ctx,
    options: {
      port,
      onRequest,
    },
  });
  assert.equal(ctx.response.statusCode, 200);
  assert.deepEqual(ctx.response.headers, {
    name: 'quan',
    'content-length': 2,
  });
  assert.deepEqual(ctx.response.headersRaw, ['name', 'quan', 'Content-Length', '2']);
  assert.equal(ctx.response.body.toString(), 'ok');
  await waitFor(100);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  server.close();
});

test('forwardHttpRequest request body 1',  async () => {
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
  await forwardHttpRequest({
    ctx,
    options: {
      path: '/test',
      port,
      body: 'aaa',
    },
  });
  assert.equal(onRequestSocketData.mock.calls.length, 1);
  assert.equal(ctx.response.headers['transfer-encoding'], 'chunked');
  assert.equal(
    onRequestSocketData.mock.calls[0].arguments[0].toString(),
    'GET /test HTTP/1.1\r\nContent-Length: 3\r\n\r\naaa',
  );
  assert.equal(ctx.response.statusCode, 200);
  assert.equal(ctx.response.body.toString(), 'ccc');
  await waitFor(100);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  server.close();
});

test('forwardHttpRequest request body 2',  async () => {
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
  await forwardHttpRequest({
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
  assert.equal(onRequestSocketData.mock.calls.length, 1);
  assert.equal(
    onRequestSocketData.mock.calls[0].arguments[0].toString(),
    'GET /test HTTP/1.1\r\nname: foo\r\nContent-Length: 3\r\n\r\naaa',
  );
  assert.equal(ctx.response.statusCode, 200);
  await waitFor(100);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  server.close();
});

test('forwardHttpRequest request body 3',  async () => {
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
  setTimeout(() => {
    requestBodyStream.write('aa');
  }, 100);
  setTimeout(() => {
    requestBodyStream.write('bbbb');
  }, 150);
  await forwardHttpRequest({
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
  assert.equal(onRequestSocketData.mock.calls.length, 3);
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
  await waitFor(100);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  server.close();
});

test('forwardHttpRequest request body 4',  async () => {
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
  try {
    setTimeout(() => {
      requestBodyStream.write('aa');
    }, 100);
    setTimeout(() => {
      requestBodyStream.write('bbbb');
    }, 150);
    await forwardHttpRequest({
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
  } catch (error) {
    assert.equal(ctx.error, error);
  }
  assert.equal(onRequestSocketData.mock.calls.length, 2);
  assert.equal(
    onRequestSocketData.mock.calls[0].arguments[0].toString(),
    'GET /test HTTP/1.1\r\nname: foo\r\nContent-Length: 4\r\n\r\n',
  );
  assert.equal(ctx.error.statusCode, 500);
  assert(ctx.error instanceof Error);
  await waitFor(100);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  server.close();
});

test('forwardHttpRequest request body 5',  async () => {
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
  setTimeout(() => {
    requestBodyStream.write('aa');
  }, 100);
  setTimeout(() => {
    requestBodyStream.write('bbbb');
  }, 150);
  setTimeout(() => {
    requestBodyStream.end();
  }, 200);
  await forwardHttpRequest({
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
  assert.equal(onRequestSocketData.mock.calls.length, 4);
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
  await waitFor(100);
  assert.equal(onRequestSocketClose.mock.calls.length, 1);
  server.close();
});

test('forwardHttpRequest request body 6',  async () => {
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
  setTimeout(() => {
    requestBodyStream.write('aa');
  }, 100);
  try {
    await forwardHttpRequest({
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
  } catch (error) {
    assert.equal(ctx.error, error);
  }
  assert(requestBodyStream.destroyed);
  assert.equal(onRequestSocketData.mock.calls.length, 2);
  assert(ctx.error instanceof Error);
  assert.equal(ctx.error.statusCode, 500);
  server.close();
});

test('forwardHttpRequest request body stream backpress',  async () => {
  const port = getPort();
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_ccsdfww_66`);
  const ws = fs.createWriteStream(pathname);
  const server = net.createServer((socket) => {
    ws.on('drain', () => {
      if (socket.isPaused()) {
        socket.resume();
      }
    });
    const decode = decodeHttpRequest({
      onBody: (chunk) => {
        const ret = ws.write(chunk);
        if (!ret) {
          socket.pause();
        }
      },
      onEnd: () => {
        socket.write(encodeHttp({
          statusCode: 200,
          headers: {
            name: 'foo',
          },
          body: 'aaaccc',
        }));
        ws.end();
      },
    });
    socket.on('data', (chunk) => {
      decode(chunk);
    });
  });
  server.listen(port);
  await waitFor(100);
  const ctx = {};
  const requestBodyStream = new PassThrough();
  let isPaused = false;
  let i = 0;
  const count = 3000;
  const content = 'aaaaabbbbbbbbcccccccddddd___adfw';
  const walk = () => {
    while (!isPaused && i < count) {
      const s = `${_.times(800).map(() => content).join('')}:${i}`;
      const ret = requestBodyStream.write(s);
      if (ret === false) {
        isPaused = true;
      }
      i++;
    }
    if (i >= count && !requestBodyStream.writableEnded) {
      setTimeout(() => {
        if (!requestBodyStream.writableEnded) {
          requestBodyStream.end();
        }
      }, 500);
    }
  };
  requestBodyStream.on('drain', () => {
    isPaused = false;
    walk();
  });
  await forwardHttpRequest({
    ctx,
    onRequest: () => {
      walk();
    },
    options: {
      path: '/test',
      headers: {
        name: 'foo',
      },
      port,
      body: requestBodyStream,
    },
  });
  assert(ws.writableEnded);
  assert.equal(ctx.response.statusCode, 200);
  assert.equal(ctx.response.body.toString(), 'aaaccc');
  assert.deepEqual(ctx.response.headers, { name: 'foo', 'content-length': 6 });
  const buf = fs.readFileSync(pathname);
  assert(new RegExp(`:${count - 1}$`).test(buf.toString()));
  fs.unlinkSync(pathname);
  server.close();
});

test('forwardHttpRequest response body stream',  async () => {
  const port = getPort();
  const onRequestSocketData = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', onRequestSocketData);
    const encode = encodeHttp({
      headers: {
        name: 'quan',
        'content-length': 6,
      },
    });
    setTimeout(() => {
      socket.write(encode('aa'));
    }, 100);
    setTimeout(() => {
      socket.write(encode('ccdd'));
    }, 150);
  });
  server.listen(port);
  await waitFor(100);
  const handleCloseOnResponseBodyStream = mock.fn(() => {});
  const handleDataOnResponseBodyStream = mock.fn(() => {});
  const responseBodyStream = new PassThrough();
  responseBodyStream.on('close', handleCloseOnResponseBodyStream);
  responseBodyStream.on('data', handleDataOnResponseBodyStream);
  const ctx = {
    response: {
      body: responseBodyStream,
    },
  };
  await forwardHttpRequest({
    ctx,
    options: {
      path: '/test',
      body: null,
      port,
    },
  });
  assert.equal(ctx.response.body, responseBodyStream);
  assert.equal(responseBodyStream.writableEnded, false);
  assert.equal(handleDataOnResponseBodyStream.mock.calls.length, 0);
  await waitFor(500);
  assert.equal(handleDataOnResponseBodyStream.mock.calls.length, 2);
  assert.equal(handleDataOnResponseBodyStream.mock.calls[0].arguments[0].toString(), 'aa');
  assert.equal(handleDataOnResponseBodyStream.mock.calls[1].arguments[0].toString(), 'ccdd');
  assert.equal(responseBodyStream.writableEnded, true);
  assert.equal(handleCloseOnResponseBodyStream.mock.calls.length, 1);
  server.close();
});

test('forwardHttpRequest response body stream close',  async () => {
  const port = getPort();
  const onRequestSocketData = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', onRequestSocketData);
    const encode = encodeHttp({
      headers: {
        name: 'quan',
        'content-length': 6,
      },
    });
    setTimeout(() => {
      socket.write(encode('aa'));
    }, 100);
  });
  server.listen(port);
  await waitFor(100);
  const handleDataOnResponseBodyStream = mock.fn(() => {});
  const handleCloseOnResponseBodyStream = mock.fn(() => {});
  const responseBodyStream = new PassThrough();
  responseBodyStream.on('close', handleCloseOnResponseBodyStream);
  responseBodyStream.on('data', handleDataOnResponseBodyStream);
  setTimeout(() => {
    responseBodyStream.destroy();
  }, 200);
  const ctx = {
    response: {
      body: responseBodyStream,
    },
  };
  await forwardHttpRequest({
    ctx,
    options: {
      path: '/test',
      body: null,
      port,
    },
  });
  await waitFor(500);
  assert(ctx.error instanceof Error);
  assert.equal(handleCloseOnResponseBodyStream.mock.calls.length, 1);
  server.close();
});

test('forwardHttpRequest response body stream backpress', async () => {
  let isPaused = false;
  let i = 0;
  const count = 3000;
  const content = 'aaaaabbbbbbbbcccccccddddd___adfw';
  const port = getPort();
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_sasdfws_99`);
  const ws = fs.createWriteStream(pathname);
  let isEnd = false;
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    const encode = encodeHttp({
      headers: {
        server: 'quan',
      },
    });
    const walk = () => {
      while (!isPaused && i < count) {
        const s = `${_.times(800).map(() => content).join('')}:${i}`;
        const ret = socket.write(encode(s));
        if (ret === false) {
          isPaused = true;
        }
        i++;
      }
      if (i >= count && !isEnd) {
        setTimeout(() => {
          if (!isEnd) {
            isEnd = true;
            socket.write(encode());
          }
        }, 500);
      }
    };
    socket.on('drain', () => {
      isPaused = false;
      walk();
    });
    setTimeout(() => {
      walk();
    }, 100);
  });
  server.listen(port);
  await waitFor(100);
  const handleCloseOnResponseBodyStream = mock.fn(() => {});
  const responseBodyStream = new PassThrough();
  responseBodyStream.on('close', handleCloseOnResponseBodyStream);
  responseBodyStream.pipe(ws);
  const ctx = {
    response: {
      body: responseBodyStream,
    },
  };
  await forwardHttpRequest({
    ctx,
    options: {
      path: '/test',
      body: 'abc',
      port,
    },
  });
  assert.deepEqual(ctx.response.headers, { server: 'quan', 'transfer-encoding': 'chunked' });
  assert.equal(ctx.response.statusCode, 200);
  assert(!responseBodyStream.writableEnded);
  assert(!ws.writableEnded);
  await waitFor(5000);
  assert(ws.writableEnded);
  assert(responseBodyStream.writableEnded);
  assert(ctx.requestForward.bytesRequestBody, 3);
  const buf = fs.readFileSync(pathname);
  assert(new RegExp(`:${count - 1}$`).test(buf.toString()));
  assert.equal(handleCloseOnResponseBodyStream.mock.calls.length, 1);
  fs.unlinkSync(pathname);
  server.close();
});
