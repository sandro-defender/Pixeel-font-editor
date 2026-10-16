/// <reference types="vite/client" />

/** App version injected from package.json at build time. */
declare const __APP_VERSION__: string;
/** Short git commit of the build ("unknown" outside a git checkout). */
declare const __APP_COMMIT__: string;

declare module '*?worker' {
  const workerConstructor: {
    new (options?: { name?: string }): Worker;
  };
  export default workerConstructor;
}
