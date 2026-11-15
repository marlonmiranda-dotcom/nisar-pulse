/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Token de Cesium ion. Si está vacío, el globo intenta el relieve abierto
   * de Esri. Si ese también falla, el relieve dice "dato no disponible".
   */
  readonly VITE_CESIUM_ION_TOKEN?: string;
}

declare module "*.geojson?raw" {
  const contenido: string;
  export default contenido;
}
