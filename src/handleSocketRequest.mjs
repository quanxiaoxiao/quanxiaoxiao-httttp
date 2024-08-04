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
  hasHttpBodyContent,
  DecodeHttpError,
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
        controller.abort();
        state.connector();
        doSocketClose(ctx.error);
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
      controller.abort();
      state.connector();
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
        const [pathname, querystring, query] = parseHttpPath(ret.path);
        ctx.request.path = ret.path;
        ctx.request.pathname = pathname;
        ctx.request.querystring = querystring;
        ctx.request.query = query;
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
      },
      onBody: (chunk) => {
        assert(!controller.signal.aborted);
        if (ctx.request.timeOnBody == null) {
          ctx.request.timeOnBody = calcTimeByRequest(ctx);
          if (state.currentStep < HTTP_STEP_REQUEST_BODY) {
            state.currentStep = HTTP_STEP_REQUEST_BODY;
          }
        }
        ctx.request._write(chunk);
        if (state.currentStep >= HTTP_STEP_REQUEST_END) {
          state.connector.pause();
        }
      },
      onEnd: async (ret) => {
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
      },
    });
  };

  const handleDataOnSocket = (chunk) => {
    assert(!controller.signal.aborted);
    if (state.currentStep >= HTTP_STEP_REQUEST_END
      && state.currentStep !== HTTP_STEP_RESPONSE_END
      && state.currentStep !== HTTP_STEP_RESPONSE_WAIT) {
      handleHttpError(createError(400), state.ctx);
    }
    if (!controller.signal.aborted) {
      state.timeOnLastIncoming = performance.now();
      const size = chunk.length;
      state.bytesIncoming += size;
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
          const { remoteAddress } = socket;
          onHttpRequest({
            dateTimeCreate: state.dateTimeCreate,
            bytesIncoming: state.bytesIncoming,
            bytesOutgoing: state.bytesOutgoing,
            count: state.count,
            remoteAddress,
          });
        }
        bindExcute();
      }
      if (size > 0) {
        if (onChunkIncoming) {
          promisess(onChunkIncoming, state.ctx, chunk)
            .then(
              () => {},
              (error) => {
                console.error(error);
              },
            );
        }
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
                  console.warn(error);
                  state.connector();
                  controller.abort();
                }
              }
            },
          );
      }
    }
  };

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
