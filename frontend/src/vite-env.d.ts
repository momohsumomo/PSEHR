/// <reference types="vite/client" />

declare module "*.ps1?raw" {
  const src: string;
  export default src;
}
