/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL do backend, usada pelo API client (frontend/src/api/http.ts).
   * Quando não definida, usa paths relativos (mesma origem), que é o caso
   * esperado em desenvolvimento: o proxy configurado em `vite.config.ts`
   * encaminha as chamadas para o backend local (porta padrão 3001 — ver
   * backend/.env.example). Defina explicitamente (ver frontend/.env.example)
   * para apontar para um backend em outro host/porta.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
