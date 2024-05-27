import assert from 'node:assert';
import test from 'node:test';
import generateHtmlTag from './generateHtmlTag.mjs';

test('generateHtmlTag', () => {
  assert.equal(generateHtmlTag(''), '');
  assert.equal(generateHtmlTag('a'), '<a>');
  assert.equal(
    generateHtmlTag('a', {
      content: '',
    }),
    '<a></a>'
  );
  assert.equal(
    generateHtmlTag('a', {
      content: null,
    }),
    '<a></a>'
  );
  assert.equal(
    generateHtmlTag('head'),
    '<head>'
  );
  assert.equal(
    generateHtmlTag('a', {
      content: 'quan',
    }),
    '<a>quan</a>'
  );
  assert.equal(
    generateHtmlTag('a', {
      content: 'quan',
      attributes: [
        {
          name: 'data-foo',
          value: 'bar',
        },
      ],
    }),
    `<a data-foo="bar">quan</a>`,
  );
  assert.equal(
    generateHtmlTag('a', {
      attributes: [
        {
          name: 'data-foo',
          value: 'bar',
        },
      ],
    }),
    `<a data-foo="bar">`,
  );
  assert.equal(
    generateHtmlTag('html', {}),
    `<html>`,
  );
  assert.equal(
    generateHtmlTag('html', {
      attributes: [
        {
          name: 'lang',
          value: 'zh',
        },
      ],
    }),
    `<html lang="zh">`,
  );
  assert.equal(
    generateHtmlTag('meta', {
      attributes: [
        {
          name: 'charset',
          value: 'utf-8',
        },
      ],
    }),
    `<meta charset="utf-8">`,
  );
  assert.equal(
    generateHtmlTag('link', {
      attributes: [
        {
          name: 'rel',
          value: 'shortcut icon',
        },
        {
          name: 'type',
          value: 'image/x-icon',
        },
        {
          name: 'href',
          value: '/favicon.ico',
        },
      ],
    }),
    `<link rel="shortcut icon" type="image/x-icon" href="/favicon.ico">`,
  );

  assert.equal(
    generateHtmlTag('script', {
      content: '',
      attributes: [
        {
          name: 'defer',
          value: 'defer',
        },
        {
          name: 'src',
          value: '/static/taxi/main.js',
        },
      ],
    }),
    `<script defer="defer" src="/static/taxi/main.js"></script>`,
  );

  assert.equal(
    generateHtmlTag('style', {
      content: '',
      attributes: [
        {
          name: 'data-emotion',
          value: 'css-global',
        },
        {
          name: 'data-s',
          value: null,
        },
      ],
    }),
    `<style data-emotion="css-global" data-s></style>`,
  );

  assert.equal(
    generateHtmlTag('style', {
      content: '',
      attributes: [
        {
          name: 'data-emotion',
          value: 'css-global',
        },
        {
          name: 'data-s',
          value: '',
        },
      ],
    }),
    `<style data-emotion="css-global" data-s=""></style>`,
  );
});
