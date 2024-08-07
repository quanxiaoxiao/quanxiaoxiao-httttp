import assert from 'node:assert';
import {
  PassThrough,
  Readable,
  Writable,
} from 'node:stream';
import _ from 'lodash';
import createError from 'http-errors';
import { createConnector } from '@quanxiaoxiao/socket';
import {
  decodeHttpRequest,
  encodeHttp,
  parseHttpPath,
  parseHttpUrl,
  hasHttpBodyContent,
  DecodeHttpError,
  isWebSocketRequest,
} from '@quanxiaoxiao/http-utils';
import {
  wrapStreamWrite,
  wrapStreamRead,
} from '@quanxiaoxiao/node-utils';
import {
  HTTP_STEP_EMPTY,
  HTTP_STEP_REQUEST_START,
  HTTP_STEP_REQUEST_START_LINE,
  HTTP_STEP_REQUEST_HEADER,
  HTTP_STEP_REQUEST_BODY,
  HTTP_STEP_REQUEST_END,
  HTTP_STEP_RESPONSE_WAIT,
  HTTP_STEP_RESPONSE_START,
  HTTP_STEP_RESPONSE_HEADER_SPEND,
  HTTP_STEP_RESPONSE_READ_CONTENT_CHUNK,
  HTTP_STEP_RESPONSE_READ_CONTENT_END,
  HTTP_STEP_RESPONSE_END,
  HTTP_STEP_RESPONSE_ERROR,
  HTTP_STEP_REQUEST_WEBSOCKET_CONNECTION,
} from './constants.mjs';
import attachResponseError from './attachResponseError.mjs';
import generateResponse from './generateResponse.mjs';
import generateRequestContext from './generateRequestContext.mjs';

const calcTimeByRequest = (ctx) => performance.now() - ctx.request.timeOnStart;

const promisess = async (fn, ...args) => {
  const ret = await fn(...args);
  return ret;
};

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
  onChunkIncoming,
  onChunkOutgoing,
  onSocketClose,
}) => {
  const controller = new AbortController();

  const state = {
    ctx: null,
    isSocketCloseEmit: false,
    dateTimeCreate: Date.now(),
    timeOnStart: performance.now(),
    timeOnLastIncoming: null,
    bytesIncoming: 0,
    bytesOutgoing: 0,
    count: 0,
    currentStep: HTTP_STEP_EMPTY,
    execute: null,
    connector: null,
  };

  const doOutgoning = (chunk, ctx) => {
    const size = chunk.length;
    if (!controller.signal.aborted && size > 0) {
      if (onChunkOutgoing) {
        promisess(onChunkOutgoing, ctx, chunk)
          .then(
            () => {},
            (error) => {
              console.error(error);
            },
          );
      }
      try {
        const ret = state.connector.write(chunk);
        state.bytesOutgoing += size;
        return ret;
      } catch (error) {
        if (!controller.signal.aborted) {
          ctx.error = error;
          controller.abort();
        }
        return false;
      }
    }
    return false;
  };

  const doResponseEnd = () => {
    assert(state.ctx != null);
    assert(state.currentStep < HTTP_STEP_RESPONSE_END);
    if (!controller.signal.aborted) {
      state.currentStep = HTTP_STEP_RESPONSE_END;
      state.execute = null;
      if (onHttpResponseEnd) {
        try {
          onHttpResponseEnd(state.ctx);
        } catch (error) {
          console.warn(error);
        }
      }
    }
  };

  const doResponseError = (ctx) => {
    if (!controller.signal.aborted && state.currentStep !== HTTP_STEP_RESPONSE_END) {
      if (state.currentStep >= HTTP_STEP_RESPONSE_HEADER_SPEND) {
        shutdown(ctx.error);
      } else if (state.currentStep !== HTTP_STEP_RESPONSE_ERROR) {
        state.currentStep = HTTP_STEP_RESPONSE_ERROR;
        attachResponseError(ctx);
        if (onHttpError) {
          onHttpError(ctx);
        } else {
          console.warn(ctx.error);
        }
        try {
          const chunk = encodeHttp(ctx.error.response);
          const size = chunk.length;
          state.connector.end(chunk);
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
      shutdown(ctx.error);
    }
  };

  const handleHttpError = (error, ctx) => {
    assert(error instanceof Error);
    if (!controller.signal.aborted) {
      if (ctx.error == null) {
        ctx.error = error;
      }
      doResponseError(ctx);
    }
  };

  const doResponse = (ctx) => {
    assert(state.currentStep < HTTP_STEP_RESPONSE_START);
    state.currentStep = HTTP_STEP_RESPONSE_START;
    assert(ctx.error == null);
    if (ctx.response
      && ctx.response.body instanceof Readable
      && ctx.response.body.readable
    ) {
      assert(!Object.hasOwnProperty.call(ctx.response, 'data'));
      const encodeHttpResponse = encodeHttp({
        statusCode: ctx.response.statusCode,
        headers: ctx.response._headers || ctx.response.headersRaw || ctx.response.headers,
        body: ctx.response.body,
        onHeader: (chunk) => {
          state.currentStep = HTTP_STEP_RESPONSE_HEADER_SPEND;
          doOutgoning(chunk, ctx);
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
            onData: (chunk) => doOutgoning(encodeHttpResponse(chunk), ctx),
            onEnd: () => {
              const chunk = encodeHttpResponse();
              state.currentStep = HTTP_STEP_RESPONSE_READ_CONTENT_END;
              doOutgoning(chunk, ctx);
              doResponseEnd();
            },
            onError: (error) => {
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
        doOutgoning(chunk, ctx);
        doResponseEnd();
      } catch (error) {
        handleHttpError(error, ctx);
      }
    }
  };

  function shutdown(error) {
    state.connector();
    if (!controller.signal.aborted) {
      controller.abort();
    }
    doSocketClose(error);
  }

  const doHttpRequestComplete = (ctx) => {
    assert(!controller.signal.aborted);
    assert(ctx.error == null);
    if (state.currentStep === HTTP_STEP_REQUEST_END) {
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
              handleHttpError(error, ctx);
            },
          );
      } else {
        doResponse(ctx);
      }
    }
  };

  const doSocketClose = (error) => {
    if (onSocketClose && !state.isSocketCloseEmit) {
      state.isSocketCloseEmit = true;
      onSocketClose({
        dateTimeCreate: state.dateTimeCreate,
        dateTimeLastIncoming: state.timeOnLastIncoming == null ? null : state.dateTimeCreate + (state.timeOnLastIncoming - state.timeOnStart),
        bytesIncoming: state.bytesIncoming,
        bytesOutgoing: state.bytesOutgoing,
        count: state.count,
        step: state.currentStep,
        error,
        request: state.ctx ? state.ctx.request : null,
        response: state.ctx ? state.ctx.response : null,
      });
    }
  };

  const bindExcute = () => {
    const { ctx } = state;
    state.execute = decodeHttpRequest({
      onStartLine: async (ret) => {
        state.currentStep = HTTP_STEP_REQUEST_START_LINE;
        ctx.request.timeOnStartLine = calcTimeByRequest(ctx);
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
          assert(!controller.signal.aborted);
        }
      },
      onHeader: async (ret) => {
        assert(state.currentStep === HTTP_STEP_REQUEST_START_LINE);
        state.currentStep = HTTP_STEP_REQUEST_HEADER;
        ctx.request.headersRaw = ret.headersRaw;
        ctx.request.headers = ret.headers;
        ctx.request.timeOnHeader = calcTimeByRequest(ctx);
        if (onHttpRequestHeader) {
          await onHttpRequestHeader(ctx);
          assert(!controller.signal.aborted);
        }
        if (isWebSocketRequest(ctx.request)) {
          if (!onWebSocket) {
            throw createError(501);
          }
          ctx.request.connection = true;
          state.currentStep = HTTP_STEP_REQUEST_WEBSOCKET_CONNECTION;
          state.execute = null;
          if (!ctx.socket.isPaused()) {
            ctx.socket.pause();
          }
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
          await onWebSocket({
            ctx,
            onHttpResponseStartLine: (ret) => {
              ctx.response.timeOnStartLine = performance.now();
              ctx.response.statusCode = ret.statusCode;
              ctx.response.statusText = ret.statusText;
              ctx.response.httpVersion = ret.httpVersion;
            },
            onHttpResponseHeader: (ret) => {
              ctx.response.timeOnHeader = performance.now();
              ctx.response.headersRaw = ret.headersRaw;
              ctx.response.headers = ret.headers;
            },
            onHttpResponseBody: (chunk) => {
              ctx.response.bytesBody += chunk.length;
              if (ctx.response.timeOnBody == null) {
                ctx.response.timeOnBody = performance.now();
              }
            },
            onError: (error) => {
              doSocketClose(error);
            },
            onClose: () => {
              doSocketClose();
            },
            onConnect: () => {
              ctx.response.timeOnConnect = performance.now();
              process.nextTick(() => {
                if (!controller.signal.aborted) {
                  state.connector.detach();
                }
              });
            },
            onChunkIncoming: (chunk) => {
              state.timeOnLastIncoming = performance.now();
              state.bytesIncoming += chunk.length;
              ctx.request.bytesBody += chunk.length;
              if (ctx.request.timeOnBody == null) {
                ctx.response.timeOnBody = state.timeOnLastIncoming;
              }
              if (onChunkIncoming) {
                promisess(onChunkIncoming, state.ctx, chunk)
                  .then(
                    () => {},
                    (error) => {
                      console.error(error);
                    },
                  );
              }
            },
            onChunkOutgoing: (chunk) => {
              state.bytesOutgoing += chunk.length;
              if (onChunkOutgoing) {
                promisess(onChunkOutgoing, state.ctx, chunk)
                  .then(
                    () => {},
                    (error) => {
                      console.error(error);
                    },
                  );
              }
            },
          });
        } else {
          if (hasHttpBodyContent(ctx.request.headers)) {
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
                  doResponseError(ctx);
                }
              },
              onEnd: () => {
                doHttpRequestComplete(ctx);
              },
            });
          } else if (ctx.request.body != null) {
            if (ctx.request.body instanceof Readable && !ctx.request.body.destroyed) {
              ctx.request.body.destroy();
            }
            ctx.request.body = null;
          }
          if (ctx.response) {
            assert(_.isPlainObject(ctx.response));
            state.currentStep = HTTP_STEP_RESPONSE_WAIT;
            if (onHttpResponse) {
              promisess(onHttpResponse, ctx)
                .then(
                  () => {
                    if (!controller.signal.aborted) {
                      doResponse(ctx);
                    }
                  },
                  (error) => {
                    handleHttpError(error, ctx);
                  },
                );
            } else {
              doResponse(ctx);
            }
          }
        }
      },
      onBody: (chunk) => {
        assert(!controller.signal.aborted);
        assert(!ctx.request.connection);
        if (ctx.request.timeOnBody == null) {
          ctx.request.timeOnBody = calcTimeByRequest(ctx);
          if (state.currentStep < HTTP_STEP_REQUEST_BODY) {
            state.currentStep = HTTP_STEP_REQUEST_BODY;
          }
        }
        ctx.request._write(chunk);
      },
      onEnd: async (ret) => {
        if (!ctx.request.connection) {
          if (state.currentStep < HTTP_STEP_REQUEST_END) {
            state.currentStep = HTTP_STEP_REQUEST_END;
          }
          ctx.request.timeOnEnd = calcTimeByRequest(ctx);
          if (ctx.request.timeOnBody == null) {
            ctx.request.timeOnBody = ctx.request.timeOnEnd;
          }
          if (onHttpRequestEnd) {
            await onHttpRequestEnd(ctx);
            assert(!controller.signal.aborted);
          }
          if (ret.dataBuf.length > 0) {
            state.ctx.error = createError(400);
            doResponseError(state.ctx);
          }
          if (!controller.signal.aborted) {
            if (ctx.request._write) {
              ctx.request._write();
            } else {
              doHttpRequestComplete(ctx);
            }
          }
        }
      },
    });
  };

  function checkRequestChunkValid (chunk) {
    assert(!controller.signal.aborted);
    state.timeOnLastIncoming = performance.now();
    state.bytesIncoming += chunk.length;
    if (state.currentStep >= HTTP_STEP_REQUEST_END
      && state.currentStep !== HTTP_STEP_RESPONSE_END
      && state.currentStep !== HTTP_STEP_RESPONSE_WAIT) {
      handleHttpError(createError(400), state.ctx);
    } else {
      if (state.currentStep === HTTP_STEP_EMPTY || state.currentStep === HTTP_STEP_RESPONSE_END) {
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
          });
        }
        bindExcute();
      }
      if (onChunkIncoming) {
        promisess(onChunkIncoming, state.ctx, chunk)
          .then(
            () => {},
            (error) => {
              console.error(error);
            },
          );
      }
    }
  }

  function handleDataOnSocket (chunk) {
    if (chunk.length > 0) {
      checkRequestChunkValid(chunk);
      if (!controller.signal.aborted) {
        state.execute(chunk)
          .then(
            () => {},
            (error) => {
              if (!controller.signal.aborted) {
                if (state.ctx) {
                  if (state.ctx.error == null) {
                    state.ctx.error = error;
                    if (error instanceof DecodeHttpError) {
                      state.ctx.error.statusCode = 400;
                    }
                  }
                  doResponseError(state.ctx);
                } else {
                  shutdown(error);
                }
              } else {
                shutdown(state.ctx?.error);
              }
            },
          );
      }
    }
  }

  state.connector = createConnector(
    {
      onData: handleDataOnSocket,
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
        if (state.ctx && state.ctx.error) {
          doSocketClose(state.ctx.error);
        } else {
          doSocketClose();
        }
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
};
