import getSocketConnection from './getSocketConnection.mjs';

export default ({
    request,
    signal,
    options,
}) => {
  const state = {
    timeOnConnect: null,
    timeOnRequestSend: null,
    timeOnRequestEnd: null,
    timeOnResponse: null,
    timeOnResponseStartLine: null,
    timeOnResponseHeader: null,
    timeOnResponseBody: null,
    timeOnResponseEnd: null,
  };

  const requestForwardOptions = {
    method: options.method,
    path: options.path,
    headers: options.headers,
    signal,
  };

  request(
    requestForwardOptions,
    () => getSocketConnection({
      hostname: options.hostname,
      servername: options.servername,
      port: options.port,
      protocol: options.protocol || 'http:',
    }),
  );
};
