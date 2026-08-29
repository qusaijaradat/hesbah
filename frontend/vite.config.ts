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
  },
})
