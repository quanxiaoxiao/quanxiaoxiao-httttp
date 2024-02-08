import { PassThrough } from 'node:stream';
import { test, mock } from 'node:test';
import assert from 'node:assert';
import attachRequest from './attachRequest.mjs';

const waitFor = async (t = 100) => {
  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, t);
  });
};

test('attachRequest', async () => {
  const controller = new AbortController();
  const onHttpRequest = mock.fn((ctx) => {
    assert.equal(typeof ctx.request.dateTimeCreate, 'number');
    assert.equal(ctx.request.path, null);
    assert.equal(ctx.request.pathname, null);
    assert.equal(ctx.request.querystring, '');
    assert.deepEqual(ctx.request.query, {});
    assert.equal(ctx.request.method, null);
    assert.deepEqual(ctx.request.headersRaw, []);
    assert.deepEqual(ctx.request.headers, {});
    assert.equal(ctx.response, null);
    assert.equal(ctx.error, null);
  });
  const onHttpRequestStartLine = mock.fn((ctx) => {
    assert.equal(ctx.request.path, '/quan?name=aaa');
    assert.equal(ctx.request.pathname, '/quan');
    assert.equal(ctx.request.querystring, 'name=aaa');
    assert.deepEqual(ctx.request.query, { name: 'aaa' });
    assert.equal(ctx.request.method, 'GET');
    assert.equal(ctx.response, null);
    assert.equal(ctx.error, null);
  });
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.deepEqual(ctx.request.headers, {
      'content-length': 4,
      'user-agent': 'quan',
    });
    assert.deepEqual(
      ctx.request.headersRaw,
      [
        'User-Agent',
        'quan',
        'Content-Length',
        '4',
      ],
    );
  });
  const onHttpRequestConnection = mock.fn(() => {});
  const onRequestBodyChunk = mock.fn(() => {});
  const onForwardConnecting = mock.fn(() => {});
  const onForwardConnect = mock.fn(() => {});
  const onHttpResponseEnd = mock.fn((ctx) => {
    assert.equal(ctx.response.statusCode, 201);
    assert.equal(ctx.response.body, 'ok');
  });
  const onHttpError = mock.fn(() => {});
  const onChunkIncoming = mock.fn(() => {});
  const onChunkOutgoing = mock.fn(() => {});
  const doSocketEnd = mock.fn(() => {});

  const onHttpRequestEnd = mock.fn((ctx) => {
    assert(ctx.request.body.readable);
    assert(ctx.request.body.writable);
    assert.equal(typeof ctx.request.dateTimeBody, 'number');
    assert.equal(typeof ctx.request.dateTimeEnd, 'number');
    assert.equal(ctx.request.connection, false);
    assert(ctx.request.body.eventNames().includes('end'));
    assert(ctx.request.body.eventNames().includes('resume'));
    assert(ctx.request.body.eventNames().includes('pause'));
    ctx.request.body.on('data', onRequestBodyChunk);
    ctx.request.body.on('end', () => {
      assert.equal(
        Buffer.concat(onRequestBodyChunk.mock.calls.map((d) => d.arguments[0])),
        'aabb',
      );
      assert(!ctx.request.body.eventNames().includes('resume'));
      assert(!ctx.request.body.eventNames().includes('pause'));
      ctx.response = {
        statusCode: 201,
        headers: {
          Server: 'quan',
        },
        body: 'ok',
      };
    });
  });

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    onHttpRequest,
    onHttpRequestStartLine,
    onHttpRequestHeader,
    onHttpRequestConnection,
    onHttpRequestEnd,
    onForwardConnecting,
    onForwardConnect,
    onHttpResponseEnd,
    onHttpError,
    onChunkIncoming,
    onChunkOutgoing,
    doSocketEnd,
  });
  assert.equal(onHttpRequest.mock.calls.length, 0);
  assert.equal(onHttpRequestStartLine.mock.calls.length, 0);
  assert.equal(onHttpRequestHeader.mock.calls.length, 0);
  assert.equal(onHttpRequestConnection.mock.calls.length, 0);
  assert.equal(onHttpRequestEnd.mock.calls.length, 0);
  assert.equal(onForwardConnecting.mock.calls.length, 0);
  assert.equal(onForwardConnect.mock.calls.length, 0);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onChunkIncoming.mock.calls.length, 0);
  assert.equal(onChunkOutgoing.mock.calls.length, 0);

  await execute(Buffer.from('GET /quan?name=aaa HTTP/1.1'));
  assert.equal(onHttpRequest.mock.calls.length, 1);
  assert.equal(onChunkOutgoing.mock.calls.length, 1);
  assert.equal(onChunkOutgoing.mock.calls[0].arguments[1].toString(), 'GET /quan?name=aaa HTTP/1.1');
  assert.equal(onHttpRequestStartLine.mock.calls.length, 0);
  assert.equal(onHttpRequestHeader.mock.calls.length, 0);
  assert.equal(onHttpRequestConnection.mock.calls.length, 0);
  assert.equal(onHttpRequestEnd.mock.calls.length, 0);
  assert.equal(onForwardConnecting.mock.calls.length, 0);
  assert.equal(onForwardConnect.mock.calls.length, 0);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onChunkIncoming.mock.calls.length, 0);

  await execute(Buffer.from('\r\nUser-Agent: quan\r\nContent-Length: 4\r\n'));
  assert.equal(onHttpRequestStartLine.mock.calls.length, 1);
  assert.equal(onHttpRequestHeader.mock.calls.length, 0);
  assert.equal(onHttpRequestConnection.mock.calls.length, 0);
  assert.equal(onHttpRequestEnd.mock.calls.length, 0);
  assert.equal(onForwardConnecting.mock.calls.length, 0);
  assert.equal(onForwardConnect.mock.calls.length, 0);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onChunkIncoming.mock.calls.length, 0);
  await execute(Buffer.from('\r\naa'));
  assert.equal(onHttpRequestHeader.mock.calls.length, 1);
  assert.equal(onHttpRequestConnection.mock.calls.length, 0);
  assert.equal(onHttpRequestEnd.mock.calls.length, 0);
  assert.equal(onForwardConnecting.mock.calls.length, 0);
  assert.equal(onForwardConnect.mock.calls.length, 0);
  assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  assert.equal(onHttpError.mock.calls.length, 0);
  assert.equal(onChunkIncoming.mock.calls.length, 0);
  await execute(Buffer.from('bb'));
  assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  setImmediate(() => {
    assert.equal(onHttpResponseEnd.mock.calls.length, 1);
    assert.equal(onRequestBodyChunk.mock.calls.length, 2);
    assert.equal(onForwardConnecting.mock.calls.length, 0);
    assert.equal(onForwardConnect.mock.calls.length, 0);
    assert.equal(onHttpError.mock.calls.length, 0);
  });
});

test('attachRequest signal aborted at start', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    doSocketEnd,
  });
  try {
    controller.abort();
    await execute(Buffer.from('GET /quan'));
    throw new Error();
  } catch (error) {
    assert(error instanceof assert.AssertionError);
    assert.equal(doSocketEnd.mock.calls.length, 0);
  }
});

test('attachRequest onHttpRequest error', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    onHttpRequest: async () => {
      throw new Error();
    },
    doSocketEnd,
  });
  try {
    await execute(Buffer.from('GET /quan'));
    assert.fail();
  } catch (error) {
    assert(!(error instanceof assert.AssertionError));
    assert.equal(doSocketEnd.mock.calls.length, 0);
  }
});

test('attachRequest onHttpRequest abort', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    onHttpRequest: async () => {
      await waitFor(100);
      controller.abort();
    },
    doSocketEnd,
  });
  try {
    await execute(Buffer.from('GET /quan'));
    throw new Error();
  } catch (error) {
    assert(error instanceof assert.AssertionError);
    assert.equal(doSocketEnd.mock.calls.length, 0);
  }
});

test('attachRequest onHttpRequestStartLine error', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.response.statusCode, 508);
  });
  const onHttpRequestStartLine = mock.fn(() => {
    const error = new Error();
    error.statusCode = 508;
    throw error;
  });
  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    onHttpRequestStartLine,
    onHttpError,
    doSocketEnd,
  });
  await execute(Buffer.from('GET /quan HTTP/1.1\r\n'));
  setTimeout(() => {
    assert.equal(doSocketEnd.mock.calls.length, 1);
    assert.equal(onHttpError.mock.calls.length, 1);
    assert.equal(onHttpRequestStartLine.mock.calls.length, 1);
  }, 200);
});

test('attachRequest onHttpRequestStartLine abort', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onHttpError = mock.fn(() => {});
  const onHttpRequestStartLine = mock.fn(async () => {
    await waitFor(100);
    controller.abort();
  });
  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    onHttpRequestStartLine,
    onHttpError,
    doSocketEnd,
  });
  await execute(Buffer.from('GET /quan HTTP/1.1\r\n'));
  setTimeout(() => {
    assert.equal(doSocketEnd.mock.calls.length, 0);
    assert.equal(onHttpError.mock.calls.length, 0);
    assert.equal(onHttpRequestStartLine.mock.calls.length, 1);
  }, 200);
});

test('attachRequest onHttpRequestHeader error', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.response.statusCode, 509);
  });
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.deepEqual(ctx.request.headers, {
      'content-length': 0,
      'user-agent': 'quan',
    });
    const error = new Error();
    error.statusCode = 509;
    throw error;
  });

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    onHttpRequestHeader,
    onHttpError,
    doSocketEnd,
  });
  await execute(Buffer.from('GET /quan HTTP/1.1\r\nContent-Length: 0\r\nUser-Agent: quan\r\n\r\n'));
  setTimeout(() => {
    assert.equal(doSocketEnd.mock.calls.length, 1);
    assert.equal(onHttpError.mock.calls.length, 1);
    assert.equal(onHttpRequestHeader.mock.calls.length, 1);
  }, 200);
});

test('attachRequest onHttpRequestHeader aborted', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onHttpError = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn(async () => {
    await waitFor(100);
    controller.abort();
  });

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    onHttpRequestHeader,
    onHttpError,
    doSocketEnd,
  });
  await execute(Buffer.from('GET /quan HTTP/1.1\r\nContent-Length: 0\r\nUser-Agent: quan\r\n\r\n'));
  setTimeout(() => {
    assert.equal(doSocketEnd.mock.calls.length, 0);
    assert.equal(onHttpError.mock.calls.length, 0);
    assert.equal(onHttpRequestHeader.mock.calls.length, 1);
  }, 200);
});

test('attachRequest onHttpRequestEnd error', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onHttpError = mock.fn((ctx) => {
    assert.deepEqual(ctx.request.headers, {
      'content-length': 2,
      'user-agent': 'quan',
    });
    assert.equal(ctx.response.statusCode, 511);
    setImmediate(() => {
      assert(ctx.request.body.destroyed);
    });
  });
  const onHttpRequestEnd = mock.fn(() => {
    const error = new Error();
    error.statusCode = 511;
    throw error;
  });

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    onHttpRequestEnd,
    onHttpError,
    doSocketEnd,
  });
  await execute(Buffer.from('GET /quan HTTP/1.1\r\nContent-Length: 2\r\nUser-Agent: quan\r\n\r\naa'));
  setTimeout(() => {
    assert.equal(doSocketEnd.mock.calls.length, 1);
    assert.equal(onHttpError.mock.calls.length, 1);
    assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  }, 200);
});

test('attachRequest wait for consume request body chunk', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onHttpError = mock.fn((ctx) => {
    assert(ctx.request.body.destroyed);
  });
  const onRequestBodyChunk = mock.fn(() => {});
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.request.headers['content-length'], 4);
    assert(ctx.request.body instanceof PassThrough);
    assert(ctx.request.body.eventNames().includes('pause'));
    assert(ctx.request.body.eventNames().includes('resume'));
    assert(!ctx.request.body.writableEnded);
    setTimeout(() => {
      assert(ctx.request.body.writableEnded);
    }, 200);
    setTimeout(() => {
      ctx.request.body.on('data', onRequestBodyChunk);
    }, 300);
  });

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    onHttpError,
    doSocketEnd,
    onHttpRequestEnd,
  });
  await execute(Buffer.from('GET /quan HTTP/1.1\r\nContent-Length: 4\r\nUser-Agent: quan\r\n\r\naa'));
  setTimeout(async () => {
    await execute(Buffer.from('cc'));
  }, 100);
  setTimeout(() => {
    assert.equal(doSocketEnd.mock.calls.length, 0);
    assert.equal(onHttpError.mock.calls.length, 0);
    assert.equal(onHttpRequestEnd.mock.calls.length, 1);
  }, 200);
  setTimeout(() => {
    assert.equal(onRequestBodyChunk.mock.calls.length, 2);
    assert.equal(onHttpError.mock.calls.length, 1);
  }, 500);
});

test('attachRequest onResponse with no response', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onRequest = mock.fn((ctx) => {
    assert.equal(ctx.request.body.toString(), 'aacc');
    assert.equal(ctx.response, null);
  });

  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.onRequest = onRequest;
  });
  const onHttpError = mock.fn(() => {});

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    doSocketEnd,
    onHttpRequestHeader,
    onHttpError,
  });
  await execute(Buffer.from('GET /quan HTTP/1.1\r\nContent-Length: 4\r\nUser-Agent: quan\r\n\r\naa'));
  setTimeout(async () => {
    await execute(Buffer.from('cc'));
  }, 100);

  setTimeout(() => {
    assert.equal(onRequest.mock.calls.length, 1);
    assert.equal(doSocketEnd.mock.calls.length, 1);
  }, 200);
});

test('attachRequest onResponse with response', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onRequest = mock.fn((ctx) => {
    assert.equal(ctx.request.body.toString(), 'aabb');
    ctx.response = {
      headers: {
        server: 'quan',
      },
      body: 'aaa',
    };
  });

  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.onRequest = onRequest;
  });
  const onHttpError = mock.fn(() => {});

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    doSocketEnd,
    onHttpRequestHeader,
    onHttpError,
  });
  await execute(Buffer.from('GET /quan HTTP/1.1\r\nContent-Length: 4\r\nUser-Agent: quan\r\n\r\naabb'));

  setTimeout(() => {
    assert.equal(onRequest.mock.calls.length, 1);
    assert.equal(onHttpError.mock.calls.length, 0);
  }, 200);
});

test('attachRequest by abort', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onHttpError = mock.fn(() => {});

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    doSocketEnd,
    onHttpError,
  });

  await execute(Buffer.from('GET /quan HTTP/1.1\r\nContent-Length: 4\r\nUser-Agent: quan\r\n\r\naa'));
  setTimeout(async () => {
    await execute(Buffer.from('c'));
  }, 100);
  setTimeout(async () => {
    controller.abort();
    try {
      await execute(Buffer.from('b'));
    } catch (error) {
      assert(error instanceof assert.AssertionError);
    }
  }, 150);

  setTimeout(() => {
    assert.equal(onHttpError.mock.calls.length, 0);
    assert.equal(doSocketEnd.mock.calls.length, 0);
  }, 200);
});

test('attachRequest request by nobody and noresponse', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.response.statusCode, 503);
  });
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.request.headers['content-length'], 0);
    assert.equal(ctx.request.headers.body, null);
  });
  const onHttpResponseEnd = mock.fn(() => {});

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    doSocketEnd,
    onHttpError,
    onHttpRequestEnd,
    onHttpResponseEnd,
  });

  await execute(Buffer.from('GET /quan HTTP/1.1\r\nContent-Length: 0\r\nUser-Agent: quan\r\n\r\n'));

  setTimeout(() => {
    assert.equal(onHttpRequestEnd.mock.calls.length, 1);
    assert.equal(onHttpError.mock.calls.length, 1);
    assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  }, 200);
});

test('attachRequest request by nobody', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onHttpError = mock.fn(() => {});
  const onHttpRequestEnd = mock.fn((ctx) => {
    ctx.response = {
      _headers: {
        server: 'quan',
      },
      body: 'xxx',
    };
  });

  const onHttpResponseEnd = mock.fn((ctx) => {
    assert.equal(ctx.response.body, 'xxx');
  });

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    doSocketEnd,
    onHttpError,
    onHttpRequestEnd,
    onHttpResponseEnd,
  });

  await execute(Buffer.from('GET /quan HTTP/1.1\r\nContent-Length: 0\r\nUser-Agent: quan\r\n\r\n'));

  setTimeout(() => {
    assert.equal(onHttpRequestEnd.mock.calls.length, 1);
    assert.equal(onHttpError.mock.calls.length, 0);
    assert.equal(doSocketEnd.mock.calls.length, 0);
    assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  }, 200);
});

test('attachRequest onResponse', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onHttpError = mock.fn(() => {});
  const onResponse = mock.fn((ctx) => {
    assert.equal(ctx.response, null);
    ctx.response = {
      headers: {},
      body: 'xxx',
    };
  });
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.onResponse = onResponse;
  });
  const onHttpResponseEnd = mock.fn((ctx) => {
    assert.equal(ctx.response.body, 'xxx');
  });

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    doSocketEnd,
    onHttpError,
    onHttpRequestHeader,
    onHttpResponseEnd,
  });

  await execute(Buffer.from('GET /quan HTTP/1.1\r\nContent-Length: 0\r\nUser-Agent: quan\r\n\r\n'));

  setTimeout(() => {
    assert.equal(onHttpError.mock.calls.length, 0);
    assert.equal(doSocketEnd.mock.calls.length, 0);
    assert.equal(onResponse.mock.calls.length, 1);
    assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  }, 200);
});

test('attachRequest onResponse with abort', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onHttpError = mock.fn(() => {});
  const onResponse = mock.fn(async () => {
    controller.abort();
  });
  const onHttpRequestHeader = mock.fn((ctx) => {
    ctx.onResponse = onResponse;
  });
  const onHttpResponseEnd = mock.fn(() => {});

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    doSocketEnd,
    onHttpError,
    onHttpRequestHeader,
    onHttpResponseEnd,
  });

  await execute(Buffer.from('GET /quan HTTP/1.1\r\nContent-Length: 0\r\nUser-Agent: quan\r\n\r\n'));

  setTimeout(() => {
    assert.equal(onHttpError.mock.calls.length, 0);
    assert.equal(doSocketEnd.mock.calls.length, 0);
    assert.equal(onResponse.mock.calls.length, 1);
    assert.equal(onHttpResponseEnd.mock.calls.length, 0);
  }, 200);
});

test('attachRequest forward unable connect', async () => {
  const controller = new AbortController();
  const doSocketEnd = mock.fn(() => {});
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.response.statusCode, 502);
  });
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.requestForward, null);
    ctx.requestForward = {
      port: 9998,
      hostname: '127.0.0.1',
    };
  });
  const onForwardConnecting = mock.fn((ctx) => {
    assert.equal(ctx.requestForward.path, '/quan');
    assert.equal(ctx.requestForward.method, 'GET');
    assert.equal(ctx.requestForward.port, 'GET');
    assert.equal(ctx.requestForward.protocol, 'http:');
  });
  const onHttpResponseEnd = mock.fn(() => {});

  const execute = attachRequest({
    signal: controller.signal,
    socket: new PassThrough(),
    doSocketEnd,
    onHttpError,
    onHttpRequestHeader,
    onHttpResponseEnd,
    onForwardConnecting,
  });

  await execute(Buffer.from('GET /quan HTTP/1.1\r\nContent-Length: 0\r\nUser-Agent: quan\r\n\r\n'));

  setTimeout(() => {
    assert.equal(onHttpError.mock.calls.length, 1);
    assert.equal(doSocketEnd.mock.calls.length, 1);
    assert.equal(onHttpResponseEnd.mock.calls.length, 0);
    assert.equal(onForwardConnecting.mock.calls.length, 1);
  }, 200);
});
