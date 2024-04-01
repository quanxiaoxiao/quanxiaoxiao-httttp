import { PassThrough, Readable } from 'node:stream';
import { test, mock } from 'node:test';
import assert from 'node:assert';
import _ from 'lodash';
import { encodeHttp } from '@quanxiaoxiao/http-utils';
import handleSocketRequest from './handleSocketRequest.mjs';

const waitFor = async (t = 100) => {
  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, t);
  });
};

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

test('handleSocketRequest with request body stream 1', () => {
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
    assert(requestBody.writableEnded);
    assert.equal(onHttpError.mock.calls.length, 0);
    const handleDataOnRequestBody = mock.fn(() => {});
    requestBody.on('data', handleDataOnRequestBody);
    setTimeout(() => {
      assert.equal(onHttpError.mock.calls.length, 1);
      assert.equal(handleDataOnRequestBody.mock.calls.length, 3);
    }, 100);
  }, 300);
});

test('handleSocketRequest request chunk invalid', () => {
  const socket = new PassThrough();
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.response.statusCode, 400);
    assert(socket.eventNames().includes('data'));
    assert(socket.eventNames().includes('drain'));
    setTimeout(() => {
      assert(socket.destroyed);
      assert(!socket.eventNames().includes('data'));
      assert(!socket.eventNames().includes('drain'));
    }, 100);
  });
  const onHttpRequestStartLine = mock.fn(() => {});
  handleSocketRequest({
    socket,
    onHttpError,
    onHttpRequestStartLine,
  });
  socket.write(Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\naa'));
  setTimeout(() => {
    assert.equal(onHttpError.mock.calls.length, 1);
    assert.equal(onHttpRequestStartLine.mock.calls.length, 0);
  }, 200);
});

test('handleSocketRequest onHttpRequestStartLine trigger error', () => {
  const socket = new PassThrough();
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.response.statusCode, 500);
    assert.equal(ctx.error.message, 'xxx');
    assert(socket.eventNames().includes('data'));
    assert(socket.eventNames().includes('drain'));
    setTimeout(() => {
      assert(socket.destroyed);
      assert(!socket.eventNames().includes('data'));
      assert(!socket.eventNames().includes('drain'));
    }, 100);
  });
  const onHttpRequestStartLine = mock.fn(async (ctx) => {
    assert.equal(ctx.request.path, '/aaa');
    await waitFor(100);
    throw new Error('xxx');
  });
  const onHttpRequestHeader = mock.fn(() => {});
  handleSocketRequest({
    socket,
    onHttpError,
    onHttpRequestStartLine,
    onHttpRequestHeader,
  });
  socket.write(Buffer.from('POST /aaa HTTP/1.1\r\nContent-Length: 2\r\n\r\naa'));
  setTimeout(() => {
    assert.equal(onHttpError.mock.calls.length, 1);
    assert.equal(onHttpRequestStartLine.mock.calls.length, 1);
    assert.equal(onHttpRequestHeader.mock.calls.length, 0);
  }, 500);
});

test('handleSocketRequest onHttpRequestHeader trigger error', () => {
  const socket = new PassThrough();
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.response.statusCode, 500);
    assert.equal(ctx.error.message, 'xxx');
    assert(socket.eventNames().includes('data'));
    assert(socket.eventNames().includes('drain'));
    setTimeout(() => {
      assert(socket.destroyed);
      assert(!socket.eventNames().includes('data'));
      assert(!socket.eventNames().includes('drain'));
    }, 100);
  });
  const onHttpRequestHeader = mock.fn(async (ctx) => {
    assert.equal(ctx.request.path, '/aaa');
    assert.deepEqual(ctx.request.headers, { 'content-length': 2 });
    await waitFor(100);
    throw new Error('xxx');
  });
  const onHttpRequestEnd = mock.fn(() => {});
  handleSocketRequest({
    socket,
    onHttpError,
    onHttpRequestHeader,
    onHttpRequestEnd,
  });
  socket.write(Buffer.from('POST /aaa HTTP/1.1\r\nContent-Length: 2\r\n\r\naa'));
  setTimeout(() => {
    assert.equal(onHttpError.mock.calls.length, 1);
    assert.equal(onHttpRequestHeader.mock.calls.length, 1);
    assert.equal(onHttpRequestEnd.mock.calls.length, 0);
  }, 500);
});

test('handleSocketRequest with request body stream 2', () => {
  const socket = new PassThrough();
  const requestBody = new PassThrough();
  const onHttpError = mock.fn(() => {
  });
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.request.body, null);
    assert.deepEqual(ctx.request.headers, { name: 'quan', 'transfer-encoding': 'chunked' });
    ctx.request.body = requestBody;
  });
  const onHttpRequestEnd = mock.fn(() => {});
  handleSocketRequest({
    socket,
    onHttpError,
    onHttpRequestHeader,
    onHttpRequestEnd,
  });
  const encode = encodeHttp({
    headers: {
      name: 'quan',
    },
    method: 'POST',
  });
  socket.write(encode('aaa'));
  const count = 3000;
  let i = 0;
  const content = 'asdfasdfasdf asdfw';
  setTimeout(() => {
    const s = _.times(100).map(() => content).join('');
    const tick = setInterval(() => {
      socket.write(encode(`${s}:${i}`));
      if (i >= count) {
        clearInterval(tick);
        socket.write(encode());
      }
      i++;
    });
  }, 100);
});

test('handleSocketRequest with request body stream 3', () => {
  const socket = new PassThrough();
  const requestBody = new PassThrough();
  const onHttpError = mock.fn(() => {});
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.request.body, null);
    assert.deepEqual(ctx.request.headers, { name: 'quan', 'transfer-encoding': 'chunked' });
    ctx.request.body = requestBody;
  });
  const onHttpRequestEnd = mock.fn(() => {});
  const handleRequestBodyOnData = mock.fn(() => {
  });
  requestBody.on('data', handleRequestBodyOnData);
  handleSocketRequest({
    socket,
    onHttpError,
    onHttpRequestHeader,
    onHttpRequestEnd,
  });
  const encode = encodeHttp({
    headers: {
      name: 'quan',
    },
    method: 'POST',
  });
  socket.write(encode('aaa'));
  setTimeout(() => {
    assert(!requestBody.destroyed);
    assert(requestBody.eventNames().includes('close'));
    assert(requestBody.eventNames().includes('drain'));
    assert(requestBody.eventNames().includes('error'));
    socket.write(encode('cccee'));
    assert(socket.eventNames().includes('data'));
    assert(socket.eventNames().includes('close'));
    assert(socket.eventNames().includes('drain'));
    assert(socket.eventNames().includes('error'));
    socket.destroy();
  }, 100);
  setTimeout(() => {
    assert(requestBody.destroyed);
    assert(!requestBody.eventNames().includes('error'));
    assert(!requestBody.eventNames().includes('close'));
    assert(!requestBody.eventNames().includes('drain'));
    assert.equal(onHttpRequestEnd.mock.calls.length, 0);
    assert.equal(onHttpError.mock.calls.length, 0);
    assert.equal(handleRequestBodyOnData.mock.calls.length, 2);
    assert.equal(handleRequestBodyOnData.mock.calls[0].arguments[0].toString(), 'aaa');
    assert(!socket.eventNames().includes('data'));
    assert(!socket.eventNames().includes('close'));
    assert(!socket.eventNames().includes('drain'));
    assert(!socket.eventNames().includes('error'));
  }, 300);
});

test('handleSocketRequest with request body stream 4', () => {
  const socket = new PassThrough();
  const requestBody = new PassThrough();
  const onHttpError = mock.fn((ctx) => {
    assert(ctx.error instanceof Error);
  });
  const onHttpRequestHeader = mock.fn((ctx) => {
    assert.equal(ctx.request.body, null);
    assert.deepEqual(ctx.request.headers, { name: 'quan', 'transfer-encoding': 'chunked' });
    ctx.request.body = requestBody;
  });
  const onHttpRequestEnd = mock.fn(() => {});
  const handleRequestBodyOnData = mock.fn(() => {
  });
  requestBody.on('data', handleRequestBodyOnData);
  handleSocketRequest({
    socket,
    onHttpError,
    onHttpRequestHeader,
    onHttpRequestEnd,
  });
  const encode = encodeHttp({
    headers: {
      name: 'quan',
    },
    method: 'POST',
  });
  socket.write(encode('aaa'));
  setTimeout(() => {
    assert(!requestBody.destroyed);
    assert(socket.eventNames().includes('close'));
    assert(socket.eventNames().includes('data'));
    assert(socket.eventNames().includes('drain'));
    assert(socket.eventNames().includes('error'));
    requestBody.destroy();
  }, 100);

  setTimeout(() => {
    assert(!socket.eventNames().includes('close'));
    assert(!socket.eventNames().includes('data'));
    assert(!socket.eventNames().includes('drain'));
    assert(!socket.eventNames().includes('error'));
    assert(!requestBody.eventNames().includes('error'));
    assert(!requestBody.eventNames().includes('close'));
    assert(!requestBody.eventNames().includes('drain'));
    assert.equal(onHttpRequestEnd.mock.calls.length, 0);
    assert.equal(onHttpError.mock.calls.length, 1);
  }, 300);
});
