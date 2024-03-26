import { PassThrough, Readable } from 'node:stream';
import { test, mock } from 'node:test';
import assert from 'node:assert';
import handleSocketRequest from './handleSocketRequest.mjs';

test('handleSocketRequest', () => {
  const socket = new PassThrough();
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
    assert.deepEqual(ctx.request.headers, { 'content-length': 5, name: 'quan' });
    assert.deepEqual(ctx.request.headersRaw, ['Content-Length', '5', 'Name', 'quan']);
  });
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert(ctx.request.body instanceof Readable);
    const bufList = [];
    ctx.request.body.on('data', (chunk) => {
      bufList.push(chunk);
    });
    ctx.request.body.on('end', () => {
      assert.equal(
        Buffer.concat(bufList).toString(),
        'abcde',
      );
    });
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

  const onHttpError = mock.fn(() => {});
  handleSocketRequest({
    socket,
    onHttpRequestStartLine,
    onHttpRequestHeader,
    onHttpRequestEnd,
    onHttpResponseEnd,
    onHttpError,
  });
  socket.write(Buffer.from('POST /aaa?name=bbb&big=foo HTTP/1.1\r\n'));
  socket.write(Buffer.from('Content-Length: 5\r\nName: quan\r\n\r\n'));
  socket.write(Buffer.from('abcdef'));
  setTimeout(() => {
    assert.equal(onHttpRequestStartLine.mock.calls.length, 1);
    assert.equal(onHttpRequestHeader.mock.calls.length, 1);
    assert.equal(onHttpRequestEnd.mock.calls.length, 1);
    assert.equal(onHttpError.mock.calls.length, 0);
    assert.equal(onHttpResponseEnd.mock.calls.length, 1);
  }, 100);
});

test('handleSocketRequest with request body stream', () => {
  const socket = new PassThrough();
  const requestBody = new PassThrough();
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.request.body, null);
    ctx.request.body = requestBody;
  });
  const onHttpRequestEnd = mock.fn((ctx) => {
    assert.equal(ctx.request.body, requestBody);
  });
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.response.statusCode, 503);
    assert(socket.eventNames().includes('data'));
    const handleData = mock.fn((chunk) => {
      assert(/^HTTP\/1\.1 503 /.test(chunk.toString()));
    });
    socket.once('data', handleData);
    process.nextTick(() => {
      assert(socket.writableEnded);
      assert.equal(handleData.mock.calls.length, 1);
      assert(!socket.eventNames().includes('data'));
    });
  });
  const onHttpResponseEnd = mock.fn(() => {});

  handleSocketRequest({
    socket,
    onHttpRequestHeader,
    onHttpRequestEnd,
    onHttpResponseEnd,
    onHttpError,
  });
  socket.write(Buffer.from('POST /aaa?name=bbb&big=foo HTTP/1.1\r\n'));
  socket.write(Buffer.from('Content-Length: 6\r\nName: quan\r\n\r\n'));
  socket.write(Buffer.from('aa'));
  setTimeout(() => {
    socket.write(Buffer.from('bb'));
  }, 100);
  setTimeout(() => {
    socket.write(Buffer.from('cc'));
  }, 150);
  setTimeout(() => {
    assert.equal(onHttpRequestHeader.mock.calls.length, 1);
    assert.equal(onHttpRequestEnd.mock.calls.length, 1);
    assert.equal(onHttpResponseEnd.mock.calls.length, 0);
    assert.equal(onHttpError.mock.calls.length, 0);
    assert(requestBody.eventNames().includes('pause'));
    assert(requestBody.eventNames().includes('resume'));
    assert(requestBody.eventNames().includes('end'));
  }, 300);

  setTimeout(() => {
    const handleData = mock.fn(() => {});

    const handleEnd = mock.fn(() => {
      assert.equal(handleData.mock.calls.length, 3);
    });
    requestBody.on('data', handleData);
    requestBody.on('end', handleEnd);
    setTimeout(() => {
      assert.equal(handleEnd.mock.calls.length, 1);
      assert.equal(onHttpError.mock.calls.length, 1);
      assert.equal(onHttpResponseEnd.mock.calls.length, 0);
    }, 100);
  }, 500);
});
