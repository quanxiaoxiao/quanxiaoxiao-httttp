import assert from 'node:assert';

import compare from '@quanxiaoxiao/compare';
import { select } from '@quanxiaoxiao/datav';
import Ajv from 'ajv';
import _ from 'lodash';
import { match } from 'path-to-regexp';

const httpMethodList = ['get', 'post', 'put', 'delete'];

export default (routes) => {
  assert(_.isPlainObject(routes));
  const pathnameList = Object.keys(routes);
  const result = [];
  for (let i = 0; i < pathnameList.length; i++) {
    const pathname = pathnameList[i];
    if (pathname[0] !== '/' && !/^{\/[^}]+}/.test(pathname)) {
      console.warn(`\`${pathname}\` pathname invalid`);
      continue;
    }
    const d = routes[pathname];
    try {
      const routeItem = {
        pathname,
        urlMatch: match(pathname, { encode: false, decode: false }),
        meta: d,
      };
      if (d.select) {
        routeItem.select = select(d.select);
      }
      if (d.match) {
        routeItem.match = compare(d.match);
      }
      if (!_.isEmpty(d.query)) {
        routeItem.query = select({
          type: 'object',
          properties: d.query,
        });
      }
      if (d.onPre) {
        routeItem.onPre = d.onPre;
      }
      if (d.onPost) {
        routeItem.onPost = d.onPost;
      }
      for (let j = 0; j < httpMethodList.length; j++) {
        const handler = d[httpMethodList[j]];
        if (handler) {
          const httpMethod = httpMethodList[j].toUpperCase();
          routeItem[httpMethod] = {
            fn: handler,
            validate: null,
          };
          if (typeof handler !== 'function') {
            assert(_.isPlainObject(handler));
            assert(typeof handler.fn === 'function');
            routeItem[httpMethod].fn = handler.fn;
            if (handler.validate) {
              const ajv = new Ajv();
              routeItem[httpMethod].validate = ajv.compile(handler.validate);
            }
          }
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
      }
      result.push(routeItem);
    } catch (error) {
      console.warn(`\`${pathname}\` parse route fail, ${error.message}`);
      continue;
    }
  }
  return result;
};
