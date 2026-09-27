/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAX_FILE_SIZE_MB?: string;
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
