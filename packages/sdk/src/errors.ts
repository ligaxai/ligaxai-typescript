// `@ligaxai/sdk/errors` — the error classes alone, so an `instanceof` check in a
// server-side error boundary does not pull the whole client into the bundle.
export * from './core/errors.js';
