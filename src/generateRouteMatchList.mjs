import assert from 'node:assert';
import Ajv from 'ajv';
import _ from 'lodash';
import { select } from '@quanxiaoxiao/datav';
import generateRouteList from './generateRouteList.mjs';

export default (routes) => {
  assert(_.isPlainObject(routes));
  const routeList = generateRouteList(routes);
  const result = [];
  for (let i = 0; i < routeList.length; i++) {
    const d = routeList[i];
    const routeItem = {
      match: d.match,
      pathname: d.pathname,
      urlMatch: d.urlMatch,
    };
    if (d.select) {
      routeItem.select = select(d.select);
      routeItem.select.toJSON = () => d.select;
    }
    if (!_.isEmpty(d.query)) {
      routeItem.query = select({
        type: 'object',
        properties: d.query,
      });
      routeItem.query.toJSON = () => d.query;
    }
    if (d.onPre) {
      routeItem.onPre = d.onPre;
    }
    if (d.onPost) {
      routeItem.onPost = d.onPost;
    }
    const httpMethodList = ['get', 'post', 'put', 'delete'];
    for (let j = 0; j < httpMethodList.length; j++) {
      const handler = d[httpMethodList[j]];
      const httpMethod = httpMethodList[j].toUpperCase();
      if (handler) {
        if (typeof handler === 'function') {
          routeItem[httpMethod] = {
            fn: handler,
          };
        } else {
          assert(_.isPlainObject(handler));
          assert(typeof handler.fn === 'function');
          routeItem[httpMethod] = {
            fn: handler.fn,
          };
          if (handler.validate) {
            const ajv = new Ajv();
            routeItem[httpMethod].validate = ajv.compile(handler.validate);
            routeItem[httpMethod].validate.toJSON = () => handler.validate;
          }
          if (handler.onRequestEnd) {
            routeItem[httpMethod].onRequestEnd = handler.onRequestEnd;
          }
        }
      }
    }
    result.push(routeItem);
  }
  return result;
};
