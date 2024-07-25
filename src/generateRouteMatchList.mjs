import assert from 'node:assert';
import Ajv from 'ajv';
import _ from 'lodash';
import { select } from '@quanxiaoxiao/datav';
import generateRouteList from './generateRouteList.mjs';

export default (routes) => {
  assert(_.isPlainObject(routes));
  const routeList = generateRouteList(routes);
  const result = [];
  const httpMethodList = ['get', 'post', 'put', 'delete'];
  for (let i = 0; i < routeList.length; i++) {
    const item = routeList[i];
    const routeItem = {
      match: item.match,
      pathname: item.pathname,
      urlMatch: item.urlMatch,
      meta: item,
    };
    if (item.select) {
      routeItem.select = select(item.select);
      routeItem.select.toJSON = () => item.select;
    }
    if (!_.isEmpty(item.query)) {
      routeItem.query = select({
        type: 'object',
        properties: item.query,
      });
      routeItem.query.toJSON = () => item.query;
    }
    if (item.onPre) {
      routeItem.onPre = item.onPre;
    }
    if (item.onPost) {
      routeItem.onPost = item.onPost;
    }
    for (let j = 0; j < httpMethodList.length; j++) {
      const handler = item[httpMethodList[j]];
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
            routeItem[httpMethod].validate.toJSON = () => handler.validate;
          }
        }
      }
    }
    result.push(routeItem);
  }
  return result;
};
