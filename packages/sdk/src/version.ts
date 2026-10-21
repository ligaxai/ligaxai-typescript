// `__PKG_VERSION__` is injected by tsdown from package.json at build time, so the User-Agent
// can never drift from the published version. Running from source (tests) sees the dev marker.
declare const __PKG_VERSION__: string | undefined;

export const VERSION: string = typeof __PKG_VERSION__ === 'string' ? __PKG_VERSION__ : '0.0.0-dev';
