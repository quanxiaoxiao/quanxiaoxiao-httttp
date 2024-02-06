import { PassThrough } from 'node:stream';
import { test, mock } from 'node:test';
import assert from 'node:assert';
import attachRequest from './attachRequest.mjs';

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
