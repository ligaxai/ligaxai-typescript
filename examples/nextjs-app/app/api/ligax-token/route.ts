import { createTokenRoute } from '@ligaxai/sdk/next';

/**
 * Mints a client token (`lgx_ct_…`) for the signed-in user so the browser can call the API itself
 * (see `app/direct/page.tsx`). The secret key never leaves the server; it needs the
 * `client_tokens:write` scope.
 *
 * `resolveEndUser` must come from **your** session — never from the request body. This example has
 * no sign-in, so it uses one fixed demo user; returning `null` instead answers 401.
 */
const handler = createTokenRoute({
  profileId: process.env.LIGAX_PROFILE_ID ?? '',
  resolveEndUser: () => ({ id: 'demo-user', name: 'Demo user' }),
  expiresIn: 600,
});

export async function POST(request: Request): Promise<Response> {
  if (!process.env.LIGAX_PROFILE_ID) {
    return Response.json(
      { error: { message: 'Set LIGAX_PROFILE_ID to a prf_… id from Settings → Developers.' } },
      { status: 500 },
    );
  }
  return handler.POST(request);
}
