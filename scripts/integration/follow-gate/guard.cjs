// This test process may connect only to its three loopback test services.
/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preloads use CommonJS. */
if (process.env.OPENREPLY_INTEGRATION !== 'local-only') throw new Error('Integration guard missing');
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof options !== 'object') options = { port: options, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  const host = options.host || 'localhost';
  if (options.path || !['localhost', '127.0.0.1', '::1'].includes(host) || ![25432, 26379, 26480].includes(Number(options.port))) {
    throw new Error(`Integration network guard blocked ${host}:${options.port || 'socket'}`);
  }
  return connect.apply(this, args);
};
