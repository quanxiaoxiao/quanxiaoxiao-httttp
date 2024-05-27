import _ from 'lodash';
import cheerio from 'cheerio';

export default (buf) => {
  const $ = cheerio.load(buf);
  const scriptList = [];
  const styleList = [];
  const linkList = [];
  const metaList = [];
  const elemList = [];
  $('script').each((index, elem) => {
    scriptList.push({
      content: $(elem).html(),
      attributes: elem.attributes,
    });
  });
  $('style').each((index, elem) => {
    styleList.push({
      content: $(elem).html(),
      attributes: elem.attributes,
    });
  });
  $('link').each((index, elem) => {
    if (!_.isEmpty(elem.attributes)) {
      linkList.push({
        attributes: elem.attributes,
      });
    }
  });
  $('meta').each((index, elem) => {
    if (!_.isEmpty(elem.attributes)) {
      metaList.push({
        attributes: elem.attributes,
      });
    }
  });
  $('html > body')
    .children()
    .each((index, elem) => {
      if (!['script', 'style', 'link', 'meta'].includes(elem.name)) {
        elemList.push({
          name: elem.name,
          content: $(elem).html(),
          attributes: elem.attributes,
        });
      }
    });

  return {
    documentAttributeList: $('html').prop('attributes'),
    bodyAttributeList: $('html > body').prop('attributes'),
    scriptList,
    styleList,
    linkList,
    metaList,
    elemList,
  };
};
