import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Backend local (backend/.env.example > PORT=3001, backend/src/index.ts).
const BACKEND_DEV_URL = 'http://localhost:3001';

// Prefixos de rota expostos pelo backend (backend/src/index.ts), usados
// abaixo para configurar o proxy de desenvolvimento do Vite.
const BACKEND_ROUTE_PREFIXES = [
  '/tasks',
  '/tipos-de-acordo',
  '/motivos-de-nao-cumprimento',
  '/usuarios',
  '/health',
];

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy de dev (task 28.2): faz o servidor de dev do Vite encaminhar as
    // chamadas da API para o backend local, para que o frontend possa usar
    // paths relativos (mesma origem) em vez de uma URL absoluta — evitando
    // CORS sem precisar de configuração adicional no backend. Em produção
    // (ou quando o backend estiver em outro host), defina
    // `VITE_API_BASE_URL` (ver frontend/.env.example) para apontar
    // diretamente para o backend.
    proxy: Object.fromEntries(
      BACKEND_ROUTE_PREFIXES.map((prefix) => [prefix, { target: BACKEND_DEV_URL }]),
    ),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
