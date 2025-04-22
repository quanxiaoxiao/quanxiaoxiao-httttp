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
import generateRequestContext from './generateRequestContext.mjs';
import generateResponse from './generateResponse.mjs';
import isSocketEnable from './isSocketEnable.mjs';
import promisess from './utils/promisess.mjs';

export default ({
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
}) => {
  if (!isSocketEnable(socket)) {
    return false;
  }
  const controller = new AbortController();

  const state = {
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
  };

  function updateTimeOnLastIncoming() {
    state.timeOnLastIncoming = performance.now() - state.timeOnStart;
  }

  function updateTimeOnLastOutgoing() {
    state.timeOnLastOutgoing = performance.now() - state.timeOnStart;
  }

  function calcContextTime() {
    assert(state.ctx && state.ctx.request);
    return performance.now() - state.ctx.request.timeOnStart;
  }

  function doChunkOutgoning(chunk) {
    const size = chunk.length;
    if (!controller.signal.aborted && size > 0) {
      try {
        const ret = state.connector.write(chunk);
        updateTimeOnLastOutgoing();
        state.bytesOutgoing += size;
        return ret;
      } catch (error) {
        if (!controller.signal.aborted) {
          controller.abort();
        }
        if (state.ctx.error == null) {
          state.ctx.error = error;
        }
        return false;
      }
    }
    return false;
  }

  function doResponseEnd() {
    assert(state.ctx != null);
    assert(state.currentStep < HTTP_STEP_RESPONSE_END);
    assert(state.ctx.response);
    assert(state.ctx.request);
    assert(!state.ctx.error);
    if (!controller.signal.aborted) {
      state.currentStep = HTTP_STEP_RESPONSE_END;
      state.ctx.response.timeOnEnd = calcContextTime();
      state.execute = null;
      if (onHttpResponseEnd) {
        try {
          onHttpResponseEnd(state.ctx);
        } catch (error) {
          console.warn(error);
        }
      }
    }
  }

  function doResponseError() {
    const { ctx } = state;
    if (!socket.destroyed && !controller.signal.aborted && state.currentStep !== HTTP_STEP_RESPONSE_END) {
      if (state.currentStep >= HTTP_STEP_RESPONSE_HEADER_SPEND) {
        shutdown(ctx.error); // eslint-disable-line no-use-before-define
      } else if (state.currentStep !== HTTP_STEP_RESPONSE_ERROR) {
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
          updateTimeOnLastOutgoing();
          state.bytesOutgoing += size;
        } catch (error) {
          console.warn(error);
        } finally {
          if (!controller.signal.aborted) {
            controller.abort();
          }
        }
      }
    } else {
      shutdown(ctx.error); // eslint-disable-line no-use-before-define
    }
  }

  function handleHttpError(error) {
    assert(error instanceof Error);
    if (!controller.signal.aborted) {
      if (state.ctx.error == null) {
        state.ctx.error = error;
      }
      doResponseError();
    }
  }

  function doResponse() {
    const { ctx } = state;
    assert(state.currentStep < HTTP_STEP_RESPONSE_START);
    state.currentStep = HTTP_STEP_RESPONSE_START;
    assert(ctx.error == null);
    if (ctx.response
      && ctx.response.body instanceof Readable
      && ctx.response.body.readable
      && (!ctx.response.headers || ctx.response.headers['content-length'] !== 0)
    ) {
      assert(!Object.hasOwnProperty.call(ctx.response, 'data'));
      const encodeHttpResponse = encodeHttp({
        statusCode: ctx.response.statusCode,
        headers: ctx.response._headers || ctx.response.headersRaw || ctx.response.headers,
        body: ctx.response.body,
        onHeader: (chunk) => {
          state.currentStep = HTTP_STEP_RESPONSE_HEADER_SPEND;
          doChunkOutgoning(chunk);
        },
      });
      process.nextTick(() => {
        if (!controller.signal.aborted
          && ctx.response.body.readable
          && state.currentStep === HTTP_STEP_RESPONSE_HEADER_SPEND
        ) {
          state.currentStep = HTTP_STEP_RESPONSE_READ_CONTENT_CHUNK;
          wrapStreamRead({
            signal: controller.signal,
            stream: ctx.response.body,
            onData: (chunk) => doChunkOutgoning(encodeHttpResponse(chunk)),
            onEnd: () => {
              const chunk = encodeHttpResponse();
              state.currentStep = HTTP_STEP_RESPONSE_READ_CONTENT_END;
              doChunkOutgoning(chunk);
              if (!state.ctx.error) {
                doResponseEnd();
              }
            },
            onError: (error) => {
              if (state.ctx.error == null) {
                state.ctx.error = error;
              }
              if (!controller.signal.aborted) {
                console.warn(`response.body stream error \`${error.message}\``);
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
    } else {
      try {
        const chunk = encodeHttp(generateResponse(ctx));
        state.currentStep = HTTP_STEP_RESPONSE_HEADER_SPEND;
        doChunkOutgoning(chunk);
        doResponseEnd();
      } catch (error) {
        handleHttpError(error, ctx);
      }
    }
  }

  function shutdown(error) {
    state.connector();
    if (!controller.signal.aborted) {
      controller.abort();
    }
    doSocketClose(error); // eslint-disable-line no-use-before-define
  }

  function attachRequestBodyBackpress() {
    const { ctx } = state;
    if (ctx.request.body == null) {
      ctx.request.body = new PassThrough();
    }
    assert(ctx.request.body instanceof Writable);
    ctx.request._write = wrapStreamWrite({
      stream: ctx.request.body,
      signal: controller.signal,
      onPause: () => {
        state.connector.pause();
      },
      onDrain: () => {
        state.connector.resume();
      },
      onError: (error) => {
        if (!controller.signal.aborted) {
          if (!ctx.error) {
            ctx.error = new Error(`request body stream, \`${error.message}\``);
          }
          doResponseError();
        }
      },
    });
    ctx.request.end = (fn) => {
      if (fn == null) {
        ctx.request._write();
      } else {
        const type = typeof fn;
        if (type === 'string' || Buffer.isBuffer(fn)) {
          ctx.request._write(type === 'string' ? Buffer.from(fn, 'utf8') : fn);
          ctx.request._write();
        } else if (type === 'function') {
          ctx.request._write(fn);
        } else {
          ctx.request._write();
        }
      }
    };
  }

  function doWebSocket() {
    if (!onWebSocket) {
      throw createError(501);
    }
    const { ctx } = state;
    ctx.request.connection = true;
    state.currentStep = HTTP_STEP_REQUEST_WEBSOCKET_CONNECTION;
    state.execute = null;
    state.connector.pause();
    ctx.request.bytesBody = 0;
    ctx.response = {
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
    };
    onWebSocket({
      ctx,
      onHttpResponseStartLine: (ret) => {
        ctx.response.timeOnStartLine = calcContextTime();;
        ctx.response.statusCode = ret.statusCode;
        ctx.response.statusText = ret.statusText;
        ctx.response.httpVersion = ret.httpVersion;
      },
      onHttpResponseHeader: (ret) => {
        ctx.response.timeOnHeader = calcContextTime();;
        ctx.response.headersRaw = ret.headersRaw;
        ctx.response.headers = ret.headers;
      },
      onHttpResponseBody: (chunk) => {
        ctx.response.bytesBody += chunk.length;
        if (ctx.response.timeOnBody == null) {
          ctx.response.timeOnBody = calcContextTime();
        }
      },
      onError: (error) => {
        doSocketClose(error); // eslint-disable-line no-use-before-define
      },
      onClose: () => {
        doSocketClose(); // eslint-disable-line no-use-before-define
      },
      onConnect: () => {
        ctx.response.timeOnConnect = calcContextTime();
        process.nextTick(() => {
          if (!controller.signal.aborted) {
            state.connector.detach();
          }
        });
      },
      onChunkOutgoing: (chunk) => {
        state.bytesOutgoing += chunk.length;
        updateTimeOnLastOutgoing();
      },
      onChunkIncoming: (chunk) => {
        updateTimeOnLastIncoming();
        state.bytesIncoming += chunk.length;
        ctx.request.bytesBody += chunk.length;
        if (ctx.request.timeOnBody == null) {
          ctx.response.timeOnBody = calcContextTime();
        }
      },
    });
  }

  function doHttpRequestComplete() {
    const { ctx } = state;
    assert(!controller.signal.aborted);
    assert(ctx.error == null);
    assert(state.currentStep < HTTP_STEP_REQUEST_COMPLETE);
    state.currentStep = HTTP_STEP_REQUEST_COMPLETE;
    if (state.currentStep === HTTP_STEP_REQUEST_COMPLETE
      || state.currentStep === HTTP_STEP_REQUEST_CONTENT_WAIT_CONSUME) {
      if (onHttpResponse) {
        state.currentStep = HTTP_STEP_RESPONSE_WAIT;
        promisess(onHttpResponse, ctx)
          .then(
            () => {
              if (!controller.signal.aborted) {
                doResponse(ctx);
              }
            },
            (error) => {
              handleHttpError(error);
            },
          );
      } else {
        doResponse(ctx);
      }
    }
  }

  function doSocketClose(error) {
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
        request: null,
        response: null,
      };
      if (state.ctx) {
        if (state.ctx.request) {
          result.request = state.ctx.request;
        }
        if (state.ctx.response) {
          result.response = state.ctx.response;
        }
      }
      if (state.timeOnLastIncoming != null) {
        result.dateTimeLastIncoming = result.dateTimeCreate + (state.timeOnLastIncoming - state.timeOnStart);
      }
      if (state.timeOnLastOutgoing != null) {
        result.dateTimeLastOutgoing = result.dateTimeCreate + (state.timeOnLastOutgoing - state.timeOnStart);
      }
      onSocketClose(result, state.ctx);
    }
  }

  const bindExcute = () => {
    const { ctx } = state;
    state.execute = decodeHttpRequest({
      onStartLine: async (ret) => {
        state.currentStep = HTTP_STEP_REQUEST_START_LINE;
        ctx.request.timeOnStartLine = calcContextTime();
        ctx.request.httpVersion = ret.httpVersion;
        ctx.request.method = ret.method;
        ctx.request.url = ret.path;
        if (/^https?:\/\//.test(ret.path)) {
          const urlParseResult = parseHttpUrl(ret.path);
          const [pathname, querystring, query] = parseHttpPath(urlParseResult.path);
          ctx.request.path = urlParseResult.path;
          ctx.request.pathname = pathname;
          ctx.request.querystring = querystring;
          ctx.request.query = query;
        } else {
          const [pathname, querystring, query] = parseHttpPath(ret.path);
          ctx.request.path = ret.path;
          ctx.request.pathname = pathname;
          ctx.request.querystring = querystring;
          ctx.request.query = query;
        }
        if (onHttpRequestStartLine) {
          await onHttpRequestStartLine(ctx);
          assert(ctx.response == null);
          assert(!socket.destroyed);
          assert(!controller.signal.aborted);
        }
      },
      onHeader: async (ret) => {
        assert(state.currentStep === HTTP_STEP_REQUEST_START_LINE);
        state.currentStep = HTTP_STEP_REQUEST_HEADER;
        ctx.request.headersRaw = ret.headersRaw;
        ctx.request.headers = ret.headers;
        ctx.request.timeOnHeader = calcContextTime();
        if (onHttpRequestHeader) {
          await onHttpRequestHeader(ctx);
          assert(!socket.destroyed);
          assert(!controller.signal.aborted);
        }
        if (isHttpWebSocketUpgrade(ctx.request)) {
          doWebSocket();
        } else if (hasHttpBodyContent(ctx.request.headers)) {
          attachRequestBodyBackpress();
        } else if (ctx.request.body != null) {
          if (ctx.request.body instanceof Writable && !ctx.request.body.destroyed) {
            ctx.request.body.destroy();
          }
          ctx.request.body = null;
        }
      },
      onBody: (chunk) => {
        assert(!socket.destroyed);
        assert(!controller.signal.aborted);
        assert(!ctx.request.connection);
        if (ctx.request.timeOnBody == null) {
          ctx.request.timeOnBody = calcContextTime();
          if (state.currentStep < HTTP_STEP_REQUEST_BODY) {
            state.currentStep = HTTP_STEP_REQUEST_BODY;
          }
        }
        ctx.request._write(chunk);
      },
      onEnd: async (ret) => {
        if (!ctx.request.connection) {
          if (ctx.request._write) {
            assert(ctx.request.body instanceof Writable);
            assert(!ctx.request.body.writableEnded);
          }
          if (state.currentStep < HTTP_STEP_REQUEST_END) {
            state.currentStep = HTTP_STEP_REQUEST_END;
          }
          ctx.request.timeOnEnd = calcContextTime();
          if (ctx.request.timeOnBody == null) {
            ctx.request.timeOnBody = ctx.request.timeOnEnd;
          }
          if (onHttpRequestEnd) {
            await onHttpRequestEnd(ctx);
          }
          if (!controller.signal.aborted && ret.dataBuf.length > 0) {
            ctx.error = createError(400);
            doResponseError();
          }
          if (!controller.signal.aborted && !ctx.error) {
            if (!ctx.response
              && ctx.request.end
              && ctx.request.body instanceof Writable
              && !ctx.request.body.writableEnded
            ) {
              state.currentStep = HTTP_STEP_REQUEST_CONTENT_WAIT_CONSUME;
              ctx.request.end(() => {
                doHttpRequestComplete();
              });
            } else {
              doHttpRequestComplete();
            }
          }
        }
      },
    });
  };

  function checkRequestChunk(chunk) {
    assert(!controller.signal.aborted);
    state.bytesIncoming += chunk.length;
    if (state.currentStep >= HTTP_STEP_REQUEST_END
      && state.currentStep !== HTTP_STEP_RESPONSE_END) {
      handleHttpError(createError(400));
    } else if (state.currentStep === HTTP_STEP_EMPTY || state.currentStep === HTTP_STEP_RESPONSE_END) {
      assert(state.execute == null);
      if (state.currentStep === HTTP_STEP_EMPTY) {
        assert(state.ctx === null);
      }
      state.currentStep = HTTP_STEP_REQUEST_START;
      state.count += 1;
      state.ctx = generateRequestContext();
      state.ctx.socket = socket;
      state.ctx.signal = controller.signal;
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
          assert(state.ctx.ws instanceof Writable && state.ctx.ws.writable);
        }
      }
      bindExcute();
    }
  }

  state.connector = createConnector(
    {
      onData: (chunk) => {
        if (chunk.length > 0) {
          updateTimeOnLastIncoming();
          checkRequestChunk(chunk);
          if (!controller.signal.aborted) {
            state.execute(chunk)
              .then(
                () => {},
                (error) => {
                  if (state.ctx.error == null) {
                    state.ctx.error = error;
                  }
                  if (!controller.signal.aborted) {
                    if (error instanceof DecodeHttpError) {
                      shutdown(error);
                    } else {
                      doResponseError();
                    }
                  } else {
                    shutdown(state.ctx.error);
                  }
                },
              );
          }
        }
      },
      onDrain: () => {
        if (state.ctx
          && state.ctx.response
          && state.ctx.response.body instanceof Readable
          && state.ctx.response.body.isPaused()
        ) {
          state.ctx.response.body.resume();
        }
      },
      onClose: () => {
        assert(!controller.signal.aborted);
        controller.abort();
        if (state.currentStep !== HTTP_STEP_RESPONSE_END && state.currentStep !== HTTP_STEP_EMPTY) {
          assert(state.ctx);
          const error = new Error('Socket Close Error');
          if (!state.ctx.error) {
            state.ctx.error = error;
          }
          doSocketClose(error);
        } else {
          doSocketClose();
        }
      },
      onFinish: () => {
        doSocketClose(state.ctx?.error);
      },
      onError: (error) => {
        if (!controller.signal.aborted) {
          controller.abort();
          if (state.ctx && !state.ctx.error) {
            state.ctx.error = error;
          }
        }
        doSocketClose(error);
      },
    },
    () => socket,
  );
  return isSocketEnable(socket);
};
