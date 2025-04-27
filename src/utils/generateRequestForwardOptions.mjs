import {
  convertObjectToArray,
  filterHeaders,
  getHeaderValue,
} from '@quanxiaoxiao/http-utils';
import Ajv from 'ajv';

import httpRequestValidate from '../schemas/httpRequest.mjs';

const ajv = new Ajv();

const optionsSchema = {
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
};

const optionsValidate = ajv.compile(optionsSchema);

const getDefaultHostHeader = (options) => `${options.hostname || '127.0.0.1'}:${options.port}`;

const validateRequest = (request) => {
  if (request && !httpRequestValidate(request)) {
    throw new Error(JSON.stringify(httpRequestValidate.errors));
  }
};

const getMethod = (options, request) => options.method ?? request?.method ?? 'GET';

const getPath = (options, request) => options.path ?? request?.path ?? '/';

const processHeaders = (options, request) => {
  const headers = options.headers
    ? convertObjectToArray(options.headers)
    : request
      ? filterHeaders(request.headersRaw, ['host'])
      : [];

  if (!getHeaderValue(headers, 'host')) {
    headers.push('Host', getDefaultHostHeader(options));
  }

  return headers;
};

const addRemoteAddressHeader = (headers, remoteAddress) => {
  if (remoteAddress) {
    headers = filterHeaders(headers, ['x-remote-address']);
    headers.push('X-Remote-Address', remoteAddress);
  }
  return headers;
};

export default (options, request) => {
  if (!optionsValidate(options)) {
    throw new Error(JSON.stringify(options.error));
  }
  validateRequest(request);

  const requestForwardOptions = {
    method: getMethod(options, request),
    path: getPath(options, request),
    headers: processHeaders(options, request),
  };
  requestForwardOptions.headers = addRemoteAddressHeader(
    requestForwardOptions.headers,
    options.remoteAddress,
  );
  return requestForwardOptions;
};
