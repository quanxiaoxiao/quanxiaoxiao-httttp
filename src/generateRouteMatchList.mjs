import assert from 'node:assert';
import _ from 'lodash';
import Ajv from 'ajv';
import { match } from 'path-to-regexp';
import compare from '@quanxiaoxiao/compare';
import { select } from '@quanxiaoxiao/datav';

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
        urlMatch: match(pathname),
        match: d.match ? compare(d.match) : null,
        meta: d,
      };
      if (d.select) {
        routeItem.select = select(d.select);
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
