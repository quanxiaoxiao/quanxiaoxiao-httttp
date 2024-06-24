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
  isHttpStream,
  hasHttpBodyContent,
  DecodeHttpError,
} from '@quanxiaoxiao/http-utils';
import {
  wrapStreamWrite,
  wrapStreamRead,
} from '@quanxiaoxiao/node-utils';
import attachResponseError from './attachResponseError.mjs';
import generateResponse from './generateResponse.mjs';

export default ({
  socket,
  onClose,
  onHttpRequest,
  onHttpRequestStartLine,
  onHttpRequestHeader,
  onHttpRequestEnd,
  onHttpResponse,
  onHttpResponseEnd,
  onHttpError,
}) => {
  const controller = new AbortController();

  const state = {
    dateTimeCreate: Date.now(),
    timeOnStart: performance.now(),
    timeOnActive: null,
    timeOnLastActive: null,
    bytesIncoming: 0,
    bytesOutgoing: 0,
    ctx: null,
    count: 0,
    step: -1,
    execute: null,
    connector: null,
  };

  const sendBuffer = (buf) => {
    const size = buf.length;
    if (!controller.signal.aborted && size > 0) {
      try {
        const ret = state.connector.write(buf);
        state.bytesOutgoing += size;
        return ret;
      } catch (error) { // eslint-disable-line
        if (!controller.signal.aborted) {
          controller.abort();
        }
        return false;
      }
    }
    return false;
  };

  const doResponseEnd = () => {
    const { ctx } = state;
    state.step = -1;
    state.ctx = null;
    if (onHttpResponseEnd) {
      try {
        onHttpResponseEnd(ctx);
      } catch (error) {
        console.warn(error);
      }
    }
  };

  const calcTimeByRequest = () => performance.now() - state.ctx.request.timeOnStart;

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

  const handleError = (error, ctx) => {
    if (!controller.signal.aborted) {
      ctx.error = error;
      doResponseError(ctx);
    } else {
      console.warn(error);
    }
  };

  const doResponse = async (ctx) => {
    assert(!ctx.error);
    if (!controller.signal.aborted && onHttpResponse) {
      try {
        await onHttpResponse(ctx);
      } catch (error) {
        handleError(error, ctx);
      }
    }
    if (!ctx.error
      && !controller.signal.aborted
      && ctx.socket.writable) {
      if (ctx.response && ctx.response.body instanceof Readable) {
        assert(!Object.hasOwnProperty.call(ctx.response, 'data'));
        const encodeHttpResponse = encodeHttp({
          statusCode: ctx.response.statusCode,
          headers: ctx.response._headers || ctx.response.headersRaw || ctx.response.headers,
          body: new PassThrough(),
          onHeader: sendBuffer,
        });
        process.nextTick(() => {
          try {
            wrapStreamRead({
              signal: controller.signal,
              stream: ctx.response.body,
              onData: (chunk) => sendBuffer(encodeHttpResponse(chunk)),
              onEnd: () => {
                sendBuffer(encodeHttpResponse());
                if (!controller.signal.aborted) {
                  doResponseEnd();
                }
              },
              onError: (error) => {
                console.log(error);
                console.warn(`response.body stream error \`${error.message}\``);
                if (!controller.signal.aborted) {
                  state.connector();
                  controller.abort();
                }
              },
            });
          } catch (error) {
            console.warn(error);
            if (!controller.signal.aborted) {
              state.connector();
              controller.abort();
            }
          }
        });
      } else {
        try {
          sendBuffer(encodeHttp(generateResponse(ctx)));
          doResponseEnd();
        } catch (error) {
          handleError(error, ctx);
        }
      }
    }
  };

  const bindExcute = (ctx) => {
    state.execute = decodeHttpRequest({
      onStartLine: async (ret) => {
        state.step = 1;
        ctx.request.timeOnStartLine = calcTimeByRequest();
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
        assert(state.step === 1);
        state.step = 2;
        ctx.request.headersRaw = ret.headersRaw;
        ctx.request.headers = ret.headers;
        ctx.request.timeOnHeader = calcTimeByRequest();
        if (onHttpRequestHeader) {
          await onHttpRequestHeader(ctx);
          assert(!controller.signal.aborted);
        }
        if (isHttpStream(ctx.request.headers)) {
          throw createError(400);
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
              doResponse(ctx);
            },
          });
        } else if (ctx.request.body != null) {
          ctx.request.body = null;
        }
      },
      onBody: (chunk) => {
        assert(!controller.signal.aborted);
        if (ctx.request.timeOnBody == null) {
          ctx.request.timeOnBody = calcTimeByRequest();
          assert(state.step === 2);
          state.step = 3;
        }
        assert(ctx.request._write);
        ctx.request._write(chunk);
      },
      onEnd: async () => {
        assert(state.step < 4);
        state.step = 4;
        ctx.request.timeOnEnd = calcTimeByRequest();
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
          doResponse(ctx);
        }
      },
    });
  };

  const attachContext = () => {
    state.step = 0;
    state.count += 1;
    state.ctx = {
      socket,
      signal: controller.signal,
      request: {
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
      },
      response: null,
      error: null,
    };
    if (onHttpRequest) {
      try {
        onHttpRequest(state.ctx);
        assert(state.ctx.response == null);
      } catch (error) {
        state.ctx.error = error;
      }
    }
    if (state.ctx.error) {
      doResponseError(state.ctx);
    } else if (!controller.signal.aborted) {
      bindExcute(state.ctx);
    }
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
              state.ctx.error = error;
              if (error instanceof DecodeHttpError) {
                error.statusCode = 400;
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

  state.connector = createConnector(
    {
      onData: (chunk) => {
        assert(!controller.signal.aborted);
        const size = chunk.length;
        state.bytesIncoming += size;
        const now = performance.now();
        if (state.timeOnActive == null) {
          state.timeOnLastActive = now;
        } else {
          state.timeOnLastActive = state.timeOnActive;
        }
        state.timeOnActive = now;
        if (!state.ctx) {
          attachContext();
        }
        if (!controller.signal.aborted && size > 0) {
          execute(chunk);
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
        if (state.ctx) {
          state.ctx.error = new Error('Socket Close Error');
          if (onClose) {
            onClose(state.ctx);
          }
        }
      },
      onError: (error) => {
        if (!controller.signal.aborted) {
          controller.abort();
          if (state.ctx) {
            state.ctx.error = error;
            if (onClose) {
              onClose(state.ctx);
            }
          }
        }
      },
    },
    () => socket,
  );
};
