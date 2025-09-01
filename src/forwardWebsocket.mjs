import { getSocketConnect } from '@quanxiaoxiao/http-request';
import { decodeHttpResponse,encodeHttp } from '@quanxiaoxiao/http-utils';
import {
  pipeForward,
  waitConnect,
} from '@quanxiaoxiao/socket';
import createError from 'http-errors';

import generateRequestForwardOptions from './utils/generateRequestForwardOptions.mjs';

const CONNECT_TIMEOUT = 10_1000;
const PIPE_TIMEOUT = 50_1000;
const DEFAULT_PROTOCOL = 'http:';

const establishConnection = async (remoteSocket, signal, onConnect) => {
  await waitConnect(
    remoteSocket,
    CONNECT_TIMEOUT,
    signal,
  );

  if (onConnect) {
    onConnect();
  }
};

export default async ({
  options,
  signal,
  socket: clientSocket,
  request,
  onHttpResponseStartLine,
  onHttpResponseHeader,
  onHttpResponseBody,
  onConnect,
  onClose,
  onError,
  onChunkIncoming,
  onChunkOutgoing,
}) => {
  const remoteSocket = getSocketConnect({
    hostname: options.hostname,
    port: options.port,
    protocol: options.protocol || DEFAULT_PROTOCOL,
  });
  try {
    await establishConnection(remoteSocket, signal, onConnect);
  } catch (error) {
    console.warn('Failed to establish remote connection:', error.message);
    throw createError(502);
  }

  const decode = decodeHttpResponse({
    onStartLine: onHttpResponseStartLine,
    onHeader: onHttpResponseHeader,
    onBody: onHttpResponseBody,
  });

  pipeForward(
    () => remoteSocket,
    () => clientSocket,
    {
      timeout: PIPE_TIMEOUT,
      onError,
      onClose,
      onIncoming: (chunk) => {
        onChunkIncoming(chunk);
        if (options.onChunkIncoming) {
          options.onChunkIncoming(chunk);
        }
      },
      onOutgoing: (chunk) => {
        decode(chunk)
          .then(
            () => {},
            () => {},
          );
        onChunkOutgoing(chunk);
        if (options.onChunkOutgoing) {
          options.onChunkOutgoing(chunk);
        }
      },
      onConnect: () => {
        const chunkRequest = encodeHttp(
          {
            ...generateRequestForwardOptions(
              options,
              request,
            ),
            body: null,
          },
        );
        remoteSocket.write(chunkRequest);
        if (options.onChunkIncoming) {
          options.onChunkIncoming(chunkRequest);
        }
        process.nextTick(() => {
          if (!signal.aborted) {
            onConnect();
          }
        });
      },
    },
  );
};
