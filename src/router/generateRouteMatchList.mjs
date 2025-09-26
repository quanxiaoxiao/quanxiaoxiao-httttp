import assert from 'node:assert';

import compare from '@quanxiaoxiao/compare';
import { select } from '@quanxiaoxiao/datav';
import Ajv from 'ajv';
import _ from 'lodash';
import { match } from 'path-to-regexp';

const HTTP_METHODS = ['get', 'post', 'put', 'delete'];
const PATHNAME_REGEX = /^{\/[^}]+}/;

const isValidPathname = (pathname) => {
  return pathname[0] === '/' || PATHNAME_REGEX.test(pathname);
};

const createQuerySelector = (queryConfig) => {
  if (_.isEmpty(queryConfig)) {
    return null;
  }

  return select({
    type: 'object',
    properties: queryConfig,
  });
};

const processHttpHandler = (method, handlerConfig, routeItem) => {
  if (!handlerConfig) {
    return;
  }

  const httpMethod = method.toUpperCase();

  const handler = typeof handlerConfig === 'function'
    ? { fn: handlerConfig }
    : handlerConfig;

  assert(_.isPlainObject(handler), `Handler for ${httpMethod} must be an object`);
  assert(typeof handler.fn === 'function', `Handler for ${httpMethod} must have a function`);

  const methodHandler = {
    fn: handler.fn,
    validate: handler.validate ? (new Ajv()).compile(handler.validate) : null,
  };

  const querySelector = createQuerySelector(handler.query);
  if (querySelector) {
    methodHandler.query = querySelector;
  }

  if (handler.match) {
    methodHandler.match = compare(handler.match);
  }

  routeItem[httpMethod] = methodHandler;
};

const processRouteConfig = (pathname, routeConfig) => {
  if (!isValidPathname(pathname)) {
    throw new Error(`Invalid pathname format: ${pathname}`);
  }

  const routeItem = {
    pathname,
    urlMatch: match(pathname, { encode: false, decode: false }),
    meta: routeConfig,
  };

  if (routeConfig.select) {
    routeItem.select = select(routeConfig.select);
  }

  if (routeConfig.match) {
    routeItem.match = compare(routeConfig.match);
  }

  const globalQuerySelector = createQuerySelector(routeConfig.query);

  if (globalQuerySelector) {
    routeItem.query = globalQuerySelector;
  }

  if (routeConfig.onPre && typeof routeConfig.onPre === 'function') {
    routeItem.onPre = routeConfig.onPre;
  }

  if (routeConfig.onPost && typeof routeConfig.onPost === 'function') {
    routeItem.onPost = routeConfig.onPost;
  }

  for (const method of HTTP_METHODS) {
    processHttpHandler(method, routeConfig[method], routeItem);
  }

  return routeItem;
};

export default (routes) => {
  assert(_.isPlainObject(routes), 'Routes must be a plain object');

  const result = [];

  for (const [pathname, routeConfig] of Object.entries(routes)) {
    try {
      const routeItem = processRouteConfig(pathname, routeConfig);
      result.push(routeItem);
    } catch (error) {
      console.warn(`Route parsing failed for '${pathname}': ${error.message}`);
    }
  }

  return result;
};
