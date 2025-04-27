import assert from 'node:assert';

import compare from '@quanxiaoxiao/compare';
import { select } from '@quanxiaoxiao/datav';
import Ajv from 'ajv';
import _ from 'lodash';
import { match } from 'path-to-regexp';

const HTTP_METHODS = ['get', 'post', 'put', 'delete'];
const PATHNAME_REGEX = /^{\/[^}]+}/;

export default (routes) => {
  assert(_.isPlainObject(routes));
  return Object.entries(routes).reduce((result, [pathname, routeConfig]) => {
    if (pathname[0] !== '/' && !PATHNAME_REGEX.test(pathname)) {
      console.warn(`\`${pathname}\` pathname invalid`);
      return result;
    }
    try {
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
      if (!_.isEmpty(routeConfig.query)) {
        routeItem.query = select({
          type: 'object',
          properties: routeConfig.query,
        });
      }
      if (routeConfig.onPre) {
        routeItem.onPre = routeConfig.onPre;
      }

      if (routeConfig.onPost) {
        routeItem.onPost = routeConfig.onPost;
      }

      for (const method of HTTP_METHODS) {
        const handlerConfig = routeConfig[method];
        if (!handlerConfig) {
          continue;
        }
        const httpMethod = method.toUpperCase();
        const handler = typeof handlerConfig === 'function'
          ? { fn: handlerConfig }
          : handlerConfig;
        assert(_.isPlainObject(handler), 'Handler must be an object');
        assert(typeof handler.fn === 'function', 'Handler must have a function');

        routeItem[httpMethod] = {
          fn: handler.fn,
          validate: handler.validate ? (new Ajv()).compile(handler.validate) : null,
        };

        if (!_.isEmpty(handler.query)) {
          routeItem[httpMethod].query = select({
            type: 'object',
            properties: handler.query,
          });
        }
        if (handler.match) {
          routeItem[httpMethod].match = compare(handler.match);
        }
      }
      return [
        ...result,
        routeItem,
      ];
    } catch (error) {
      console.warn(`\`${pathname}\` parse route fail, ${error.message}`);
      return result;
    }
  }, []);
};
