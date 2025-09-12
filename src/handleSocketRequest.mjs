import assert from 'node:assert';
import {
  PassThrough,
  Readable,
  Writable,
} from 'node:stream';

import {
  DecodeHttpError,
  decodeHttpRequest,
  encodeHttp,
  getHeaderValue,
  hasHttpBodyContent,
  isHttpWebSocketUpgrade,
  parseHttpPath,
  parseHttpUrl,
} from '@quanxiaoxiao/http-utils';
import {
  wrapStreamRead,
  wrapStreamWrite,
} from '@quanxiaoxiao/node-utils';
import { createConnector } from '@quanxiaoxiao/socket';
import createError from 'http-errors';

import attachResponseError from './attachResponseError.mjs';
import {
  HTTP_STEP_EMPTY,
  HTTP_STEP_REQUEST_BODY,
  HTTP_STEP_REQUEST_COMPLETE,
  HTTP_STEP_REQUEST_CONTENT_WAIT_CONSUME,
  HTTP_STEP_REQUEST_END,
  HTTP_STEP_REQUEST_HEADER,
  HTTP_STEP_REQUEST_START,
  HTTP_STEP_REQUEST_START_LINE,
  HTTP_STEP_REQUEST_WEBSOCKET_CONNECTION,
  HTTP_STEP_RESPONSE_END,
  HTTP_STEP_RESPONSE_ERROR,
  HTTP_STEP_RESPONSE_HEADER_SPEND,
  HTTP_STEP_RESPONSE_READ_CONTENT_CHUNK,
  HTTP_STEP_RESPONSE_READ_CONTENT_END,
  HTTP_STEP_RESPONSE_START,
  HTTP_STEP_RESPONSE_WAIT,
} from './constants.mjs';
import generateResponse from './generateResponse.mjs';
import isSocketEnable from './isSocketEnable.mjs';

const DEFAULT_TIMEOUT = 60_000;

const safeExecute = async (handler, ...args) => {
  if (!handler) return;
  try {
    await handler(...args);
  } catch (error) {
    console.warn('Handler execution error:', error);
    throw error;
  }
};

const createRequestContext = () => ({
  request: {
    url: null,
    dateTimeCreate: Date.now(),
    timeOnStart: performance.now(),
    timeOnStartLine: null,
    timeOnHeader: null,
    timeOnBody: null,
    timeOnEnd: null,
    connection: false,
    method: null,
    path: null,
    httpVersion: null,
    headersRaw: [],
    headers: {},
    body: null,
    pathname: null,
    querystring: '',
    query: {},
    bytesBody: 0,
  },
  response: null,
  error: null,
});

const createInitialState = () => ({
  ctx: null,
  isSocketCloseEmit: false,
  dateTimeCreate: Date.now(),
  timeOnStart: performance.now(),
  timeOnLastIncoming: null,
  timeOnLastOutgoing: null,
  bytesIncoming: 0,
  bytesOutgoing: 0,
  count: 0,
  currentStep: HTTP_STEP_EMPTY,
  execute: null,
  connector: null,
});

const createTimeUpdater = (state) => ({
  updateIncoming: () => {
    state.timeOnLastIncoming = performance.now() - state.timeOnStart;
  },
  updateOutgoing: () => {
    state.timeOnLastOutgoing = performance.now() - state.timeOnStart;
  },
});

const createStateManager = (state, controller) => ({
  isValid: () => !controller.signal.aborted && state.ctx && !state.ctx.error,
  isSocketValid: (socket) => !socket.destroyed && !controller.signal.aborted,
  setStep: (step) => {
    state.currentStep = step;
  },
  setError: (error) => {
    if (!state.ctx.error) {
      state.ctx.error = error;
    }
  },
});

const calcContextTime = (ctx) => {
  assert(ctx?.request, 'Context request is required');
  return performance.now() - ctx.request.timeOnStart;
};

const parseRequestPath = (path) => {
  if (/^https?:\/\//.test(path)) {
    const urlParseResult = parseHttpUrl(path);
    const [pathname, querystring, query] = parseHttpPath(urlParseResult.path);
    return {
      path: urlParseResult.path,
      pathname,
      querystring,
      query,
    };
  }
  const [pathname, querystring, query] = parseHttpPath(path);
  return {
    path,
    pathname,
    querystring,
    query,
  };
};

const hasStreamResponseBody = (ctx) => {
  if (!ctx.response?.body || !(ctx.response.body instanceof Readable)) {
    return false;
  }

  const contentLength = ctx.response.headers
    ? getHeaderValue(ctx.response.headers, 'content-length')
    : null;

  return ctx.response.body.readable && contentLength !== 0;
};

export default (options) => {
  const {
    socket,
    onWebSocket,
    onHttpRequest,
    onHttpRequestStartLine,
    onHttpRequestHeader,
    onHttpRequestEnd,
    onHttpResponse,
    onHttpResponseEnd,
    onHttpError,
    onSocketClose,
  } = options;

  if (!isSocketEnable(socket)) {
    return false;
  }

  const controller = new AbortController();
  const state = createInitialState();
  const timeUpdater = createTimeUpdater(state);
  const stateManager = createStateManager(state, controller);

  function writeChunk(chunk) {
    const size = chunk.length;
    if (controller.signal.aborted || size === 0) {
      return false;
    }
    try {
      const ret = state.connector.write(chunk);
      timeUpdater.updateOutgoing();
      state.bytesOutgoing += size;
      return ret;
    } catch (error) {
      handleConnectorError(error); // eslint-disable-line no-use-before-define
      return false;
    }
  }

  function handleConnectorError(error) {
    if (!controller.signal.aborted) {
      controller.abort();
    }
    stateManager.setError(error);
  }

  function handleResponseEnd() {
    if (socket.destroyed || controller.signal.aborted || !stateManager.isValid()) {
      return;
    }

    const { ctx } = state;
    assert(state.currentStep < HTTP_STEP_RESPONSE_END);
    assert(ctx.response && ctx.request);
    assert(!state.ctx.error);
    assert(state.currentStep < HTTP_STEP_RESPONSE_END);

    stateManager.setStep(HTTP_STEP_RESPONSE_END);
    ctx.response.timeOnEnd = calcContextTime(state.ctx);
    state.execute = null;
    safeExecute(onHttpResponseEnd, ctx).catch(console.warn);
  }

  function handleResponseError() {
    const { ctx } = state;
    if (socket.destroyed
      || controller.signal.aborted
      || state.currentStep === HTTP_STEP_RESPONSE_END
      || state.currentStep >= HTTP_STEP_RESPONSE_HEADER_SPEND
    ) {
      shutdown(ctx.error); // eslint-disable-line no-use-before-define
      return;
    }
    if (state.currentStep === HTTP_STEP_RESPONSE_ERROR) {
      return;
    }
    state.currentStep = HTTP_STEP_RESPONSE_ERROR;
    attachResponseError(ctx);
    if (onHttpError) {
      onHttpError(ctx);
    } else {
      console.warn(ctx.error);
    }
    const chunk = encodeHttp(ctx.error.response);
    const size = chunk.length;
    try {
      state.connector.end(chunk);
      timeUpdater.updateOutgoing();
      state.bytesOutgoing += size;
    } catch (error) {
      console.warn(error);
    } finally {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
  }

  function handleHttpError(error) {
    assert(error instanceof Error);
    if (controller.signal.aborted) {
      return;
    }
    stateManager.setError(error);
    handleResponseError();
  }

  const handleStaticResponse = (ctx) => {
    try {
      const chunk = encodeHttp(generateResponse(ctx));
      stateManager.setStep(HTTP_STEP_RESPONSE_HEADER_SPEND);
      writeChunk(chunk);
      handleResponseEnd();
    } catch (error) {
      handleHttpError(error, ctx);
    }
  };

  const handleStreamResponse = (ctx) => {
    assert(!Object.hasOwnProperty.call(ctx.response, 'data'),
      'Response should not have data property');

    const encodeHttpResponse = encodeHttp({
      statusCode: ctx.response.statusCode,
      headers: ctx.response._headers || ctx.response.headersRaw || ctx.response.headers,
      body: ctx.response.body,
      onHeader: (chunk) => {
        stateManager.setStep(HTTP_STEP_RESPONSE_HEADER_SPEND);
        writeChunk(chunk);
      },
    });
    process.nextTick(() => {
      const isReadyForStreaming = !controller.signal.aborted
          && ctx.response.body.readable
          && state.currentStep === HTTP_STEP_RESPONSE_HEADER_SPEND;
      if (isReadyForStreaming) {
        stateManager.setStep(HTTP_STEP_RESPONSE_READ_CONTENT_CHUNK);
        wrapStreamRead({
          signal: controller.signal,
          stream: ctx.response.body,
          onData: (chunk) => writeChunk(encodeHttpResponse(chunk)),
          onEnd: () => {
            const chunk = encodeHttpResponse();
            stateManager.setStep(HTTP_STEP_RESPONSE_READ_CONTENT_END);
            writeChunk(chunk);
            if (stateManager.isValid()) {
              handleResponseEnd();
            }
          },
          onError: (error) => {
            stateManager.setError(error);
            if (!controller.signal.aborted) {
              console.warn(`Response body stream error: ${error.message}`);
              state.connector();
              controller.abort();
            }
          },
        });
      } else {
        if (!controller.signal.aborted) {
          state.connector();
          controller.abort();
        }
        if (!ctx.response.body.destroyed) {
          ctx.response.body.destroy();
        }
      }
    });
  };

  function handleResponse() {
    if (socket.destroyed || controller.signal.aborted) {
      return;
    }
    const { ctx } = state;
    assert(state.currentStep < HTTP_STEP_RESPONSE_START, 'Invalid step for response');
    stateManager.setStep(HTTP_STEP_RESPONSE_START);
    assert(!ctx.error, 'No error should exist during response');
    if (hasStreamResponseBody(ctx)) {
      handleStreamResponse(ctx);
    } else {
      handleStaticResponse(ctx);
    }
  }

  function shutdown(error) {
    state.connector();
    if (!controller.signal.aborted) {
      controller.abort();
    }
    handleSocketClose(error); // eslint-disable-line no-use-before-define
  }

  function createRequestBodyHandler() {
    const { ctx } = state;

    if (ctx.request.body == null) {
      ctx.request.body = new PassThrough();
    }

    assert(ctx.request.body instanceof Writable, 'Request body must be writable');

    ctx.request._write = wrapStreamWrite({
      stream: ctx.request.body,
      signal: controller.signal,
      onPause: () => {
        if (!ctx.request.isPauseDisable) {
          state.connector.pause();
        }
      },
      onDrain: () => {
        state.connector.resume();
      },
      onError: (error) => {
        if (!controller.signal.aborted) {
          stateManager.setError(new Error(`Request body stream error: ${error.message}`));
          handleResponseError();
        }
      },
    });

    ctx.request.end = (data) => {
      if (data == null) {
        ctx.request._write();
        return;
      }
      const type = typeof data;
      if (type === 'string' || Buffer.isBuffer(data)) {
        ctx.request._write(type === 'string' ? Buffer.from(data, 'utf8') : data);
        ctx.request._write();
      } else if (type === 'function') {
        ctx.request._write(data);
      } else {
        ctx.request._write();
      }
    };
  }

  const createWebSocketResponse = () => ({
    headers: {},
    headersRaw: [],
    statusCode: null,
    httpVersion: null,
    statusText: null,
    timeOnConnect: null,
    timeOnStartLine: null,
    timeOnBody: null,
    timeOnHeader: null,
    bytesBody: 0,
  });

  async function handleWebSocketUpgrade() {
    if (!onWebSocket) {
      throw createError(501);
    }
    const { ctx } = state;
    ctx.request.connection = true;
    stateManager.setStep(HTTP_STEP_REQUEST_WEBSOCKET_CONNECTION);
    state.execute = null;
    state.connector.pause();
    ctx.request.bytesBody = 0;
    ctx.response = createWebSocketResponse();
    await onWebSocket({
      ctx,
      onHttpResponseStartLine: (ret) => {
        ctx.response.timeOnStartLine = calcContextTime(ctx);;
        Object.assert(ctx.response, {
          statusCode: ret.statusCode,
          statusText: ret.statusText,
          httpVersion: ret.httpVersion,
        });
      },
      onHttpResponseHeader: (ret) => {
        ctx.response.timeOnHeader = calcContextTime(ctx);;
        ctx.response.headersRaw = ret.headersRaw;
        ctx.response.headers = ret.headers;
      },
      onHttpResponseBody: (chunk) => {
        ctx.response.bytesBody += chunk.length;
        ctx.response.timeOnBody ??= calcContextTime(ctx);
      },
      onError: (error) => {
        handleSocketClose(error); // eslint-disable-line no-use-before-define
      },
      onClose: () => {
        handleSocketClose(); // eslint-disable-line no-use-before-define
      },
      onConnect: () => {
        ctx.response.timeOnConnect = calcContextTime(ctx);
        process.nextTick(() => {
          if (!stateManager.isValid()) {
            return;
          };
          state.connector.detach();
        });
      },
      onChunkOutgoing: (chunk) => {
        state.bytesOutgoing += chunk.length;
        timeUpdater.updateOutgoing();
      },
      onChunkIncoming: (chunk) => {
        timeUpdater.updateOutgoing();
        state.bytesIncoming += chunk.length;
        ctx.request.bytesBody += chunk.length;
        ctx.response.timeOnBody ??= calcContextTime(ctx);
      },
    });
  }

  function handleHttpRequestComplete() {
    const { ctx } = state;
    assert(!controller.signal.aborted, 'Controller should not be aborted');
    assert(!ctx.error, 'No error should exist');
    assert(state.currentStep < HTTP_STEP_REQUEST_COMPLETE, 'Invalid step transition');
    stateManager.setStep(HTTP_STEP_REQUEST_COMPLETE);
    if (onHttpResponse) {
      stateManager.setStep(HTTP_STEP_RESPONSE_WAIT);
      safeExecute(onHttpResponse, ctx)
        .then(() => {
          if (!controller.signal.aborted) {
            handleResponse(ctx);
          }
        })
        .catch(handleHttpError);
    } else {
      handleResponse(ctx);
    }
  }

  function handleSocketClose(error) {
    if (onSocketClose && !state.isSocketCloseEmit) {
      state.isSocketCloseEmit = true;

      const result = {
        dateTimeCreate: state.dateTimeCreate,
        dateTimeLastIncoming: null,
        dateTimeLastOutgoing: null,
        bytesIncoming: state.bytesIncoming,
        bytesOutgoing: state.bytesOutgoing,
        count: state.count,
        step: state.currentStep,
        error,
        request: state.ctx?.request || null,
        response: state.ctx?.response || null,
      };
      if (state.timeOnLastIncoming != null) {
        result.dateTimeLastIncoming = result.dateTimeCreate + (state.timeOnLastIncoming - state.timeOnStart);
      }
      if (state.timeOnLastOutgoing != null) {
        result.dateTimeLastOutgoing = result.dateTimeCreate + (state.timeOnLastOutgoing - state.timeOnStart);
      }
      onSocketClose(result, state.ctx);
    }
  }

  const bindExecutor = () => {
    const { ctx } = state;
    state.execute = decodeHttpRequest({
      onStartLine: async (ret) => {
        stateManager.setStep(HTTP_STEP_REQUEST_START_LINE);
        ctx.request.timeOnStartLine = calcContextTime(ctx);

        Object.assign(ctx.request, {
          httpVersion: ret.httpVersion,
          method: ret.method,
          url: ret.path,
          ...parseRequestPath(ret.path),
        });
        await safeExecute(onHttpRequestStartLine, ctx);
        assert(!ctx.response && !socket.destroyed && !controller.signal.aborted,
          'Invalid state after start line processing');
      },
      onHeader: async (ret) => {
        assert(state.currentStep === HTTP_STEP_REQUEST_START_LINE, 'Invalid step');
        stateManager.setStep(HTTP_STEP_REQUEST_HEADER);
        Object.assign(ctx.request, {
          headersRaw: ret.headersRaw,
          headers: ret.headers,
          timeOnHeader: calcContextTime(ctx),
        });
        await safeExecute(onHttpRequestHeader, ctx);
        assert(!controller.signal.aborted && !socket.destroyed,
          'Invalid state after header processing');

        if (isHttpWebSocketUpgrade(ctx.request)) {
          await handleWebSocketUpgrade();
          return;
        }
        if (hasHttpBodyContent(ctx.request.headers)) {
          createRequestBodyHandler();
          return;
        }
        if (ctx.request.body instanceof Writable && !ctx.request.body.destroyed) {
          ctx.request.body.destroy();
          ctx.request.body = null;
        }
      },
      onBody: (chunk) => {
        assert(!socket.destroyed && !controller.signal.aborted && !ctx.request.connection,
          'Invalid state for body processing');
        if (ctx.request.timeOnBody == null) {
          ctx.request.timeOnBody = calcContextTime(ctx);
          if (state.currentStep < HTTP_STEP_REQUEST_BODY) {
            stateManager.setStep(HTTP_STEP_REQUEST_BODY);
          }
        }
        ctx.request._write(chunk);
      },
      onEnd: async (ret) => {
        if (ctx.request.connection) {
          return;
        }

        if (ctx.request._write) {
          assert(ctx.request.body instanceof Writable && !ctx.request.body.writableEnded,
            'Body must be writable and not ended');
        }

        if (state.currentStep < HTTP_STEP_REQUEST_END) {
          stateManager.setStep(HTTP_STEP_REQUEST_END);
        }

        ctx.request.timeOnEnd = calcContextTime(ctx);
        ctx.request.timeOnBody ??= ctx.request.timeOnEnd;

        await safeExecute(onHttpRequestEnd, ctx);
        assert(!socket.destroyed, 'Socket should not be destroyed');

        if (controller.signal.aborted || ctx.error) {
          return;
        }

        if (ret.dataBuf.length > 0) {
          stateManager.setError(createError(400));
          handleResponseError();
          return;
        }

        const shouldWaitForConsume = !ctx.response
          && ctx.request.end
          && ctx.request.body instanceof Writable
          && !ctx.request.body.writableEnded;

        if (shouldWaitForConsume) {
          stateManager.setStep(HTTP_STEP_REQUEST_CONTENT_WAIT_CONSUME);
          ctx.request.end(handleHttpRequestComplete);
        } else {
          handleHttpRequestComplete();
        }
      },
    });
  };

  function initializeRequest() {
    stateManager.setStep(HTTP_STEP_REQUEST_START);
    state.count += 1;
    state.ctx = createRequestContext();
    Object.assign(state.ctx, {
      socket,
      signal: controller.signal,
    });

    if (onHttpRequest) {
      onHttpRequest({
        dateTimeCreate: state.dateTimeCreate,
        bytesIncoming: state.bytesIncoming,
        bytesOutgoing: state.bytesOutgoing,
        count: state.count,
        remoteAddress: socket.remoteAddress,
        ctx: state.ctx,
      });
      if (state.ctx.ws) {
        assert(state.ctx.ws instanceof Writable && state.ctx.ws.writable, 'WebSocket should be writable');
      }
    }
    bindExecutor();
  }

  function processChunk(chunk) {
    assert(!controller.signal.aborted, 'Controller should not be aborted');

    state.bytesIncoming += chunk.length;
    const isInvalidState = state.currentStep >= HTTP_STEP_REQUEST_END && state.currentStep !== HTTP_STEP_RESPONSE_END;
    if (isInvalidState) {
      handleHttpError(createError(400));
      return;
    }
    const shouldInitialize = state.currentStep === HTTP_STEP_EMPTY || state.currentStep === HTTP_STEP_RESPONSE_END;
    if (shouldInitialize) {
      assert(!state.execute, 'Execute should be null');
      if (state.currentStep === HTTP_STEP_EMPTY) {
        assert(!state.ctx, 'Context should be null');
      }
      initializeRequest();
    }
  }

  state.connector = createConnector(
    {
      timeout: DEFAULT_TIMEOUT,
      onData: (chunk) => {
        if (chunk.length === 0) {
          return;
        }
        timeUpdater.updateIncoming();
        processChunk(chunk);
        if (!controller.signal.aborted) {
          state.execute(chunk)
            .catch((error) => {
              stateManager.setError(error);
              if (controller.signal.aborted) {
                shutdown(state.ctx.error);
              } else if (error instanceof DecodeHttpError) {
                shutdown(error);
              } else {
                handleResponseError();
              }
            });
        }
      },
      onDrain: () => {
        const responseBody = state.ctx?.response?.body;
        if (responseBody instanceof Readable && responseBody.isPaused()) {
          responseBody.resume();
        }
      },
      onClose: () => {
        assert(!controller.signal.aborted, 'Controller should not be aborted');
        controller.abort();

        if (state.currentStep !== HTTP_STEP_RESPONSE_END && state.currentStep !== HTTP_STEP_EMPTY) {
          assert(state.ctx, 'Context should exist');
          const error = new Error('Socket closed unexpectedly');
          stateManager.setError(error);
          handleSocketClose(error);
        } else {
          handleSocketClose();
        }
      },
      onFinish: () => {
        handleSocketClose(state.ctx?.error);
      },
      onError: (error) => {
        if (!controller.signal.aborted) {
          controller.abort();
          if (state.ctx) {
            stateManager.setError(error);
          }
        }
        handleSocketClose(error);
      },
    },
    () => socket,
  );
  return isSocketEnable(socket);
};
