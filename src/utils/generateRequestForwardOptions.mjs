import {
  convertObjectToArray,
  filterHeaders,
  getHeaderValue,
} from '@quanxiaoxiao/http-utils';
import Ajv from 'ajv';

import httpRequestValidate from '../schemas/httpRequest.mjs';

const ajv = new Ajv();

const validate = ajv.compile({
  type: 'object',
  properties: {
    port: {
      type: 'integer',
      minimum: 1,
      maximum: 65535,
    },
    method: {
      type: 'string',
      nullable: false,
    },
    path: {
      type: 'string',
      nullable: false,
    },
    headers: {
      type: 'object',
      nullable: false,
    },
    remoteAddress: {
      type: 'string',
      nullable: true,
    },
    hostname: {
      type: 'string',
      nullable: false,
    },
  },
  required: ['port'],
});

export default (options, request) => {
  if (!validate(options)) {
    throw new Error(JSON.stringify(options.error));
  }
  if (request) {
    if (!httpRequestValidate(request)) {
      throw new Error(JSON.stringify(httpRequestValidate.error));
    }
  }
  const requestForwardOptions = {
    method: options.method,
    path: options.path,
  };
  if (requestForwardOptions.method == null) {
    if (request) {
      requestForwardOptions.method = request.method;
    } else {
      requestForwardOptions.method = 'GET';
    }
  }
  if (requestForwardOptions.path == null) {
    if (request) {
      requestForwardOptions.path = request.path;
    } else {
      requestForwardOptions.path = '/';
    }
  }
  if (options.headers) {
    requestForwardOptions.headers = convertObjectToArray(options.headers);
    if (!getHeaderValue(requestForwardOptions.headers, 'host')) {
      requestForwardOptions.headers.push('Host');
      requestForwardOptions.headers.push(`${options.hostname || '127.0.0.1'}:${options.port}`);
    }
  } else if (request) {
    requestForwardOptions.headers = [
      ...filterHeaders(request.headersRaw, ['host']),
      'Host',
      `${options.hostname || '127.0.0.1'}:${options.port}`,
    ];
  } else {
    requestForwardOptions.headers = [
      'Host',
      `${options.hostname || '127.0.0.1'}:${options.port}`,
    ];
  }
  if (options.remoteAddress) {
    requestForwardOptions.headers = filterHeaders(requestForwardOptions.headers, ['x-remote-address']);
    requestForwardOptions.headers.push('X-Remote-Address');
    requestForwardOptions.headers.push(options.remoteAddress);
  }

  return requestForwardOptions;
};
