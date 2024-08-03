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
  let result = `<${name}`;
  for (let i = 0; i < attributes.length; i++) {
    const attrItem = attributes[i];
    result += ' ';
    result += attrItem.value == null ? attrItem.name : `${attrItem.name}="${attrItem.value}"`;
  }
  result += '>';
  if (Object.hasOwnProperty.call(props, 'content')) {
    if (content != null) {
      result += content;
    }
    result += `</${name}>`;
  }
  return result;
};
