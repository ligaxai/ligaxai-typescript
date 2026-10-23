import { createTokenRoute } from '@ligaxai/sdk/next';

import { currentUser } from '../../../lib/session';

/**
 * Mints a client token (`lgx_ct_…`) for the signed-in user so the browser can call the API itself
 * (see `app/direct/page.tsx`). The secret key never leaves the server; it needs the
 * `client_tokens:write` scope. The user comes from `currentUser` — your session, never the request
 * body — and a visitor who is not signed in gets 401.
 */
let handler: ReturnType<typeof createTokenRoute> | undefined;

export async function POST(request: Request): Promise<Response> {
  if (!process.env.LIGAX_PROFILE_ID) {
    return Response.json(
      { error: { message: 'Set LIGAX_PROFILE_ID to a prf_… id from Settings → Developers.' } },
      { status: 500 },
    );
  }
  handler ??= createTokenRoute({
    profileId: process.env.LIGAX_PROFILE_ID,
    resolveEndUser: currentUser,
    expiresIn: 600,
  });
  return handler.POST(request);
}
