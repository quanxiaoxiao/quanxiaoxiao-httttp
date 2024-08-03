import _ from 'lodash';
import generateHtmlTag from './generateHtmlTag.mjs';

const joinSpaceLine = (size, str = '') => {
  if (!size) {
    return `${str}\n`;
  }
  let result = '';
  for (let i = 0; i < size; i++) {
    result += '  ';
  }
  return `${result}${str}\n`;
};

const render = (lineLinst, depth = 0) => {
  let str = '';
  for (let i = 0; i < lineLinst.length; i++) {
    const lineStr = lineLinst[i];
    if (Array.isArray(lineStr)) {
      str += render(lineStr, depth + 1);
    } else {
      str += `${joinSpaceLine(depth, lineStr)}`;
    }
  }
  return str;
};

export default (obj, title = '') => {
  const {
    documentAttributeList = [],
    metaList = [],
    linkList = [],
    styleList = [],
    scriptList = [],
    elemList = [],
    bodyAttributeList = [],
  } = obj;
  const result = [];
  const head = [];
  const body = [];
  result.push('<!DOCTYPE html>');
  result.push(generateHtmlTag('html', { attributes: documentAttributeList}));
  head.push(generateHtmlTag('head'));
  if (title) {
    head.push([generateHtmlTag('title', { content: title })]);
  }
  if (!_.isEmpty(metaList)) {
    head.push(metaList.map((item) => generateHtmlTag('meta', { attributes: item.attributes, })));
  }
  if (!_.isEmpty(styleList)) {
    head.push(styleList.map((item) => generateHtmlTag('style', {
      content: item.content,
      attributes: item.attributes,
    })));
  }
  if (!_.isEmpty(linkList)) {
    head.push(linkList.map((item) => generateHtmlTag('link', {
      attributes: item.attributes,
    })));
  }
  head.push('</head>');
  body.push(generateHtmlTag('body', { attributes: bodyAttributeList }));
  if (!_.isEmpty(elemList)) {
    body.push(elemList.map((item) => generateHtmlTag(item.name, {
      content: item.content,
      attributes: item.attributes,
    })));
  }
  if (!_.isEmpty(scriptList)) {
    body.push(scriptList.map((item) => generateHtmlTag('script', {
      content: item.content,
      attributes: item.attributes,
    })));
  }
  body.push('</body>');
  result.push(head);
  result.push(body);
  return `${render(result)}</html>`;
};
