/* Shared HTTP helpers for the serverless handlers. */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export function fail(status, code, message, extra = {}) {
  return json({ error: { code, message, ...extra } }, status);
}

export function methodNotAllowed(allowed) {
  return json(
    { error: { code: 'method_not_allowed', message: `Use ${allowed.join(' or ')}.` } },
    405,
    { allow: allowed.join(', ') },
  );
}

/** Parse a JSON body, returning [value, errorResponse]. */
export async function readJson(req) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return [null, fail(400, 'invalid_body', 'Request body must be a JSON object.')];
    }
    return [body, null];
  } catch {
    return [null, fail(400, 'invalid_json', 'Request body was not valid JSON.')];
  }
}

/**
 * Best-effort client IP. Recorded in the execution record as part of the
 * evidentiary trail. Behind a proxy the leftmost x-forwarded-for entry is the
 * client; it is spoofable, which is why it is evidence rather than proof.
 */
export function clientIp(req) {
  const forwarded = req.headers.get('x-nf-client-connection-ip')
    ?? req.headers.get('x-forwarded-for');
  if (!forwarded) return null;
  return forwarded.split(',')[0].trim();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 320 && EMAIL.test(value);
}

export function isNonEmptyString(value, max = 500) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
