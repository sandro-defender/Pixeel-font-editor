/// <reference types="vite/client" />

/** App version injected from package.json at build time. */
declare const __APP_VERSION__: string;

declare module '*?worker' {
  const workerConstructor: {
    new (options?: { name?: string }): Worker;
  };
  export default workerConstructor;
}
