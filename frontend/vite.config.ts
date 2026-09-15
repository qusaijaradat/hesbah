import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // host: true (0.0.0.0) so the dev server is reachable from other devices on the same
    // Wi-Fi/LAN — e.g. a phone testing http://<laptop-LAN-IP>:5173. Without this, Vite
    // only binds to localhost and a phone's "localhost" means the phone itself, not the
    // laptop, so it could never reach it no matter what.
    host: true,

    // The API, served from the same origin as the app — which is how it already works in
    // production (frontend/nginx.conf proxies /api to the api container) and, since sessions
    // arrived, how it has to work in development too: the refresh token is a SameSite=Strict
    // cookie, and a browser will not send one of those from :5173 to :5080. Without this proxy
    // a developer would be signed out on every reload and nothing would say why.
    //
    // A phone on the LAN still works: it talks to Vite, and Vite talks to the API.
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY || "http://localhost:5080",
        changeOrigin: true,
      },
    },
  },
})
