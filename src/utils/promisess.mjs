export default async (fn, ...args) => {
  const ret = await fn(...args);
  return ret;
};
