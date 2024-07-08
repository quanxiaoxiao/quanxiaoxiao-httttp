import assert from 'node:assert';
import _ from 'lodash';
import { match, pathToRegexp } from 'path-to-regexp';
import compare from '@quanxiaoxiao/compare';

export default (data) => {
  assert(_.isPlainObject(data));
  const pathnameList = Object.keys(data);
  const result = [];
  for (let i = 0; i < pathnameList.length; i++) {
    const pathname = pathnameList[i];
    if (pathname[0] !== '/') {
      console.warn(`\`${pathname}\` pathname invalid`);
      continue;
    }
    const d = data[pathname];
    try {
      const urlMatch = match(pathname);
      urlMatch.toJSON = () => pathToRegexp(pathname).toString();
      const matchCompare = d.match ? compare(d.match) : null;
      if (matchCompare) {
        matchCompare.toJSON = () => d.match;
      }
      const routeItem = {
        ...d,
        pathname,
        urlMatch,
        match: matchCompare,
      };
      result.push(routeItem);
    } catch (error) {
      console.warn(`\`${pathname}\` parse route fail, ${error.message}`);
      continue;
    }
  }
  return result;
};
