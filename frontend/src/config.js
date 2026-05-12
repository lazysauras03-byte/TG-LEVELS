/**
 * config.js — backend URL config.
 *
 * REST calls (axios / fetch) use BACKEND = "" (empty string) so paths like
 * `/api/chart` are relative — the CRA dev-server proxy (package.json) forwards
 * them to localhost:3299. This works from localhost AND any LAN IP (192.168.x.x)
 * because the proxy runs on the dev server, not in the browser.
 *
 * For production, set REACT_APP_BACKEND_URL=https://your-api.com in frontend/.env
 */
export const BACKEND =
  process.env.REACT_APP_BACKEND_URL || "";