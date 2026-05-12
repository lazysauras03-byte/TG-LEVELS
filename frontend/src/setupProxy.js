/**
 * src/setupProxy.js
 * MUST be placed in: frontend/src/setupProxy.js
 * 
 * Proxies all backend traffic through CRA dev server (port 3000).
 * Browser never needs to reach port 3299 directly.
 * Works from localhost AND any LAN IP (192.168.x.x:3000).
 */
const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  const BACKEND = "http://localhost:3299";

  // 1. Socket.IO — WebSocket + polling both proxied
  app.use(
    "/socket.io",
    createProxyMiddleware({
      target: BACKEND,
      changeOrigin: true,
      ws: true,
    })
  );

  // 2. All REST API endpoints
  app.use(
    "/api",
    createProxyMiddleware({
      target: BACKEND,
      changeOrigin: true,
    })
  );

  // 3. Health check
  app.use(
    "/health",
    createProxyMiddleware({
      target: BACKEND,
      changeOrigin: true,
    })
  );
};