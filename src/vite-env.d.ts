/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Token de Cesium ion. Vacío = el relieve muestra "dato no disponible". */
  readonly VITE_CESIUM_ION_TOKEN?: string;
}
