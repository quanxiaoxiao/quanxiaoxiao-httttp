/* eslint no-use-before-define: 0 */
import {
  PassThrough,
  Readable,
} from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { test, mock } from 'node:test';
import process from 'node:process';
import net from 'node:net';
import assert from 'node:assert';
import _ from 'lodash';
import { waitFor } from '@quanxiaoxiao/utils';
import { getSocketConnect } from '@quanxiaoxiao/http-request';
import { wrapStreamRead } from '@quanxiaoxiao/node-utils';
import {
  encodeHttp,
  decodeHttpResponse,
} from '@quanxiaoxiao/http-utils';
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
  const onSocketClose = mock.fn(() => {});

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpRequestHeader,
      onHttpResponseEnd,
      onHttpRequestEnd,
      onHttpError,
      onClose: onSocketClose,
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
    () => getSocketConnect({ port }),
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
  assert.equal(onSocketClose.mock.calls.length, 0);
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    await waitFor(1500);
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
    () => getSocketConnect({ port }),
  );
  state.connector.write(Buffer.from('POST /aaa HTTP/1.1\r\nContent-Length: 2\r\n\r\naa'));
  await waitFor(2000);
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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
    () => getSocketConnect({ port }),
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

test('handleSocketRequest client socket close 1', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpError,
    });
  });
  server.listen(port);

  await waitFor(100);
  const handleDataOnSocket = mock.fn(() => {});
  const socket = getSocketConnect({ port });
  socket.on('data', handleDataOnSocket);
  socket.on('connect', () => {
    setTimeout(() => {
      socket.destroy();
    }, 500);
  });
  await waitFor(1000);
  assert.equal(onHttpError.mock.calls.length, 0);
  server.close();
});

test('handleSocketRequest client socket close 2', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpError,
    });
  });
  server.listen(port);

  await waitFor(100);
  const handleDataOnSocket = mock.fn(() => {});
  const socket = getSocketConnect({ port });
  socket.on('data', handleDataOnSocket);
  socket.on('connect', () => {
    socket.write('GET /aaa HTTP/1.1\r\nName: quan\r\n');
    setTimeout(() => {
      socket.destroy();
    }, 500);
  });
  await waitFor(1000);
  assert.equal(onHttpError.mock.calls.length, 0);
  server.close();
});

test('handleSocketRequest server socket close', async () => {
  const port = getPort();
  const onHttpError = mock.fn(() => {});

  const server = net.createServer((socket) => {
    setTimeout(() => {
      socket.destroy();
    }, 500);
    handleSocketRequest({
      socket,
      onHttpError,
    });
  });
  server.listen(port);

  const handleDataOnSocket = mock.fn(() => {});

  await waitFor(100);
  const socket = getSocketConnect({ port });
  socket.on('data', handleDataOnSocket);
  socket.on('connect', () => {});
  await waitFor(1000);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(handleDataOnSocket.mock.calls.length, 0);
  server.close();
});

test('handleSocketRequest response.body stream 222', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});

  const server = net.createServer((socket) => {
    handleSocketRequest({
      socket,
      onHttpResponse: (ctx) => {
        ctx.response = {
          headers: {
            'Cache-Control': 'no-store',
            'Keep-Alive': 'timeout=45',
          },
          body: new PassThrough(),
        };
        setTimeout(() => {
          ctx.response.body.end('aaa');
        }, 3000);
        setTimeout(() => {
          ctx.socket.destroy();
        }, 3500);
      },
    });
  });

  server.listen(port);

  await waitFor(100);
  const socket = getSocketConnect({ port });
  socket.on('data', handleDataOnSocket);
  socket.on('connect', () => {
    socket.write('GET /aaa HTTP/1.1\r\nName: quan\r\nContent-Length: 0\r\n\r\n');
  });
  await waitFor(200);
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
  assert.equal(
    handleDataOnSocket.mock.calls[0].arguments[0].toString(),
    'HTTP/1.1 200 OK\r\nCache-Control: no-store\r\nKeep-Alive: timeout=45\r\nTransfer-Encoding: chunked\r\n\r\n',
  );
  await waitFor(5000);
  assert.equal(handleDataOnSocket.mock.calls.length, 2);
  server.close();
});
