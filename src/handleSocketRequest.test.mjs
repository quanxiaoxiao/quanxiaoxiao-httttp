/* eslint no-use-before-define: 0 */
import {
  PassThrough,
  Transform,
  Readable,
} from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { test, mock } from 'node:test';
import process from 'node:process';
import net from 'node:net';
import assert from 'node:assert';
import createError from 'http-errors';
import _ from 'lodash';
import request from '@quanxiaoxiao/http-request';
import { waitFor } from '@quanxiaoxiao/utils';
import { wrapStreamRead } from '@quanxiaoxiao/node-utils';
import {
  encodeHttp,
  decodeHttpRequest,
  decodeHttpResponse,
} from '@quanxiaoxiao/http-utils';
import {
  SocketCloseError,
} from '@quanxiaoxiao/http-request';
import { createConnector } from '@quanxiaoxiao/socket';
import handleSocketRequest from './handleSocketRequest.mjs';

const _getPort = () => {
  let _port = 4450;
  return () => {
    const port = _port;
    _port += 1;
    return port;
  };
};

const getPort = _getPort();

const connect = (port) => {
  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });
  return socket;
};

test('handleSocketRequest 1', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.request.body, null);
    ctx.response = {
      body: 'ok',
    };
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestEnd,
      onHttpError,
    });
  });
  server.listen(port);
  const state = {
    connector: null,
  };
  const onData = mock.fn((chunk) => {
    assert.equal(chunk.toString(), 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok');
  });
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
  await waitFor(500);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  state.connector();
  server.close();
});

test('handleSocketRequest 2', async () => {
  const port = getPort();
  const requestBody = new PassThrough();
  const onHttpRequestStartLine = mock.fn((ctx) => {
    assert.equal(ctx.error, null);
    assert.equal(ctx.response, null);
    assert.equal(ctx.request.path, '/aaa?name=bbb&big=foo');
    assert.equal(ctx.request.method, 'POST');
    assert.equal(ctx.request.querystring, 'name=bbb&big=foo');
    assert.equal(ctx.request.httpVersion, '1.1');
    assert.deepEqual(ctx.request.query, { name: 'bbb', big: 'foo' });
    assert.deepEqual(ctx.request.headers, {});
    assert.deepEqual(ctx.request.headersRaw, []);
  });
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.error, null);
    assert.equal(ctx.response, null);
    assert.equal(ctx.request.body, null);
    assert.deepEqual(ctx.request.headers, { 'content-length': 5, name: 'quan' });
    assert.deepEqual(ctx.request.headersRaw, ['Content-Length', '5', 'Name', 'quan']);
    ctx.request.body = requestBody;
  });
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.response, null);
    assert.equal(ctx.request.body, requestBody);
    assert(ctx.request.body.readableEnded);
    assert(ctx.request.body.writableEnded);
    ctx.response = {
      headers: {
        name: 'quan',
      },
      body: 'aaa',
    };
  });

  const onHttpResponseEnd = mock.fn((ctx) => {
    assert.deepEqual(ctx.response, {
      headers: {
        name: 'quan',
      },
      body: 'aaa',
    });
    assert.equal(ctx.request.method, 'POST');
    assert.equal(ctx.error, null);
  });

  const onHttpError = mock.fn(() => { });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestStartLine,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpRequestEnd,
      onHttpError,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1.1 200/.test(chunk.toString()));
  });
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('POST /aaa?name=bbb&big=foo HTTP/1.1\r\n'));
  state.connector.write(Buffer.from('Content-Length: 5\r\nName: quan\r\n\r\n'));
  state.connector.write(Buffer.from('abcde'));
  const handleRequestBodyOnData = mock.fn(() => {});
  const handleRequestBodyOnEnd = mock.fn(() => {});
  await waitFor(200);
  assert.equal(onHttpRequestStartLine.mock.calls.length, 1);
  assert.equal(onHttpRequestHeader.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  assert(!requestBody.readableEnded);
  assert(!requestBody.writableEnded);
  assert(requestBody.destroyed);
  requestBody.on('data', handleRequestBodyOnData);
  requestBody.on('end', handleRequestBodyOnEnd);
  await waitFor(200);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 1);
  state.connector();
  server.close();
});

test('handleSocketRequest request.body stream 1', async () => {
  const port = getPort();
  const requestBodyStream = new PassThrough();
  const handleDataOnRequestBodyStream = mock.fn(() => {});
  const onHttpError = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.request.body, null);
    ctx.request.body = requestBodyStream;
  });
  const onHttpRequestEnd = mock.fn((ctx) => {
    ctx.response = {
      data: {
        name: 'quan',
      },
    };
    process.nextTick(() => {
      assert.equal(ctx.request.body.writableEnded, true);
    });
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpRequestEnd,
      onHttpError,
    });
  });
  server.listen(port);
  await waitFor(100);
  const state = {
    connector: null,
  };
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  state.connector.write(Buffer.from('GET /POST HTTP/1.1\r\nContent-Length: 6\r\nName: quan\r\n\r\nb'));
  await waitFor(100);
  assert.equal(onHttpRequestHeader.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 0);
  await waitFor(100);
  state.connector.write(Buffer.from('33322'));
  await waitFor(100);
  assert.equal(requestBodyStream.writableEnded, true);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  requestBodyStream.on('data', handleDataOnRequestBodyStream);
  await waitFor(100);
  assert.equal(handleDataOnRequestBodyStream.mock.calls.length, 2);
  assert.equal(handleDataOnRequestBodyStream.mock.calls[0].arguments[0].toString(), 'b');
  assert.equal(handleDataOnRequestBodyStream.mock.calls[1].arguments[0].toString(), '33322');
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  await waitFor(1000);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  state.connector();
  server.close();
});

test('handleSocketRequest request.body set invalid', async () => {
  const port = getPort();
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.request.body, null);
    ctx.request.body = Buffer.from('aaa');
  });
  const onHttpRequestEnd = mock.fn(() => {});
  const onHttpResponse = mock.fn(() => {});
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.response.statusCode, 500);
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpRequestEnd,
      onHttpError,
      onHttpResponse,
    });
  });
  server.listen(port);
  await waitFor(100);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  await waitFor(100);
  connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nContent-Length: 3\r\n\r\naaa'));
  await waitFor(1000);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onHttpResponse.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert(/^HTTP\/1\.1 500/.test(onData.mock.calls[0].arguments[0].toString()));
  connector();
  server.close();
});

test('handleSocketRequest request.body stream content-length exceed', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpRequestEnd = mock.fn(() => {});
  const onHttpResponse = mock.fn(() => {});
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestEnd,
      onHttpResponse,
      onHttpError,
    });
  });
  server.listen(port);
  await waitFor(100);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  await waitFor(100);
  connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 4\r\n\r\naa'));
  await waitFor(1000);
  connector.write(Buffer.from('bbcbb'));
  await waitFor(1000);
  assert.equal(onData.mock.calls.length, 1);
  assert(/^HTTP\/1.1 400/.test(onData.mock.calls[0].arguments[0].toString()));
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  assert.equal(onHttpResponse.mock.calls.length, 0);
  server.close();
  connector();
});

test('handleSocketRequest request.body stream 2', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpRequestEnd = mock.fn(async (ctx) => {
    assert(ctx.request.body instanceof Readable);
    ctx.request.dataBuf = Buffer.from([]);
    wrapStreamRead({
      signal: ctx.signal,
      stream: ctx.request.body,
      onData: (chunk) => {
        ctx.request.dataBuf = Buffer.concat([ctx.request.dataBuf, chunk]);
      },
      onEnd: () => {},
    });
  });
  const onHttpResponse = mock.fn((ctx) => {
    assert.equal(ctx.request.dataBuf.toString(), 'aabbceea');
    ctx.response = {
      body: 'ok',
    };
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestEnd,
      onHttpResponse,
      onHttpError,
    });
  });
  server.listen(port);
  await waitFor(100);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  await waitFor(100);
  connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 8\r\n\r\naa'));
  await waitFor(1000);
  connector.write(Buffer.from('bbc'));
  await waitFor(1000);
  connector.write(Buffer.from('eea'));
  await waitFor(1000);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(
    onData.mock.calls[0].arguments[0].toString(),
    'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok',
  );
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  assert.equal(onHttpResponse.mock.calls.length, 1);
  server.close();
  connector();
});

test('handleSocketRequest request.body stream 3', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn(async (ctx) => {
    const pass = new PassThrough();
    ctx.request.body = pass;
    ctx.request.dataBuf = Buffer.from([]);
    wrapStreamRead({
      signal: ctx.signal,
      stream: ctx.request.body,
      onData: (chunk) => {
        ctx.request.dataBuf = Buffer.concat([ctx.request.dataBuf, chunk]);
      },
      onEnd: () => {},
    });
  });
  const onHttpResponse = mock.fn((ctx) => {
    assert.equal(ctx.request.dataBuf.toString(), 'aabbceea');
    ctx.response = {
      body: 'ok',
    };
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpResponse,
      onHttpError,
    });
  });
  server.listen(port);
  await waitFor(100);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  await waitFor(100);
  connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 8\r\n\r\naa'));
  await waitFor(1000);
  connector.write(Buffer.from('bbc'));
  await waitFor(1000);
  connector.write(Buffer.from('eea'));
  await waitFor(1000);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(
    onData.mock.calls[0].arguments[0].toString(),
    'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok',
  );
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onHttpResponse.mock.calls.length, 1);
  server.close();
  connector();
});

test('handleSocketRequest request.body stream backpress', async () => {
  const port = getPort();
  const requestBodyStream = new PassThrough();
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_ssdfw_666`);
  const count = 3000;
  const content = '335567as aabvxd';
  let i = 0;
  let isPaused = false;
  const onHttpError = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.request.body, null);
    ctx.request.body = requestBodyStream;
    const ws = fs.createWriteStream(pathname);
    ctx.request.body.pipe(ws);
  });
  const onHttpResponse = mock.fn((ctx) => {
    ctx.response = {
      body: 'ok',
    };
    assert.equal(ctx.request.body.writableEnded, true);
    fs.unlinkSync(pathname);
  });
  const onHttpRequestEnd = mock.fn(() => {});

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpRequestEnd,
      onHttpError,
      onHttpResponse,
    });
  });
  server.listen(port);
  await waitFor(100);
  const state = {
    connector: null,
    isEnd: false,
    encode: encodeHttp({
      method: 'POST',
      path: '/aaa',
      headers: {
        name: 'quan',
      },
    }),
  };
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const walk = () => {
    while (!isPaused && i < count) {
      const s = `${_.times(800).map(() => content).join('')}:${i}`;
      const ret = state.connector.write(state.encode(s));
      if (ret === false) {
        isPaused = true;
      }
      i++;
    }
    if (i >= count && !state.isEnd) {
      state.isEnd = true;
      setTimeout(() => {
        state.connector.write(state.encode());
      }, 500);
    }
  };
  const onDrain = mock.fn(() => {
    isPaused = false;
    walk();
  });
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
      onDrain,
    },
    () => connect(port),
  );
  setTimeout(() => {
    walk();
  }, 100);
  await waitFor(5000);
  assert(onDrain.mock.calls.length > 0);
  assert(onHttpRequestEnd.mock.calls.length, 1);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onData.mock.calls[0].arguments[0].toString(), 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok');
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onHttpResponse.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(requestBodyStream.eventNames().includes('data'), false);
  assert(requestBodyStream.destroyed);
  state.connector();
  server.close();
});

test('handleSocketRequest request.body stream close error', async () => {
  const port = getPort();
  const requestBody = new PassThrough();
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.request.body = requestBody;

    setTimeout(() => {
      assert(ctx.request.body.eventNames().includes('close'));
      assert(ctx.request.body.eventNames().includes('drain'));
    }, 100);

    setTimeout(() => {
      assert(!requestBody.destroyed);
      requestBody.destroy();
    }, 200);
  });
  const onHttpRequestEnd = mock.fn(() => {});
  const onHttpResponseEnd = mock.fn(() => {});
  const onHttpError = mock.fn((ctx) => {
    assert(!ctx.request.body.eventNames().includes('close'));
    assert(!ctx.request.body.eventNames().includes('drain'));
  });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpRequestEnd,
      onHttpError,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1.1 500/.test(chunk.toString()));
  });
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('POST /aaa?name=bbb&big=foo HTTP/1.1\r\n'));
  state.connector.write(Buffer.from('Content-Length: 8\r\nName: quan\r\n\r\n'));
  state.connector.write(Buffer.from('ab'));
  await waitFor(100);
  state.connector.write(Buffer.from('bbb'));
  assert.equal(onData.mock.calls.length, 0);
  await waitFor(300);
  assert.equal(onHttpRequestHeader.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 0);
  assert.equal(onHttpError.mock.calls.length, 1);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  server.close();
});

test('handleSocketRequest request chunk invalid', async () => {
  const port = getPort();
  const requestBody = new PassThrough();
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.request.body = requestBody;
  });
  const onHttpRequestEnd = mock.fn(() => {});
  const onHttpResponseEnd = mock.fn(() => {});
  const onHttpError = mock.fn(() => { });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpRequestEnd,
      onHttpError,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('POST /aaa?name=bbb&big=foo HTTP/1.1\r\n'));
  state.connector.write(Buffer.from('Content-Length: 5\r\nName: quan\r\n\r\n'));
  state.connector.write(Buffer.from('abcdef'));
  await waitFor(300);
  assert.equal(onHttpRequestHeader.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 1);
  assert(/^HTTP\/1.1 400/.test(onData.mock.calls[0].arguments[0].toString()));
  assert(requestBody.destroyed);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  server.close();
});

test('handleSocketRequest request chunk invalid 2', async () => {
  const port = getPort();
  const onHttpResponseEnd = mock.fn(() => {});
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.response.statusCode, 400);
  });
  const onHttpRequest = mock.fn(() => {});
  const onHttpRequestStartLine = mock.fn(() => {});

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequest,
      onHttpRequestStartLine,
      onHttpResponseEnd,
      onHttpError,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1.1 400/.test(chunk.toString()));
  });
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  state.connector.write(Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\naa'));
  await waitFor(300);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onHttpRequest.mock.calls.length, 1);
  assert.equal(onHttpRequestStartLine.mock.calls.length, 0);
  assert.equal(onHttpError.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  server.close();
});

test('handleSocketRequest onHttpRequestStartLine trigger error', async () => {
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.response.statusCode, 500);
    assert.equal(ctx.error.message, 'xxx');
  });
  const onHttpRequestHeader = mock.fn(() => {});
  const onHttpRequestStartLine = mock.fn(async (ctx) => {
    assert.equal(ctx.request.path, '/aaa');
    await waitFor(100);
    throw new Error('xxx');
  });
  const port = getPort();
  const onHttpResponseEnd = mock.fn(() => {});

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestStartLine,
      onHttpResponseEnd,
      onHttpRequestHeader,
      onHttpError,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };
  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1\.1 500/.test(chunk.toString()));
  });
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  state.connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nContent-Length: 2\r\n\r\naa'));
  await waitFor(400);
  assert.equal(onHttpError.mock.calls.length, 1);
  assert.equal(onHttpRequestStartLine.mock.calls.length, 1);
  assert.equal(onHttpRequestHeader.mock.calls.length, 0);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  server.close();
});

test('handleSocketRequest onHttpRequestStartLine wait as socket close', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpRequestStartLine = mock.fn(async (ctx) => {
    assert.equal(ctx.request.path, '/aaa');
    assert.equal(ctx.request.method, 'POST');
    setTimeout(() => {
      ctx.socket.destroy();
    }, 100);
    await waitFor(300);
  });
  const onHttpRequestHeader = mock.fn(() => {});
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestStartLine,
      onHttpRequestHeader,
      onHttpError,
    });
  });
  server.listen(port);
  const state = {
    connector: null,
  };
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  state.connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nContent-Length: 2\r\n\r\naa'));
  await waitFor(500);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onHttpRequestStartLine.mock.calls.length, 1);
  assert.equal(onHttpRequestHeader.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 0);
  server.close();
});

test('handleSocketRequest ctx.response.body string', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpResponse = mock.fn((ctx) => {
    ctx.response = {
      body: 'ok',
    };
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponse,
      onHttpError,
    });
  });
  server.listen(port);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
  await waitFor(500);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(
    onData.mock.calls[0].arguments[0].toString(),
    'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok',
  );
  connector();
  server.close();
});

test('handleSocketRequest ctx.response.body null', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpResponse = mock.fn((ctx) => {
    ctx.response = {
      body: null,
    };
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponse,
      onHttpError,
    });
  });
  server.listen(port);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
  await waitFor(500);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(
    onData.mock.calls[0].arguments[0].toString(),
    'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n',
  );
  connector();
  server.close();
});

test('handleSocketRequest ctx.response.data 1', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpResponse = mock.fn((ctx) => {
    ctx.response = {
      data: { name: 'quan' },
    };
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponse,
      onHttpError,
    });
  });
  server.listen(port);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
  await waitFor(500);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(
    onData.mock.calls[0].arguments[0].toString(),
    'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 15\r\n\r\n{"name":"quan"}',
  );
  connector();
  server.close();
});

test('handleSocketRequest ctx.response.data 2', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpResponse = mock.fn((ctx) => {
    ctx.response = {
      body: 'aaa',
      data: { name: 'quan' },
    };
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponse,
      onHttpError,
    });
  });
  server.listen(port);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
  await waitFor(500);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(
    onData.mock.calls[0].arguments[0].toString(),
    'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 15\r\n\r\n{"name":"quan"}',
  );
  connector();
  server.close();
});

test('handleSocketRequest ctx.response.data null', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpResponse = mock.fn((ctx) => {
    ctx.response = {
      body: 'aaa',
      data: null,
    };
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponse,
      onHttpError,
    });
  });
  server.listen(port);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
  await waitFor(500);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(
    onData.mock.calls[0].arguments[0].toString(),
    'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n',
  );
  connector();
  server.close();
});

test('handleSocketRequest ctx.response.body with stream 1', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const responseBodyStream = new PassThrough();
  const onHttpResponse = mock.fn((ctx) => {
    ctx.response = {
      body: responseBodyStream,
    };
    setTimeout(() => {
      responseBodyStream.write(Buffer.from('aaa'));
    }, 20);
    setTimeout(() => {
      responseBodyStream.write(Buffer.from('bbb'));
    }, 40);
    setTimeout(() => {
      responseBodyStream.end();
    }, 100);
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponse,
      onHttpError,
    });
  });
  server.listen(port);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
  await waitFor(1000);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  const encode = encodeHttp({
     headers: {},
  });
  assert.equal(
    Buffer.concat(onData.mock.calls.map((a) => a.arguments[0])).toString(),
    Buffer.concat([
      encode(Buffer.from('aaa')),
      encode(Buffer.from('bbb')),
      encode(),
    ]).toString(),
  );
  connector();
  server.close();
});

test('handleSocketRequest ctx.response.body with stream 3', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const responseBodyStream = new PassThrough();
  const onHttpResponse = mock.fn((ctx) => {
    ctx.response = {
      headers: {
        'Content-Length': 4,
      },
      body: responseBodyStream,
    };
    setTimeout(() => {
      responseBodyStream.write(Buffer.from('aaa'));
    }, 20);
    setTimeout(() => {
      responseBodyStream.write(Buffer.from('bbb'));
    }, 120);
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponse,
      onHttpError,
    });
  });
  server.listen(port);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
  await waitFor(1000);
  assert.equal(onData.mock.calls.length, 2);
  assert(/^HTTP\/1.1 200 OK/.test(onData.mock.calls[0].arguments[0].toString()));
  assert.equal(onData.mock.calls[1].arguments[0].toString(), 'aaa');
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  connector();
  server.close();
});

test('handleSocketRequest ctx.response.body with stream 2', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const responseBodyStream = new PassThrough();
  const onHttpResponse = mock.fn((ctx) => {
    ctx.response = {
      headers: {
        'Content-Length': 6,
      },
      body: responseBodyStream,
    };
    setTimeout(() => {
      responseBodyStream.write(Buffer.from('aaa'));
    }, 20);
    setTimeout(() => {
      responseBodyStream.write(Buffer.from('bbb'));
    }, 40);
    setTimeout(() => {
      responseBodyStream.end();
    }, 100);
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponse,
      onHttpError,
    });
  });
  server.listen(port);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
  await waitFor(1000);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(
    Buffer.concat(onData.mock.calls.map((a) => a.arguments[0])).toString(),
    'HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\naaabbb',
  );
  connector();
  server.close();
});

test('handleSocketRequest ctx.response.body with stream close', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const responseBodyStream = new PassThrough();
  const onHttpResponse = mock.fn((ctx) => {
    ctx.response = {
      body: responseBodyStream,
    };
    setTimeout(() => {
      responseBodyStream.write(Buffer.from('aaa'));
    }, 20);
    setTimeout(() => {
      responseBodyStream.write(Buffer.from('bbb'));
    }, 40);
    setTimeout(() => {
      responseBodyStream.destroy();
    }, 100);
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponse,
      onHttpError,
    });
  });
  server.listen(port);
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
  await waitFor(1000);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  const encode = encodeHttp({
     headers: {},
  });
  assert.equal(
    Buffer.concat(onData.mock.calls.map((a) => a.arguments[0])).toString(),
    Buffer.concat([
      encode(Buffer.from('aaa')),
      encode(Buffer.from('bbb')),
    ]).toString(),
  );
  connector();
  server.close();
});

test('handleSocketRequest ctx.response.body with stream backpress', async () => {
  const port = getPort();
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_ddbw_566`);
  const count = 3000;
  const responseBodyStream = new PassThrough();
  const content = 'asdf asdfasdfawefbbb';
  let i = 0;
  let isPaused = false;
  const walk = () => {
    while (!isPaused && i < count) {
      const s = `${_.times(800).map(() => content).join('')}:${i}`;
      const ret = responseBodyStream.write(s);
      if (ret === false) {
        isPaused = true;
      }
      i++;
    }
    if (i >= count && !responseBodyStream.writableEnded) {
      responseBodyStream.end();
    }
  };
  responseBodyStream.on('drain', () => {
    isPaused = false;
    walk();
  });
  const onHttpResponse = mock.fn((ctx) => {
    ctx.response = {
      headers: {
        Server: 'quan',
      },
      body: responseBodyStream,
    };
    process.nextTick(() => {
      walk();
    });
  });
  const onHttpResponseEnd = mock.fn(() => {});
  const onHttpError = mock.fn(() => {});
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponse,
      onHttpResponseEnd,
      onHttpError,
    });
  });
  server.listen(port);
  await waitFor(100);
  const state = {
    connector: null,
  };
  const ws = fs.createWriteStream(pathname);
  ws.on('drain', () => {
    state.connector.resume();
  });
  const decode = decodeHttpResponse({
    onBody: (chunk) => {
      const ret = ws.write(chunk);
      if (!ret) {
        state.connector.pause();
      }
    },
    onEnd: () => {
      ws.end();
    },
  });
  const onData = mock.fn((chunk) => {
    decode(chunk);
  });
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
  await waitFor(5000);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert(onData.mock.calls.length > 0);
  const buf = fs.readFileSync(pathname);
  assert(new RegExp(`:${count - 1}$`).test(buf.toString()));
  fs.unlinkSync(pathname);
  state.connector();
  server.close();
});

/*
test('handleSocketRequest request forward', { only: true }, async () => {
  const port = getPort();
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.request.body = new PassThrough();
  });
  const onHttpError = mock.fn(() => {});
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpError,
    });
  });
  server.listen(port);
  await waitFor(1000);
  server.close();
});
*/

/*
test('handleSocketRequest ctx.onRequest with request body, bind at onHttpRequestHeader', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpResponseEnd = mock.fn(() => {});
  const onRequest = mock.fn((ctx) => {
    assert.equal(ctx.response, null);
    assert.equal(ctx.request.body.toString(), 'aabbcc');
    assert.equal(onHttpResponseEnd.mock.calls.length, 0);
    ctx.response = {
      headers: {
        name: 'quan',
      },
      body: 'aaa',
    };
  });

  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.onRequest = onRequest;
  });
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.response, null);
    assert.equal(typeof ctx.onRequest, 'function');
    assert.equal(ctx.request.body.toString(), 'aabbcc');
    assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpRequestEnd,
      onHttpError,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onConnect = mock.fn(() => {
    state.connector.write(Buffer.from('POST /aaa?name=bbb&big=foo HTTP/1.1\r\nContent-Length: 6\r\n\r\n'));
    state.connector.write(Buffer.from('aa'));
    setTimeout(() => {
      state.connector.write(Buffer.from('bb'));
    }, 20);
    setTimeout(() => {
      state.connector.write(Buffer.from('cc'));
    }, 30);
  });
  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1\.1 200/.test(chunk.toString()));
  });
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onConnect,
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  await waitFor(1500);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  state.connector();
  server.close();
});

test('handleSocketRequest ctx.onRequest  with request body, unbind response 503', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onRequest = mock.fn((ctx) => {
    assert.equal(ctx.request.body.toString(), 'aabbcc');
  });

  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.onRequest = onRequest;
  });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpError,
    });
  });
  server.listen(port);
  const socket = net.Socket();
  socket.connect({
    port,
  });

  const state = {
    connector: null,
  };

  const onConnect = mock.fn(() => {
    state.connector.write(Buffer.from('POST /aaa?name=bbb&big=foo HTTP/1.1\r\nContent-Length: 6\r\n\r\n'));
    state.connector.write(Buffer.from('aa'));
    setTimeout(() => {
      state.connector.write(Buffer.from('bb'));
    }, 20);
    setTimeout(() => {
      state.connector.write(Buffer.from('cc'));
    }, 30);
  });
  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1\.1 503/.test(chunk.toString()));
  });
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onConnect,
      onData,
      onClose,
      onError,
    },
    () => socket,
  );

  await waitFor(400);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 1);
  server.close();
});

test('handleSocketRequest request with no body ctx.onRequest', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const handleDataOnRequestBody = mock.fn(() => {
  });
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.response, null);
  });
  const onHttpResponseEnd = mock.fn(() => {
  });

  const pass = new PassThrough();

  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.request.body = pass;
  });

  pass.on('data', handleDataOnRequestBody);

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpError,
      onHttpRequestEnd,
      onHttpResponseEnd,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn(() => {});

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {
  });

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nName: quan\r\n\r\n\r\naaa'));
  await waitFor(200);
  state.connector.write(Buffer.from('ccc'));

  await waitFor(1000);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 0);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onHttpRequestHeader.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  assert.equal(onHttpRequestEnd.mock.calls.length, 0);
  assert.equal(handleDataOnRequestBody.mock.calls.length, 2);
  assert.equal(handleDataOnRequestBody.mock.calls[0].arguments[0].toString(), '\r\naaa');
  assert.equal(handleDataOnRequestBody.mock.calls[1].arguments[0].toString(), 'ccc');
  state.connector();
  server.close();
});

test('handleSocketRequest request with no body, error with onHttpRequestEnd set ctx.onRequest', async () => {
  const port = getPort();
  const onRequest = mock.fn(() => {});
  const onHttpError = mock.fn(() => {});
  const onHttpRequestEnd = mock.fn((ctx) => {
    ctx.onRequest = onRequest;
  });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpError,
      onHttpRequestEnd,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1\.1 500/.test(chunk.toString()));
  });

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 0\r\n\r\n'));

  await waitFor(1000);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  state.connector();
  server.close();
});

test('handleSocketRequest request with body, error with onHttpRequestEnd set ctx.onRequest', async () => {
  const port = getPort();
  const requestBody = new PassThrough();
  const onRequest = mock.fn(() => {});
  const onHttpError = mock.fn(() => {});
  const handleDataOnRequestBody = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.request.body = requestBody;
  });
  const onHttpRequestEnd = mock.fn((ctx) => {
    ctx.onRequest = onRequest;
  });

  requestBody.on('data', handleDataOnRequestBody);

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpError,
      onHttpRequestEnd,
      onHttpRequestHeader,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1\.1 500/.test(chunk.toString()));
  });

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {
  });

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 3\r\n\r\nabc'));

  await waitFor(1000);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 0);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  state.connector();
  server.close();
});

test('handleSocketRequest request with no body', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.request.body, null);
  });
  const onHttpResponseEnd = mock.fn(() => {});

  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.request.pathname, '/aaa');
  });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpError,
      onHttpRequestEnd,
      onHttpResponseEnd,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1\.1 503/.test(chunk.toString()));
  });

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 0\r\n\r\n'));

  await waitFor(1000);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 1);
  assert.equal(onHttpRequestHeader.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  server.close();
});

test('handleSocketRequest request with no body, onHttpRequestEnd set response', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.response, null);
    ctx.response = {
      headers: {
        server: 'quan',
      },
      body: Buffer.from('abc'),
    };
  });
  const onHttpResponseEnd = mock.fn(() => {});

  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.request.pathname, '/aaa');
  });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpError,
      onHttpRequestEnd,
      onHttpResponseEnd,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1\.1 200/.test(chunk.toString()));
  });

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 0\r\n\r\n'));

  await waitFor(1000);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  state.connector();
  await waitFor(500);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  server.close();
});

test('handleSocketRequest onHttpRequest trigger error', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpRequestEnd = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn(() => {});
  const onHttpRequest = mock.fn(() => {
    throw createError(403);
  });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequest,
      onHttpRequestHeader,
      onHttpError,
      onHttpRequestEnd,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1\.1 403/.test(chunk.toString()));
  });

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nName: quan\r\n\r\n'));

  await waitFor(1000);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 1);
  assert.equal(onHttpRequestHeader.mock.calls.length, 0);
  assert.equal(onHttpRequestEnd.mock.calls.length, 0);
  server.close();
});

test('handleSocketRequest request body with stream', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const handleRequestBodyOnData = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.request.body, null);
    ctx.request.body = new PassThrough();
    ctx.request.body.on('data', handleRequestBodyOnData);
  });

  const onHttpRequestEnd = mock.fn((ctx) => {
    assert(ctx.request.body.writableEnded);
    assert(ctx.request.body.readableEnded);
    assert(ctx.response === null);
    ctx.response = {
      headers: {
        server: 'quan',
      },
      body: Buffer.from('ccc'),
    };
  });

  const onHttpResponseEnd = mock.fn(() => {});

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpError,
      onHttpRequestEnd,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1\.1 200/.test(chunk.toString()));
  });

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 6\r\n\r\n'));

  setTimeout(() => {
    state.connector.write(Buffer.from('aa'));
  }, 50);

  setTimeout(() => {
    state.connector.write(Buffer.from('bb'));
  }, 60);

  setTimeout(() => {
    state.connector.write(Buffer.from('cc'));
  }, 70);

  await waitFor(1000);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onHttpRequestHeader.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  assert.equal(handleRequestBodyOnData.mock.calls.length, 3);
  assert.equal(handleRequestBodyOnData.mock.calls.map((d) => d.arguments[0].toString()).join(''), 'aabbcc');
  state.connector();
  server.close();
});

test('handleSocketRequest request body with stream no consume', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const requestBody = new PassThrough();
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.request.body, null);
    ctx.request.body = requestBody;
  });

  const onHttpRequestEnd = mock.fn(() => {});
  const onHttpResponseEnd = mock.fn(() => {});

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpError,
      onHttpRequestEnd,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 6\r\n\r\n'));

  setTimeout(() => {
    state.connector.write(Buffer.from('aa'));
  }, 50);

  setTimeout(() => {
    state.connector.write(Buffer.from('bb'));
  }, 60);

  setTimeout(() => {
    state.connector.write(Buffer.from('cc'));
  }, 70);

  await waitFor(2000);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 0);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onHttpRequestHeader.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 0);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  assert(!requestBody.destroyed);
  state.connector();
  server.close();

  await waitFor(200);
  assert(requestBody.destroyed);
});

test('handleSocketRequest request body ctx.onRequest', async () => {
  const port = getPort();
  const onRequest = mock.fn((ctx) => {
    assert.equal(ctx.request.body.toString(), 'aabbcc');
    assert.equal(ctx.response, null);
    ctx.response = {
      headers: {
        server: 'quan',
      },
      body: 'ccc',
    };
  });
  const onHttpError = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.onRequest = onRequest;
  });

  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.response, null);
    assert.equal(ctx.request.body.toString(), 'aabbcc');
  });
  const onHttpResponseEnd = mock.fn((ctx) => {
    assert.deepEqual(ctx.response, {
      headers: {
        server: 'quan',
      },
      body: 'ccc',
    });
  });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpRequestEnd,
      onHttpError,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1.1 200/.test(chunk.toString()));
  });
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 6\r\n\r\n'));

  setTimeout(() => {
    state.connector.write(Buffer.from('aa'));
  }, 50);

  setTimeout(() => {
    state.connector.write(Buffer.from('bb'));
  }, 60);

  setTimeout(() => {
    state.connector.write(Buffer.from('cc'));
  }, 70);

  await waitFor(2000);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onHttpRequestHeader.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  state.connector();
  server.close();
});

test('handleSocketRequest request body with stream', () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const requestBody = new PassThrough();
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_aaa_bbb_333`);
  const ws = fs.createWriteStream(pathname);
  const count = 3000;
  const content = 'asdf asdfasdfawefbbb';
  let i = 0;
  let isPaused = false;
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.request.body = requestBody;
    requestBody.pipe(ws);
  });
  const onHttpResponseEnd = mock.fn(() => {
    const buf = fs.readFileSync(pathname);
    assert(new RegExp(`:${count - 1}$`).test(buf.toString()));
    fs.unlinkSync(pathname);
  });

  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.response, null);
    assert.equal(onHttpResponseEnd.mock.calls.length, 0);
    assert(ctx.request.body.writableEnded);
    assert(ctx.request.body.readableEnded);
    ctx.response = {
      headers: {
        name: 'quan',
      },
      body: 'aaa',
    };
    setTimeout(() => {
      assert.equal(onHttpResponseEnd.mock.calls.length, 1);
    }, 100);
  });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpRequestEnd,
      onHttpError,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
    isEnd: false,
    encode: encodeHttp({
      method: 'POST',
      path: '/aaa',
      headers: {
        name: 'quan',
      },
    }),
  };

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1.1 200/.test(chunk.toString()));
    setTimeout(() => {
      state.connector();
    }, 100);
    setTimeout(() => {
      assert.equal(onClose.mock.calls.length, 0);
      assert.equal(onError.mock.calls.length, 0);
      server.close();
    }, 200);
  });
  const walk = () => {
    while (!isPaused && i < count) {
      const s = `${_.times(800).map(() => content).join('')}:${i}`;
      const ret = state.connector.write(state.encode(s));
      if (ret === false) {
        isPaused = true;
      }
      i++;
    }
    if (i >= count && !state.isEnd) {
      state.isEnd = true;
      setTimeout(() => {
        state.connector.write(state.encode());
      }, 500);
    }
  };

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
      onDrain: () => {
        isPaused = false;
        walk();
      },
    },
    () => connect(port),
  );

  setTimeout(() => {
    walk();
  }, 100);
});

test('handleSocketRequest request body with stream 2', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpResponseEnd = mock.fn(() => {
  });

  const onHttpRequestEnd = mock.fn((ctx) => {
    const stream = new PassThrough();
    ctx.response = {
      statusCode: 206,
      headers: {
        name: 'quan',
      },
      body: stream,
    };
    setTimeout(() => {
      stream.end('aaa');
    }, 100);
  });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponseEnd,
      onHttpRequestEnd,
      onHttpError,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const onData = mock.fn((chunk) => {
    if (onData.mock.calls.length === 0) {
      assert(chunk.toString().includes(206));
      assert(chunk.toString().includes('quan'));
    }
  });
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );
  state.connector.write(encodeHttp({
    method: 'GET',
    path: '/aaa',
    body: null,
    headers: {
      name: 'quan',
    },
  }));
  await waitFor(1500);
  state.connector();
  server.close();
  assert.equal(onData.mock.calls.length, 2);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
});

test('handleSocketRequest ctx.onResponse', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpResponseEnd = mock.fn((ctx) => {
    assert.deepEqual(ctx.response, {
      headers: {
        name: 'rice',
      },
      body: 'foo',
    });
  });
  const onResponse = mock.fn((ctx) => {
    assert.equal(onHttpResponseEnd.mock.calls.length, 0);
    assert.deepEqual(ctx.response, {
      headers: {
        name: 'quan',
      },
      body: 'aaa',
    });
    ctx.response = {
      headers: {
        name: 'rice',
      },
      body: 'foo',
    };
  });
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.response, null);
    assert.equal(typeof ctx.onResponse, 'undefined');
    ctx.onResponse = onResponse;
    ctx.response = {
      headers: {
        name: 'quan',
      },
      body: 'aaa',
    };
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponseEnd,
      onHttpRequestEnd,
      onHttpError,
    });
  });
  server.listen(port);
  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1\.1 200/.test(chunk.toString()));
  });
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const state = {
    connector: null,
  };

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 0\r\n\r\n'));

  await waitFor(1000);

  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onResponse.mock.calls.length, 1);

  state.connector();
  server.close();
});

test('handleSocketRequest ctx.onResponse trigger error', async () => {
  const port = getPort();
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.error.statusCode, 401);
    assert.equal(ctx.response.statusCode, 401);
  });
  const onHttpResponseEnd = mock.fn(() => {});
  const onResponse = mock.fn(async () => {
    assert.equal(onHttpError.mock.calls.length, 0);
    await waitFor(200);
    throw createError(401);
  });
  const onHttpRequestEnd = mock.fn((ctx) => {
    ctx.onResponse = onResponse;
  });
  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponseEnd,
      onHttpRequestEnd,
      onHttpError,
    });
  });
  server.listen(port);
  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1.1 401/.test(chunk.toString()));
  });
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const state = {
    connector: null,
  };
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 0\r\n\r\n'));

  await waitFor(1000);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onResponse.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  server.close();
});

test('handleSocketRequest POST and GET', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.response, null);
    if (ctx.request.method === 'GET') {
      assert.equal(ctx.request.body, null);
      assert(!Object.hasOwnProperty.call(ctx.request, '_write'));
    } else if (ctx.request.method === 'POST') {
      assert(Object.hasOwnProperty.call(ctx.request, '_write'));
    }
    if (ctx.request.method === 'GET') {
      ctx.response = {
        headers: {
          name: 'quan',
        },
        body: 'abc',
      };
    } else if (ctx.request.method === 'POST') {
      ctx.response = {
        headers: {
          name: 'quan',
        },
        body: 'efg',
      };
    }
  });
  const onHttpRequestHeader = mock.fn((ctx) => {
    if (ctx.request.method === 'POST') {
      setTimeout(() => {
        assert.equal(onHttpRequestEnd.mock.calls.length, 1);
        ctx.request.body.on('data', () => {});
        setTimeout(() => {
          assert.equal(onHttpRequestEnd.mock.calls.length, 2);
        }, 100);
      }, 100);
    }
  });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpRequestEnd,
      onHttpError,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 0\r\n\r\n'));

  setTimeout(() => {
    state.connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 3\r\n\r\naaa'));
  }, 1000);

  await waitFor(2000);
  assert.equal(onHttpRequestHeader.mock.calls.length, 2);
  assert.equal(onData.mock.calls.length, 2);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onHttpRequestEnd.mock.calls.length, 2);
  assert(onData.mock.calls[0].arguments[0].toString().includes('abc'));
  assert(onData.mock.calls[1].arguments[0].toString().includes('efg'));
  state.connector();
  server.close();
});

test('handleSocketRequest with forwardRequest', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const handleDataOnRemoteSocket = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.requestForward = {
      hostname: '127.0.0.1',
      port: port2,
    };
  });
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert(!ctx.requestForward.onBody.destroyed);
  });
  const onHttpResponseEnd = mock.fn((ctx) => {
    assert.equal(ctx.response.body, null);
    assert(ctx.requestForward.onBody instanceof PassThrough);
    assert(ctx.requestForward.body instanceof PassThrough);
    assert(ctx.requestForward.onBody.destroyed);
    assert(ctx.requestForward.body.destroyed);
  });

  const onHttpError = mock.fn(() => {});
  const server1 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpRequestEnd,
      onHttpResponseEnd,
      onHttpError,
    });
  });
  server1.listen(port1);

  const server2 = net.createServer((socket) => {
    socket.on('data', handleDataOnRemoteSocket);
    setTimeout(() => {
      socket.end(encodeHttp({
        headers: {
          Server: 'quan',
        },
        body: 'foo',
      }));
    }, 500);
  });

  server2.listen(port2);

  await waitFor(100);

  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  const state = {
    connector: null,
  };
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port1),
  );

  state.connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 6\r\n\r\naa'));

  setTimeout(() => {
    state.connector.write('bb');
  }, 100);

  setTimeout(() => {
    state.connector.write('cc');
  }, 150);

  await waitFor(1500);
  assert.equal(handleDataOnRemoteSocket.mock.calls.length, 3);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(
    onData.mock.calls[0].arguments[0].toString(),
    'HTTP/1.1 200 OK\r\nserver: quan\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nfoo\r\n0\r\n\r\n',
  );
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  state.connector();

  server1.close();
  server2.close();
});

test('handleSocketRequest with forwardRequest 2', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const handleDataOnRemoteSocket = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn((ctx) => {
    const transform = new Transform({
      transform(chunk, encoding, callback) {
        callback(null, Buffer.concat([Buffer.from('aaa'), chunk]));
      },
    });
    ctx.requestForward = {
      hostname: '127.0.0.1',
      port: port2,
      onBody: transform,
    };
  });

  const onHttpError = mock.fn(() => {});
  const server1 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpError,
    });
  });
  server1.listen(port1);

  const server2 = net.createServer((socket) => {
    socket.on('data', handleDataOnRemoteSocket);
    setTimeout(() => {
      socket.end(encodeHttp({
        headers: {
          Server: 'quan',
        },
        body: 'foo',
      }));
    }, 500);
  });

  server2.listen(port2);

  await waitFor(100);

  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  const state = {
    connector: null,
  };
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port1),
  );

  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nName: quan\r\n\r\n'));

  await waitFor(1500);
  state.connector();

  assert.equal(onData.mock.calls.length, 1);
  assert.equal(
    onData.mock.calls[0].arguments[0].toString(),
    'HTTP/1.1 200 OK\r\nserver: quan\r\nTransfer-Encoding: chunked\r\n\r\n6\r\naaafoo\r\n0\r\n\r\n',
  );

  server1.close();
  server2.close();
});

test('handleSocketRequest with forwardRequest ctx.onResponse', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const handleDataOnRemoteSocket = mock.fn(() => {});
  const onResponse = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.onResponse = onResponse;
    ctx.requestForward = {
      hostname: '127.0.0.1',
      port: port2,
    };
  });
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(onResponse.mock.calls.length, 0);
    assert(ctx.forwardRequest == null);
  });
  const onHttpResponseEnd = mock.fn((ctx) => {
    assert.equal(onResponse.mock.calls.length, 1);
    assert.equal(ctx.response.body.toString(), 'foo');
  });

  const onHttpError = mock.fn(() => {});
  const server1 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpRequestEnd,
      onHttpResponseEnd,
      onHttpError,
    });
  });
  server1.listen(port1);

  const server2 = net.createServer((socket) => {
    socket.on('data', handleDataOnRemoteSocket);
    setTimeout(() => {
      socket.end(encodeHttp({
        headers: {
          Server: 'quan',
        },
        body: 'foo',
      }));
    }, 500);
  });

  server2.listen(port2);

  await waitFor(100);

  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  const state = {
    connector: null,
  };
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port1),
  );

  state.connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 6\r\n\r\naa'));

  setTimeout(() => {
    state.connector.write('bb');
  }, 100);

  setTimeout(() => {
    state.connector.write('cc');
  }, 150);

  await waitFor(1500);
  assert(handleDataOnRemoteSocket.mock.calls.length > 0);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  assert.equal(onResponse.mock.calls.length, 1);
  state.connector();

  server1.close();
  server2.close();
});

test('handleSocketRequest forwardRequest request body with stream', async () => {
  const count = 6000;
  let i = 0;
  let isPaused = false;
  let isEnd = false;
  const content = 'asdfasdf 99as3fbf';
  const port1 = getPort();
  const port2 = getPort();
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.requestForward = {
      hostname: '127.0.0.1',
      port: port2,
    };
  });
  const onHttpRequestEnd = mock.fn(() => {});
  const onHttpResponseEnd = mock.fn(() => {});
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_aaa_bbb_666`);
  const ws = fs.createWriteStream(pathname);

  const onHttpError = mock.fn(() => {});
  const server1 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpRequestEnd,
      onHttpResponseEnd,
      onHttpError,
    });
  });
  server1.listen(port1);

  const server2 = net.createServer((socket) => {
    const decode = decodeHttpRequest({
      onBody: () => {
      },
      onEnd: () => {
        setTimeout(() => {
          socket.write(encodeHttp({
            headers: {
              server: 'quan',
            },
            body: 'ok',
          }));
        }, 100);
      },
    });
    socket.pipe(ws);
    socket.on('data', (chunk) => {
      decode(chunk);
    });
  });

  server2.listen(port2);

  await waitFor(100);

  const state = {
    connector: null,
  };

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const onDrain = mock.fn(() => {
    isPaused = false;
    walk();
  });

  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1.1 200/.test(chunk.toString()));
    setTimeout(() => {
      assert(ws.destroyed);
      assert.equal(onData.mock.calls.length, 1);
      assert.equal(onClose.mock.calls.length, 0);
      assert.equal(onError.mock.calls.length, 0);
      state.connector();
      server1.close();
      server2.close();
      const buf = fs.readFileSync(pathname);
      assert(new RegExp(`:${count - 1}\r\n0\r\n\r\n$`).test(buf.toString()));
      fs.unlinkSync(pathname);
    }, 2000);
  });

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
      onDrain,
    },
    () => connect(port1),
  );

  const encode = encodeHttp({
    path: '/aabbccc?name=ddd',
    method: 'POST',
    headers: {
      name: 'aaa',
    },
  });

  function walk() {
    while (!isPaused && i < count) {
      const s = `${_.times(500).map(() => content).join('')}:${i}`;
      const ret = state.connector.write(encode(s));
      if (ret === false) {
        isPaused = true;
      }
      i++;
    }
    if (i >= count && !isEnd) {
      isEnd = true;
      state.connector.write(encode());
    }
  }

  setTimeout(() => {
    walk();
  }, 100);
});

test('handleSocketRequest forwardRequest response body with stream', async () => {
  const count = 6000;
  let i = 0;
  let isPaused = false;
  const content = 'asdfasdf e1dda';
  const port1 = getPort();
  const port2 = getPort();
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_aaa_bbb_sa888`);
  const ws = fs.createWriteStream(pathname);
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.requestForward = {
      hostname: '127.0.0.1',
      port: port2,
    };
  });
  const onHttpRequestEnd = mock.fn(() => {});
  const onHttpResponseEnd = mock.fn(() => {});
  const onHttpError = mock.fn(() => {});
  const server1 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpRequestEnd,
      onHttpResponseEnd,
      onHttpError,
    });
  });
  server1.listen(port1);

  const server2 = net.createServer((socket) => {
    const encode = encodeHttp({
      headers: {
        server: 'quan',
      },
    });
    const walk = () => {
      while (!isPaused && i < count) {
        const s = `${_.times(500).map(() => content).join('')}:${i}`;
        const ret = socket.write(encode(s));
        if (ret === false) {
          isPaused = true;
        }
        i++;
      }
      if (i >= count && !socket.writableEnded) {
        socket.end(encode());
      }
    };
    setTimeout(() => {
      socket.on('drain', () => {
        isPaused = false;
        walk();
      });
      walk();
    }, 200);
  });

  server2.listen(port2);

  await waitFor(100);

  const state = {
    connector: null,
  };

  const onError = mock.fn(() => {});
  const onClose = mock.fn(() => {});

  ws.on('drain', () => {
    state.connector.resume();
  });

  const decode = decodeHttpResponse({
    onHeader: () => {},
    onBody: (chunk) => {
      const ret = ws.write(chunk);
      if (ret === false) {
        state.connector.pause();
      }
    },
    onEnd: () => {
      ws.end();
      setTimeout(() => {
        assert.equal(onClose.mock.calls.length, 0);
        assert.equal(onError.mock.calls.length, 0);
        assert.equal(onHttpRequestEnd.mock.calls.length, 1);
        assert.equal(onHttpResponseEnd.mock.calls.length, 1);
        state.connector();
        server1.close();
        server2.close();
        const buf = fs.readFileSync(pathname);
        assert(new RegExp(`:${count - 1}$`).test(buf.toString()));
        fs.unlinkSync(pathname);
      }, 1000);
    },
  });

  const onData = mock.fn((chunk) => {
    decode(chunk);
  });

  state.connector = createConnector(
    {
      onData,
      onError,
      onClose,
    },
    () => connect(port1),
  );
  state.connector.write('GET /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 0\r\n\r\n');
});

test('handleSocketRequest with forwardRequest, remote server response invalid', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.requestForward = {
      hostname: '127.0.0.1',
      port: port2,
    };
  });
  const onHttpResponseEnd = mock.fn(() => {
  });

  const onHttpError = mock.fn((ctx) => {
    assert(ctx.error instanceof HttpParserError);
  });
  const server1 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpError,
    });
  });
  server1.listen(port1);

  const server2 = net.createServer((socket) => {
    socket.on('data', () => {});
    setTimeout(() => {
      socket.end(encodeHttp({
        method: 'POST',
        path: '/xxxx',
        headers: {
          name: 'quan',
        },
        body: 'foo',
      }));
    }, 500);
  });

  server2.listen(port2);

  await waitFor(100);

  const onData = mock.fn((chunk) => {
    assert(/^HTTP\/1\.1 502/.test(chunk.toString()));
  });
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  const state = {
    connector: null,
  };
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port1),
  );

  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 0\r\n\r\n'));

  await waitFor(1500);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onHttpError.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  state.connector();

  server1.close();
  server2.close();
});

test('handleSocketRequest with forwardRequest, remote server close', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.requestForward = {
      hostname: '127.0.0.1',
      port: port2,
    };
  });
  const onHttpResponseEnd = mock.fn(() => {
  });

  const onHttpError = mock.fn((ctx) => {
    assert(ctx.error instanceof SocketCloseError);
    assert.equal(ctx.response.statusCode, 502);
  });
  const server1 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpError,
    });
  });
  server1.listen(port1);

  const server2 = net.createServer((socket) => {
    socket.on('data', () => {});
    setTimeout(() => {
      socket.write('HTTP/1.1 200 OK\r\n');
    }, 100);
    setTimeout(() => {
      socket.write('Server: aaa\r\nContent-Length: 8\r\n\r\nc');
    }, 150);
    setTimeout(() => {
      socket.write('aaa');
    }, 180);
    setTimeout(() => {
      socket.destroy();
    }, 200);
  });

  server2.listen(port2);

  await waitFor(100);

  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  const state = {
    connector: null,
  };
  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port1),
  );

  state.connector.write(Buffer.from('GET /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 0\r\n\r\n'));

  await waitFor(1500);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert(onData.mock.calls.length > 0);
  assert.equal(onHttpError.mock.calls.length, 1);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  state.connector();

  server1.close();
  server2.close();
});

test('handleSocketRequest onClose', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});
  const handleRequestBodyOnData = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.request.body = new PassThrough();
    ctx.request.body.on('data', handleRequestBodyOnData);
  });

  const onHttpRequestEnd = mock.fn(() => {});

  const onHttpResponseEnd = mock.fn(() => {});

  const onCloseRemoteSocket = mock.fn((ctx) => {
    assert.equal(ctx.request.path, '/aaa');
    assert.equal(ctx.request.method, 'POST');
    assert(ctx.request.body.destroyed);
  });

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onClose: onCloseRemoteSocket,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpError,
      onHttpRequestEnd,
    });
  });
  server.listen(port);

  const state = {
    connector: null,
  };

  const onData = mock.fn(() => {});

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => connect(port),
  );

  state.connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 6\r\n\r\n'));

  setTimeout(() => {
    state.connector.write(Buffer.from('aa'));
  }, 50);

  setTimeout(() => {
    state.connector();
  }, 60);

  await waitFor(1000);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 0);
  assert.equal(onCloseRemoteSocket.mock.calls.length, 1);
  assert.equal(onHttpRequestEnd.mock.calls.length, 0);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  server.close();
});

test('handleSocketRequest forwardRequest stream', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.requestForward = {
      hostname: '127.0.0.1',
      port: port2,
    };
  });
  const onHttpResponseEnd = mock.fn(() => {});
  const onHttpError = mock.fn(() => {});
  const server1 = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpError,
    });
  });
  server1.listen(port1);

  const packageBuf = fs.readFileSync(path.resolve(process.cwd(), 'package-lock.json'));

  const server2 = net.createServer((socket) => {
    const bodyBufList = [];
    const decode = decodeHttpRequest({
      onBody: (chunk) => {
        bodyBufList.push(chunk);
      },
      onEnd: () => {
        assert.equal(
          Buffer.concat(bodyBufList).toString(),
          packageBuf.toString(),
        );
        setTimeout(() => {
          socket.end('HTTP/1.1 200 OK\r\nServer: quan\r\nContent-Length: 2\r\n\r\nOK');
        }, 100);
      },
    });
    socket.on('data', (chunk) => {
      decode(chunk);
    });
  });

  server2.listen(port2);

  await waitFor(100);

  const ret = await httpRequest({
    hostname: '127.0.0.1',
    port: port1,
    method: 'POST',
    path: '/upload?name=package-lock.json',
    body: packageBuf,
  });

  assert.equal(ret.statusCode, 200);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onHttpResponseEnd.mock.calls.length, 1);

  server1.close();
  server2.close();
});
*/
