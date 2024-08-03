export default (
  name,
  props = {},
) => {
  const {
    attributes,
    content,
  } = props;
  if (!name) {
    return '';
  }
  if (!attributes || attributes.length === 0) {
    if (!Object.hasOwnProperty.call(props, 'content')) {
      return `<${name}>`;
    }
    return `<${name}>${content ?? ''}</${name}>`;
  }
  const result = [
    `<${name}`,
    ...attributes.map((attrItem) => {
      const s = attrItem.value == null ? attrItem.name : `${attrItem.name}="${attrItem.value}"`;
      return ` ${s}`;
    }),
    '>',
  ];
  if (Object.hasOwnProperty.call(props, 'content')) {
    if (content != null) {
      result.push(content);
    }
    result.push(`</${name}>`);
  }
  return result.join('');
};
