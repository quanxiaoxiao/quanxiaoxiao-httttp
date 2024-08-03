import test from 'node:test';
import assert from 'node:assert';
import renderToHtml from './renderToHtml.mjs';

test('renderToHtml', () => {
  let content  = `<!DOCTYPE html>
<html>
  <head>
  </head>
  <body>
  </body>
</html>`;
  assert.equal(renderToHtml({}), content);
  content  = `<!DOCTYPE html>
<html>
  <head>
    <title>aaa</title>
  </head>
  <body>
  </body>
</html>`;
  assert.equal(renderToHtml({}, 'aaa'), content);
  content  = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
  </head>
  <body>
  </body>
</html>`;
  assert.equal(renderToHtml({
    metaList: [
      {
        attributes: [
          {
            name: 'charset',
            value: 'utf-8',
          },
        ],
      },
    ],
  }, ''), content);
  content  = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  </head>
  <body>
  </body>
</html>`;
  assert.equal(renderToHtml({
    metaList: [
      {
        attributes: [
          {
            name: 'charset',
            value: 'utf-8',
          },
        ],
      },
      {
        attributes: [
          {
            name: 'name',
            value: 'viewport',
          },
          {
            name: 'content',
            value: 'width=device-width,initial-scale=1,maximum-scale=1',
          },
        ],
      },
    ],
  }, ''), content);
  content  = `<!DOCTYPE html>
<html>
  <head>
    <title>bbb</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
    <link rel="dns-prefetch" href="//test.aaa.com">
  </head>
  <body>
  </body>
</html>`;
  assert.equal(renderToHtml({
    metaList: [
      {
        attributes: [
          {
            name: 'charset',
            value: 'utf-8',
          },
        ],
      },
      {
        attributes: [
          {
            name: 'name',
            value: 'viewport',
          },
          {
            name: 'content',
            value: 'width=device-width,initial-scale=1,maximum-scale=1',
          },
        ],
      },
    ],
    linkList: [
      {
        attributes: [
          {
            name: 'rel',
            value: 'dns-prefetch',
          },
          {
            name: 'href',
            value: '//test.aaa.com',
          },
        ],
      },
    ],
  }, 'bbb'), content);
  content  = `<!DOCTYPE html>
<html lang="zh">
  <head>
    <meta charset="utf-8">
  </head>
  <body id="root">
  </body>
</html>`;
  assert.equal(renderToHtml({
    documentAttributeList: [
      {
        name: 'lang',
        value: 'zh',
      },
    ],
    metaList: [
      {
        attributes: [
          {
            name: 'charset',
            value: 'utf-8',
          },
        ],
      },
    ],
    bodyAttributeList: [
      {
        name: 'id',
        value: 'root',
      },
    ],
  }), content);
  content  = `<!DOCTYPE html>
<html lang="zh">
  <head>
    <meta charset="utf-8">
  </head>
  <body>
    <div id="root"></div>
    <div>xxx</div>
  </body>
</html>`;
  assert.equal(renderToHtml({
    documentAttributeList: [
      {
        name: 'lang',
        value: 'zh',
      },
    ],
    metaList: [
      {
        attributes: [
          {
            name: 'charset',
            value: 'utf-8',
          },
        ],
      },
    ],
    elemList: [
      {
        name: 'div',
        content: '',
        attributes: [
          {
            name: 'id',
            value: 'root',
          },
        ],
      },
      {
        name: 'div',
        content: 'xxx',
      },
    ],
  }), content);

  content  = `<!DOCTYPE html>
<html>
  <head>
  </head>
  <body>
    <div id="root"></div>
    <script src="//aaa.bb.cc" async></script>
    <script>const aa = "ccc";</script>
  </body>
</html>`;
  assert.equal(renderToHtml({
    elemList: [
      {
        name: 'div', content: '',
        attributes: [
          {
            name: 'id',
            value: 'root',
          },
        ],
      },
    ],
    scriptList: [
      {
        attributes: [
          {
            name: 'src',
            value: '//aaa.bb.cc',
          },
          {
            name: 'async',
            value: null,
          },
        ],
      },
      {
        content: 'const aa = "ccc";',
      },
    ],
  }), content);
});
