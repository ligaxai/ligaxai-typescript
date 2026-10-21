import { createRouteHandler } from '@base-project-scope/sdk/next';

/**
 * Reads `BASE_PROJECT_API_KEY` (and optionally `BASE_PROJECT_BASE_URL`) from the server
 * environment. `resolve` maps the browser's JSON to the upstream call; extend it per action, or
 * return `{ path: '/runs', body, stream: true }` to stream a chat turn straight back to the client.
 */
export const { GET, POST } = createRouteHandler({
  resolve: ({ body }) => {
    const action = (body as { action?: string } | null)?.action;
    if (action === 'health') return { path: '/health', method: 'GET' };
    return null;
  },
});
