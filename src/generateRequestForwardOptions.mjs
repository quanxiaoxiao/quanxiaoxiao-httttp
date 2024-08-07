import {
  filterHeaders,
  convertObjectToArray,
  getHeaderValue,
} from '@quanxiaoxiao/http-utils';

export default (options, request) => {
  const requestForwardOptions = {
    method: options.method,
    path: options.path,
    headers: options.headers,
  };
  if (requestForwardOptions.method == null) {
    requestForwardOptions.method = request.method;
  }
  if (requestForwardOptions.path == null) {
    requestForwardOptions.path = request.path;
  }
  if (!requestForwardOptions.headers) {
    requestForwardOptions.headers = [
      ...filterHeaders(request.headersRaw, ['host']),
      'Host',
      `${options.hostname || '127.0.0.1'}:${options.port}`,
    ];
  } else {
    requestForwardOptions.headers = convertObjectToArray(requestForwardOptions.headers);
    if (!getHeaderValue(requestForwardOptions.headers, 'host')) {
      requestForwardOptions.headers.push('Host');
      requestForwardOptions.headers.push(`${options.hostname || '127.0.0.1'}:${options.port}`);
    }
  }

  if (options.remoteAddress && !getHeaderValue(requestForwardOptions.headers, 'x-remote-address')) {
    requestForwardOptions.headers = filterHeaders(requestForwardOptions.headers, ['x-remote-address']);
    requestForwardOptions.headers.push('X-Remote-Address');
    requestForwardOptions.headers.push(options.remoteAddress);
  }

  return requestForwardOptions;
};
