/* eslint no-use-before-define: 0 */
import process from 'node:process';
import attachRequest from './attachRequest.mjs';

export default ({
  onSocketConnect,
  ...hooks
}) => (socket) => {
  if (onSocketConnect) {
    onSocketConnect(socket);
  }

  const controller = new AbortController();

  const state = {
    isEndEventBind: false,
    isErrorEventBind: true,
    isEndEmit: false,
    encode: null,
  };

  function bindEncode() {
    state.encode = attachRequest({
      socket,
      signal: controller.signal,
      doSocketEnd,
      detach: () => {
        if (controller.signal.aborted
          || socket.destroyed
          || state.isEndEventBind) {
          return null;
        }
        socket.off('data', handleDataOnSocket);
        socket.off('close', handleCloseOnSocket);
        socket.off('error', handleErrorOnSocket);
        return socket;
      },
      ...hooks,
    });

    socket.on('data', handleDataOnSocket);
  }

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
      try {
        await state.encode(chunk);
      } catch (error) {
        if (!socket.destroyed) {
          socket.destroy();
        }
      }
    }
  }

  function handleSocketEnd() {
    state.isEndEventBind = false;
    unbindError();
  }

  function handleCloseOnSocket() {
    if (socket.eventNames().includes('data')) {
      socket.off('data', handleDataOnSocket);
    }
    unbindError();
    if (!controller.signal.aborted) {
      controller.abort();
    }
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
  }

  if (!socket.destroyed) {
    socket.once('error', handleErrorOnSocket);
    socket.once('close', handleCloseOnSocket);

    process.nextTick(() => {
      if (!controller.signal.aborted) {
        bindEncode();
      }
    });
  }
};
