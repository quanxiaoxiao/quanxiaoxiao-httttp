/* eslint no-use-before-define: 0 */
import process from 'node:process';
import assert from 'node:assert';
import attachRequest from './attachRequest.mjs';
import { getCurrentDateTime } from './dateTime.mjs';

export default ({
  onFinish,
  ...hooks
}) => (socket) => { // eslint-disable-line consistent-return
  const controller = new AbortController();
  const { remoteAddress } = socket;

  const state = {
    dateTimeCreate: getCurrentDateTime(),
    isEndEventBind: false,
    isErrorEventBind: false,
    isEndEmit: false,
    remoteAddress,
    encode: null,
    complete: false,
    signal: controller.signal,
    detached: false,
    count: 0,
    bytesRead: 0,
    bytesWritten: 0,
  };

  function doSocketEnd(chunk) {
    if (!controller.signal.aborted
      && !state.isEndEmit
      && !socket.destroyed) {
      state.isEndEmit = true;
      socket.off('data', handleDataOnSocket);
      socket.off('close', handleCloseOnSocket);
      controller.abort();
      if (socket.writable) {
        state.isEndEventBind = true;
        socket.once('end', handleSocketEnd);
        socket.end(chunk);
      } else {
        socket.destroy();
        unbindError();
      }
    }
  }

  function bindEncode() {
    state.encode = attachRequest({
      socket,
      signal: controller.signal,
      doSocketEnd,
      detach: () => {
        assert(!state.detached);
        if (controller.signal.aborted
          || socket.destroyed
          || state.isEndEventBind) {
          return null;
        }
        socket.off('data', handleDataOnSocket);
        socket.off('close', handleCloseOnSocket);
        socket.off('error', handleErrorOnSocket);
        state.detached = true;
        return socket;
      },
      ...hooks,
    });

    socket.on('data', handleDataOnSocket);
  }

  function unbindError() {
    if (state.isErrorEventBind) {
      setTimeout(() => {
        if (state.isErrorEventBind) {
          state.isErrorEventBind = false;
          socket.off('error', handleErrorOnSocket);
        }
      }, 100);
    }
  }

  async function handleDataOnSocket(chunk) {
    if (controller.signal.aborted) {
      socket.off('data', handleDataOnSocket);
      if (!socket.destroyed) {
        socket.destroy();
      }
    } else {
      state.bytesRead += chunk.length;
      try {
        await state.encode(chunk);
      } catch (error) {
        if (!socket.destroyed) {
          socket.destroy();
        }
      }
    }
  }

  function emitFinish() {
    assert(state.signal.aborted);
    if (!state.complete
      && onFinish
      && !state.detached
    ) {
      state.complete = true;
      onFinish({
        remoteAddress: state.remoteAddress,
        dateTimeCreate: state.dateTimeCreate,
        bytesRead: state.bytesRead,
        bytesWritten: state.bytesWritten,
        count: state.count,
      });
    }
  }

  function handleSocketEnd() {
    state.isEndEventBind = false;
    unbindError();
    emitFinish();
  }

  function handleCloseOnSocket() {
    if (socket.eventNames().includes('data')) {
      socket.off('data', handleDataOnSocket);
    }
    unbindError();
    if (!controller.signal.aborted) {
      controller.abort();
    }
    emitFinish();
  }

  function handleErrorOnSocket() {
    state.isErrorEventBind = false;
    if (socket.eventNames().includes('data')) {
      socket.off('data', handleDataOnSocket);
    }
    if (state.isEndEventBind) {
      state.isEndEventBind = false;
      socket.off('end', handleSocketEnd);
    } else {
      socket.off('close', handleCloseOnSocket);
    }
    if (!controller.signal.aborted) {
      controller.abort();
    }
    if (!socket.destroyed) {
      socket.destroy();
    }
    emitFinish();
  }

  if (!socket.destroyed) {
    state.isErrorEventBind = true;
    socket.once('error', handleErrorOnSocket);
    if (!controller.signal.aborted) {
      socket.once('close', handleCloseOnSocket);
    }

    process.nextTick(() => {
      if (!controller.signal.aborted) {
        bindEncode();
      }
    });
  } else {
    controller.abort();
    emitFinish();
  }
};
