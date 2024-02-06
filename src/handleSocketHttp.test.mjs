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
  const pass = new PassThrough();
  const getState = handleSocketHttp({})(pass);
  setTimeout(() => {
    assert(pass.eventNames().includes('error'));
    assert(getState().isErrorEventBind);
    pass.emit('error', new Error('error'));
    assert(!pass.eventNames().includes('error'));
    assert(!pass.eventNames().includes('data'));
    assert(!pass.eventNames().includes('close'));
    assert(getState().signal.aborted);
    assert(!getState().isErrorEventBind);
  }, 100);
});

test('handleSocketHttp socket onData with invalid http chunk', () => {
  const pass = new PassThrough();
  const onHttpError = mock.fn(() => {});
  const onHttpRequestStartLine = mock.fn(() => {});

  const getState = handleSocketHttp({
    onHttpError,
    onHttpRequestStartLine,
  })(pass);

  setTimeout(() => {
    pass.write(Buffer.from('GET /test HTTP/1.1\n\n'));
    setImmediate(() => {
      assert(getState().isEndEmit);
      assert(getState().signal.aborted);
      assert(getState().isErrorEventBind);
      assert(!pass.eventNames().includes('data'));
      assert(!pass.eventNames().includes('close'));
    });
  }, 100);

  setTimeout(() => {
    assert(pass.destroyed);
    assert(getState().signal.aborted);
    assert(!pass.eventNames().includes('error'));
    assert(!pass.eventNames().includes('data'));
    assert(!pass.eventNames().includes('close'));
    assert(!pass.eventNames().includes('end'));
    assert(!getState().isErrorEventBind);
    assert.equal(onHttpError.mock.calls.length, 1);
    assert.equal(onHttpError.mock.calls[0].arguments[0].error.statusCode, 400);
    assert.equal(onHttpRequestStartLine.mock.calls.length, 0);
  }, 500);
});
