export default (socket) => {
  if (socket
    && socket.readable
    && socket.writable
    && socket.readyState !== 'opening'
  ) {
    return true;
  }
  return false;
};
