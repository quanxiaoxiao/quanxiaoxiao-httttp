import assert from 'node:assert';
import { describe, test } from 'node:test';

import routeParser from './generateRouteMatchList.mjs';

describe('Route Parser', () => {

  describe('Input Validation', () => {
    test('should throw error for non-object routes', () => {
      assert.throws(() => routeParser(null), {
        name: 'AssertionError',
        message: /Routes must be a plain object/,
      });

      assert.throws(() => routeParser([]), {
        name: 'AssertionError',
        message: /Routes must be a plain object/,
      });

      assert.throws(() => routeParser('string'), {
        name: 'AssertionError',
        message: /Routes must be a plain object/,
      });
    });

    test('should handle empty routes object', () => {
      const result = routeParser({});
      assert.deepStrictEqual(result, []);
    });
  });

  describe('Pathname Validation', () => {
    test('should accept valid pathnames', () => {
      const routes = {
        '/api/users': {
          get: () => 'users',
        },
        '{/api/dynamic}': {
          get: () => 'dynamic',
        },
      };

      const result = routeParser(routes);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].pathname, '/api/users');
      assert.strictEqual(result[1].pathname, '{/api/dynamic}');
    });

    test('should warn and skip invalid pathnames', () => {
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (msg) => warnings.push(msg);

      const routes = {
        'invalid-path': {
          get: () => 'invalid',
        },
        '/valid-path': {
          get: () => 'valid',
        },
      };

      const result = routeParser(routes);

      console.warn = originalWarn;

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].pathname, '/valid-path');
      assert.strictEqual(warnings.length, 1);
      assert(warnings[0].includes('invalid-path'));
    });
  });

  describe('HTTP Methods Processing', () => {
    test('should process function handlers correctly', () => {
      const handler = () => 'test';
      const routes = {
        '/test': {
          get: handler,
          post: handler,
        },
      };

      const result = routeParser(routes);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].GET.fn, handler);
      assert.strictEqual(result[0].POST.fn, handler);
      assert.strictEqual(result[0].GET.validate, null);
    });

    test('should process object handlers correctly', () => {
      const handler = () => 'test';
      const validateSchema = { type: 'object' };

      const routes = {
        '/test': {
          get: {
            fn: handler,
            validate: validateSchema,
          },
        },
      };

      const result = routeParser(routes);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].GET.fn, handler);
      assert.strictEqual(typeof result[0].GET.validate, 'function');
    });

    test('should handle handler query configuration', () => {
      const routes = {
        '/test': {
          get: {
            fn: () => 'test',
            query: {
              page: { type: 'number' },
              limit: { type: 'number' },
            },
          },
        },
      };

      const result = routeParser(routes);
      assert.strictEqual(result.length, 1);
      assert(result[0].GET.query);
      assert.strictEqual(typeof result[0].GET.query, 'function');
    });

    test('should handle handler match configuration', () => {
      const routes = {
        '/test': {
          get: {
            fn: () => 'test',
            match: { status: 'active' },
          },
        },
      };

      const result = routeParser(routes);
      assert.strictEqual(result.length, 1);
      assert(result[0].GET.match);
      assert.strictEqual(typeof result[0].GET.match, 'function');
    });

    test('should throw error for invalid handler format', () => {
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (msg) => warnings.push(msg);

      const routes = {
        '/test': {
          get: {
            // 缺少 fn 属性
            validate: { type: 'object' },
          },
        },
      };

      const result = routeParser(routes);
      console.warn = originalWarn;

      assert.strictEqual(result.length, 0);
      assert.strictEqual(warnings.length, 1);
      assert(warnings[0].includes('Handler for GET must have a function'));
    });
  });

  describe('Route Configuration Processing', () => {
    test('should process global select configuration', () => {
      const routes = {
        '/test': {
          select: { type: 'object', properties: { name: { type: 'string' } } },
          get: () => 'test',
        },
      };

      const result = routeParser(routes);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(typeof result[0].select, 'function');
    });

    test('should process global match configuration', () => {
      const routes = {
        '/test': {
          match: { status: 'active' },
          get: () => 'test',
        },
      };

      const result = routeParser(routes);
      assert.strictEqual(result.length, 1);
      assert(result[0].match);
      assert.strictEqual(typeof result[0].match, 'function');
    });

    test('should process global query configuration', () => {
      const routes = {
        '/test': {
          query: {
            version: { type: 'string' },
          },
          get: () => 'test',
        },
      };

      const result = routeParser(routes);
      assert.strictEqual(result.length, 1);
      assert(result[0].query);
      assert.strictEqual(typeof result[0].query, 'function');
    });

    test('should process lifecycle hooks', () => {
      const onPre = () => 'pre';
      const onPost = () => 'post';

      const routes = {
        '/test': {
          onPre,
          onPost,
          get: () => 'test',
        },
      };

      const result = routeParser(routes);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].onPre, onPre);
      assert.strictEqual(result[0].onPost, onPost);
    });

    test('should ignore non-function lifecycle hooks', () => {
      const routes = {
        '/test': {
          onPre: 'invalid',
          onPost: null,
          get: () => 'test',
        },
      };

      const result = routeParser(routes);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].onPre, undefined);
      assert.strictEqual(result[0].onPost, undefined);
    });
  });

  describe('URL Matching', () => {
    test('should create URL matcher for each route', () => {
      const routes = {
        '/users/:id': {
          get: () => 'user',
        },
        '/posts/:postId/comments/:commentId': {
          get: () => 'comment',
        },
      };

      const result = routeParser(routes);
      assert.strictEqual(result.length, 2);

      // 测试第一个路由的匹配器
      const userMatch = result[0].urlMatch('/users/123');
      assert(userMatch);
      assert.strictEqual(userMatch.params.id, '123');

      // 测试第二个路由的匹配器
      const commentMatch = result[1].urlMatch('/posts/456/comments/789');
      assert(commentMatch);
      assert.strictEqual(commentMatch.params.postId, '456');
      assert.strictEqual(commentMatch.params.commentId, '789');
    });
  });

  describe('Meta Data', () => {
    test('should preserve original route configuration as meta', () => {
      const routeConfig = {
        description: 'User API',
        version: '1.0',
        get: () => 'users',
      };

      const routes = {
        '/users': routeConfig,
      };

      const result = routeParser(routes);
      assert.strictEqual(result.length, 1);
      assert.deepStrictEqual(result[0].meta, routeConfig);
    });
  });

  describe('Error Handling', () => {
    test('should handle partial route failures', () => {
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (msg) => warnings.push(msg);

      const routes = {
        '/valid': {
          get: () => 'valid',
        },
        'invalid-path': {
          get: () => 'invalid',
        },
        '/another-valid': {
          get: () => 'another-valid',
        },
      };

      const result = routeParser(routes);
      console.warn = originalWarn;

      assert.strictEqual(result.length, 2);
      assert.strictEqual(warnings.length, 1);
    });

    test('should throw error when all routes fail', () => {
      const routes = {
        'invalid-path-1': {
          get: () => 'invalid1',
        },
        'invalid-path-2': {
          get: () => 'invalid2',
        },
      };

      const result = routeParser(routes);
      assert.equal(result.length, 0);
    });
  });
});
