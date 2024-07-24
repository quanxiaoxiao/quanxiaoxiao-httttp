import assert from 'node:assert';
import {
  PassThrough,
  Readable,
  Writable,
} from 'node:stream';
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
    bytesIncoming: 0,
    bytesOutgoing: 0,
    count: 0,
    currentStep: -1,
    execute: null,
    connector: null,
  };

  const doOutgoning = (chunk, ctx) => {
    const size = chunk.length;
    if (!controller.signal.aborted && size > 0) {
      if (onChunkOutgoing) {
        onChunkOutgoing(ctx, chunk);
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
    if (!controller.signal.aborted) {
      const { ctx } = state;
      state.currentStep = -1;
      state.ctx = null;
      if (onHttpResponseEnd) {
        try {
          onHttpResponseEnd(ctx);
        } catch (error) {
          console.warn(error);
        }
      }
    }
  };

  const doResponseError = (ctx) => {
    if (!controller.signal.aborted) {
      attachResponseError(ctx);
      if (onHttpError) {
        onHttpError(ctx);
      } else {
        console.warn(ctx.error);
      }
      try {
        state.connector.end(encodeHttp(ctx.response));
      } catch (error) {
        console.warn(error);
      } finally {
        if (!controller.signal.aborted) {
          controller.abort();
        }
      }
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
    assert(ctx.error == null);
    if (ctx.response && ctx.response.body instanceof Readable) {
      assert(!Object.hasOwnProperty.call(ctx.response, 'data'));
      const encodeHttpResponse = encodeHttp({
        statusCode: ctx.response.statusCode,
        headers: ctx.response._headers || ctx.response.headersRaw || ctx.response.headers,
        body: ctx.response.body,
        onHeader: (chunk) => doOutgoning(chunk, ctx),
      });
      process.nextTick(() => {
        if (!controller.signal.aborted && ctx.response.body.readable) {
          wrapStreamRead({
            signal: controller.signal,
            stream: ctx.response.body,
            onData: (chunk) => doOutgoning(encodeHttpResponse(chunk), ctx),
            onEnd: () => {
              doOutgoning(encodeHttpResponse(), ctx);
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
        } else if (!ctx.response.body.destroyed) {
          ctx.response.body.destroy();
        }
      });
    } else {
      try {
        doOutgoning(encodeHttp(generateResponse(ctx)), ctx);
        doResponseEnd();
      } catch (error) {
        handleHttpError(error, ctx);
      }
    }
  };

  const doHttpRequestComplete = (ctx) => {
    assert(!controller.signal.aborted);
    assert(ctx.error == null);
    if (!ctx.response || ctx.response.statusCode == null) {
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
  };

  const doSocketClose = (error) => {
    if (onSocketClose && state.isSocketCloseEmit) {
      state.isSocketCloseEmit = true;
      onSocketClose({
        dateTimeCreate: state.dateTimeCreate,
        bytesIncoming: state.bytesIncoming,
        bytesOutgoing: state.bytesOutgoing,
        count: state.count,
        step: state.currentStep,
        error,
      });
    }
  };

  const bindExcute = (ctx) => {
    state.execute = decodeHttpRequest({
      onStartLine: async (ret) => {
        state.currentStep = 1;
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
          assert(!controller.signal.aborted);
        }
      },
      onHeader: async (ret) => {
        assert(state.currentStep === 1);
        state.currentStep = 2;
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
          assert(ctx.request.body instanceof Readable);
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
                ctx.error = new Error(`request body stream, \`${error.message}\``);
                doResponseError(ctx);
              }
            },
            onEnd: () => {
              doHttpRequestComplete(ctx);
            },
          });
        } else if (ctx.request.body != null) {
          ctx.request.body = null;
        }
      },
      onBody: (chunk) => {
        assert(!controller.signal.aborted);
        if (ctx.request.timeOnBody == null) {
          ctx.request.timeOnBody = calcTimeByRequest(ctx);
          assert(state.currentStep === 2);
          state.currentStep = 3;
        }
        assert(ctx.request._write);
        ctx.request._write(chunk);
      },
      onEnd: async () => {
        assert(state.currentStep < 4);
        state.currentStep = 4;
        ctx.request.timeOnEnd = calcTimeByRequest(ctx);
        if (ctx.request.timeOnBody == null) {
          ctx.request.timeOnBody = ctx.request.timeOnEnd;
        }
        if (onHttpRequestEnd) {
          await onHttpRequestEnd(ctx);
          assert(!controller.signal.aborted);
        }
        if (ctx.request._write) {
          ctx.request._write();
        } else {
          doHttpRequestComplete(ctx);
        }
      },
    });
  };

  const execute = (chunk) => {
    state.execute(chunk)
      .then(
        (ret) => {
          if (!controller.signal.aborted
            && ret.complete
            && ret.dataBuf.length > 0) {
            if (state.ctx) {
              state.ctx.error = createError(400);
              doResponseError(state.ctx);
            } else {
              state.connector();
              controller.abort();
            }
          }
        },
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
  };

  const handleDataOnSocket = (chunk) => {
    assert(!controller.signal.aborted);
    const size = chunk.length;
    state.bytesIncoming += size;
    if (!state.ctx) {
      state.currentStep = 0;
      state.count += 1;
      state.ctx = generateRequestContext();
      state.ctx.socket = socket;
      state.ctx.signal = controller.signal;
      if (onHttpRequest) {
        onHttpRequest(state.ctx);
      }
      bindExcute(state.ctx);
    }
    if (size > 0) {
      if (onChunkIncoming) {
        onChunkIncoming(state.ctx, chunk);
      }
      execute(chunk);
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
        if (state.currentStep !== -1 && state.ctx && !state.ctx.error) {
          const error = new Error('Socket Close Error');
          state.ctx.error = error;
          doSocketClose(error);
        } else {
          doSocketClose(null);
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
