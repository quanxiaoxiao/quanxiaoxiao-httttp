const now = Date.now();
const start = performance.now();

export const getCurrentDateTime = () => now + (performance.now() - start);

export const getDateNow = () => Math.floor(getCurrentDateTime());

export const getCurrentDateName = () => new Date(getCurrentDateTime() + 1000 * 60 * 60 * 8).toUTCString();
