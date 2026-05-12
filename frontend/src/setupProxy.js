/**
 * src/setupProxy.js
 *
 * CRA dev-server proxy — REST only.
 * Socket.IO connects directly to port 3299 (see useSocket.js).
 * We deliberately do NOT proxy /socket.io — CRA's WS proxy is
 * broken for Socket.IO on LAN IPs and on reconnects.
 */
const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  const BACKEND = "http://localhost:3299";

  app.use("/api", createProxyMiddleware({ target: BACKEND, changeOrigin: true }));
  app.use("/health", createProxyMiddleware({ target: BACKEND, changeOrigin: true }));
};