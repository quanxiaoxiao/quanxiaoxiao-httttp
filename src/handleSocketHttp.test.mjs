import { test, mock } from 'node:test';
import assert from 'node:assert';
import { PassThrough } from 'node:stream';
import handleSocketHttp from './handleSocketHttp.mjs';

test('handleSocketHttp', () => {
  const pass = new PassThrough();
  const onFinish = mock.fn((state) => {
    assert.equal(typeof state.dateTimeCreate, 'number');
    assert.equal(state.bytesRead, 0);
    assert.equal(state.bytesWritten, 0);
    assert.equal(state.count, 0);
  });
  handleSocketHttp({
    onFinish,
  })(pass);
  assert(pass.eventNames().includes('error'));
  assert(pass.eventNames().includes('close'));
  assert(!pass.eventNames().includes('data'));
  assert.equal(onFinish.mock.calls.length, 0);
  setImmediate(() => {
    assert(pass.eventNames().includes('data'));
    pass.end();
  });
  setTimeout(() => {
    assert.equal(onFinish.mock.calls.length, 1);
    assert(!pass.eventNames().includes('data'));
    assert(!pass.eventNames().includes('close'));
    assert(!pass.eventNames().includes('end'));
  }, 100);
  setTimeout(() => {
    assert(!pass.eventNames().includes('error'));
  }, 500);
});

test('handleSocketHttp destroyed socket before handler', () => {
  const onFinish = mock.fn((state) => {
    assert.equal(typeof state.dateTimeCreate, 'number');
    assert.equal(state.bytesRead, 0);
    assert.equal(state.bytesWritten, 0);
    assert.equal(state.count, 0);
  });
  const pass = new PassThrough();
  pass.destroy();
  handleSocketHttp({
    onFinish,
  })(pass);
  assert(!pass.eventNames().includes('error'));
  assert(!pass.eventNames().includes('close'));
  assert(!pass.eventNames().includes('data'));
  setImmediate(() => {
    assert.equal(onFinish.mock.calls.length, 1);
    assert(!pass.eventNames().includes('error'));
    assert(!pass.eventNames().includes('close'));
  });
});

test('handleSocketHttp destroyed socket after handler', () => {
  const onFinish = mock.fn((state) => {
    assert.equal(typeof state.dateTimeCreate, 'number');
    assert.equal(state.bytesRead, 0);
    assert.equal(state.bytesWritten, 0);
    assert.equal(state.count, 0);
  });
  const pass = new PassThrough();
  handleSocketHttp({
    onFinish,
  })(pass);
  pass.destroy();
  setImmediate(() => {
    assert.equal(onFinish.mock.calls.length, 1);
    assert(!pass.eventNames().includes('data'));
  });
  setTimeout(() => {
    assert(!pass.eventNames().includes('error'));
  }, 500);
});

test('handleSocketHttp socket emit error', () => {
  const onFinish = mock.fn((state) => {
    assert.equal(typeof state.dateTimeCreate, 'number');
    assert.equal(state.bytesRead, 0);
    assert.equal(state.bytesWritten, 0);
    assert.equal(state.count, 0);
  });
  const pass = new PassThrough();
  handleSocketHttp({
    onFinish,
  })(pass);
  setTimeout(() => {
    assert(pass.eventNames().includes('error'));
    assert.equal(onFinish.mock.calls.length, 0);
    pass.emit('error', new Error('error'));
    assert(!pass.eventNames().includes('error'));
    assert(!pass.eventNames().includes('data'));
    assert(!pass.eventNames().includes('close'));
    assert.equal(onFinish.mock.calls.length, 1);
  }, 100);
});

test('handleSocketHttp socket onData with invalid http chunk', () => {
  const buf = Buffer.from('GET /test HTTP/1.1\n\n');
  const onFinish = mock.fn((state) => {
    assert.equal(typeof state.dateTimeCreate, 'number');
    assert.equal(state.bytesRead, buf.length);
    assert.equal(state.bytesWritten, 0);
    assert.equal(state.count, 1);
  });
  const pass = new PassThrough();
  const _end = pass.end;
  const end = mock.fn((chunk) => {
    assert(/^HTTP\/1\.1 400 /.test(chunk.toString()));
    return _end.call(pass, chunk);
  });
  pass.end = end;
  const onHttpRequestStartLine = mock.fn(() => {});
  const onHttpError = mock.fn((ctx) => {
    assert.equal(ctx.error.statusCode, 400);
    assert.equal(onFinish.mock.calls.length, 0);
  });

  handleSocketHttp({
    onHttpError,
    onHttpRequestStartLine,
    onFinish,
  })(pass);

  setTimeout(() => {
    pass.write(Buffer.from(buf));
    setImmediate(() => {
      assert(!pass.eventNames().includes('data'));
      assert(!pass.eventNames().includes('close'));
    });
  }, 100);

  setTimeout(() => {
    assert(pass.destroyed);
    assert(!pass.eventNames().includes('error'));
    assert(!pass.eventNames().includes('data'));
    assert(!pass.eventNames().includes('close'));
    assert(!pass.eventNames().includes('end'));
    assert.equal(onFinish.mock.calls.length, 1);
    assert.equal(onHttpError.mock.calls.length, 1);
    assert.equal(onHttpRequestStartLine.mock.calls.length, 0);
    assert.equal(end.mock.calls.length, 1);
  }, 500);
});
