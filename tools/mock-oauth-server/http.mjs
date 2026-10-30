/**
 * HTTP adapter of the local OAuth test provider: routing, CORS, the sign-in
 * page shown on `/oauth/authorize`, the demo control endpoints and logging.
 *
 * Log lines only ever contain the method, the path without its query string
 * and the status: authorization codes and tokens are never written out.
 */

import { TOKEN_ERROR_SCENARIOS, isTokenErrorScenario, tenantIdOf } from './provider.mjs';

const MAX_BODY_BYTES = 64 * 1024;

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Parses a form-urlencoded or JSON body into a plain object of strings/values. */
async function parseBody(req) {
  const raw = await readBody(req);
  const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (raw.length === 0) {
    return { fields: {}, contentType };
  }
  if (contentType === 'application/json') {
    try {
      const parsed = JSON.parse(raw);
      return { fields: typeof parsed === 'object' && parsed !== null ? parsed : {}, contentType };
    } catch {
      return { fields: {}, contentType, malformed: true };
    }
  }
  return { fields: Object.fromEntries(new URLSearchParams(raw)), contentType };
}

function queryOf(url) {
  return Object.fromEntries(url.searchParams);
}

const PAGE_STYLE = `
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 46rem; padding: 0 1rem; color: #222; }
  h1 { color: #d3045d; font-size: 1.5rem; }
  fieldset { border: 1px solid #ddd; border-radius: 6px; margin: 1rem 0; }
  label { display: block; margin: .5rem 0; }
  code { background: #f4f4f4; padding: 0 .25rem; }
  .actions { display: flex; gap: 1rem; margin-top: 1rem; }
  button { font: inherit; padding: .5rem 1rem; border-radius: 4px; border: 1px solid #999; background: #fff; cursor: pointer; }
  button.primary { background: #d3045d; border-color: #d3045d; color: #fff; }
  .note { color: #555; font-size: .9rem; }
  table { border-collapse: collapse; } td, th { border: 1px solid #ddd; padding: .3rem .6rem; text-align: left; }
  .error { color: #a00; }
`;

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Local OAuth test provider</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function hiddenFields(params, keys) {
  return keys
    .filter((key) => typeof params[key] === 'string')
    .map(
      (key) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(params[key])}">`,
    )
    .join('\n');
}

const AUTHORIZE_KEYS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
];

function authorizePage(provider, params, client, request) {
  const users = provider.users
    .map(
      (user, index) => `
      <label>
        <input type="radio" name="username" value="${escapeHtml(user.username)}" ${index === 0 ? 'checked' : ''}>
        ${escapeHtml(user.label ?? user.username)}
        <span class="note">(<code>${escapeHtml(user.username)}</code>)</span>
      </label>`,
    )
    .join('\n');
  const scenarios = TOKEN_ERROR_SCENARIOS.map(
    (scenario) => `<option value="${escapeHtml(scenario)}">${escapeHtml(scenario)}</option>`,
  ).join('\n');

  return page(
    'Sign in',
    `
<h1>Sign in to ${escapeHtml(client.name)}</h1>
<p class="note">Local test provider — fictional accounts, no password. Nothing here is real.</p>
<p>The application <code>${escapeHtml(client.id)}</code> asks for an authorization code
  to be sent to <code>${escapeHtml(request.redirectUri)}</code>${
    request.scope ? ` with scope <code>${escapeHtml(request.scope)}</code>` : ' (default scope)'
  }.</p>
<form method="post" action="/oauth/authorize">
  ${hiddenFields(params, AUTHORIZE_KEYS)}
  <fieldset>
    <legend>Account</legend>
    ${users}
  </fieldset>
  <fieldset>
    <legend>Token exchange scenario</legend>
    <label>When the application exchanges the code, the token endpoint should
      <select name="token_error">
        <option value="" selected>succeed</option>
        ${scenarios}
      </select>
    </label>
    <p class="note">Use this to watch the application's "sign-in could not be completed" screens.</p>
  </fieldset>
  <div class="actions">
    <button class="primary" type="submit" name="decision" value="approve">Sign in and authorize</button>
    <button type="submit" name="decision" value="deny">Deny</button>
  </div>
</form>
`,
  );
}

function invalidRequestPage(error, description) {
  return page(
    'Invalid authorization request',
    `
<h1>Invalid authorization request</h1>
<p class="error"><strong>${escapeHtml(error)}</strong>: ${escapeHtml(description)}</p>
<p class="note">By design the provider does not redirect in this case (RFC 6749, section 4.1.2.1).
  Check <code>clientId</code> and <code>redirectUri</code> in <code>src/app/auth.config.ts</code>
  against the client registered in <code>tools/mock-oauth-server/fixtures.mjs</code>.</p>
`,
  );
}

function indexPage(provider) {
  const state = provider.snapshot();
  const users = provider.users
    .map(
      (user) =>
        `<tr><td><code>${escapeHtml(user.username)}</code></td><td>${escapeHtml(user.name ?? '—')}</td><td>${escapeHtml(tenantIdOf(user.username) ?? '—')}</td></tr>`,
    )
    .join('\n');
  const tenants = provider.tenants
    .map((tenant) => `<tr><td><code>${escapeHtml(tenant.id)}</code></td><td>${escapeHtml(tenant.name)}</td></tr>`)
    .join('\n');
  const scenarios = TOKEN_ERROR_SCENARIOS.map(
    (scenario) => `<option value="${escapeHtml(scenario)}">${escapeHtml(scenario)}</option>`,
  ).join('\n');
  const tokenError = state.scenario.tokenError;

  return page(
    'Local OAuth test provider',
    `
<h1>Local OAuth test provider</h1>
<p class="note">Development stand-in for the private server. Fictional data only; in-memory state.</p>
<h2>Endpoints</h2>
<ul>
  <li><code>GET /oauth/authorize</code> — sign-in page (authorization code + PKCE S256)</li>
  <li><code>POST /oauth/token</code> — <code>authorization_code</code> and <code>refresh_token</code> grants</li>
  <li><code>GET /api/user</code>, <code>POST /api/logout/{username}</code>, <code>GET /api/tenants/{tenant_id}</code> — bearer token required</li>
</ul>
<h2>Client</h2>
<ul>${provider.clients
      .map(
        (client) =>
          `<li><code>${escapeHtml(client.id)}</code> — ${escapeHtml(client.name)}; redirect URIs: ${client.redirectUris
            .map((uri) => `<code>${escapeHtml(uri)}</code>`)
            .join(', ')}</li>`,
      )
      .join('')}</ul>
<h2>Accounts</h2>
<table><tr><th>Identifier</th><th>Name</th><th>Tenant</th></tr>${users}</table>
<h2>Tenants</h2>
<table><tr><th>Id</th><th>Name</th></tr>${tenants}</table>
<h2>State</h2>
<p>Pending codes: ${state.pendingCodes} · access tokens: ${state.accessTokens} · refresh tokens: ${state.refreshTokens}
  · token requests: ${state.counters.tokenRequests} · refreshes: ${state.counters.refreshes} · logouts: ${state.counters.logouts}</p>
<p>Scenario: logout ${state.scenario.failLogout ? '<strong>fails</strong>' : 'succeeds'};
  next token request${tokenError ? `s (${tokenError.remaining}) fail with <strong>${escapeHtml(tokenError.error)}</strong>` : 's succeed'}.</p>
<h2>Demo controls</h2>
<div class="actions">
  <form method="post" action="/__demo/revoke"><button type="submit">Revoke access tokens (401 → refresh → retry)</button></form>
  <form method="post" action="/__demo/revoke"><input type="hidden" name="refresh" value="true"><button type="submit">Revoke everything (401 → session ended)</button></form>
  <form method="post" action="/__demo/logout-failure"><input type="hidden" name="enabled" value="${state.scenario.failLogout ? 'false' : 'true'}"><button type="submit">${state.scenario.failLogout ? 'Let logout succeed' : 'Make logout fail'}</button></form>
</div>
<form method="post" action="/__demo/token-error" class="actions">
  <label>Make the next <input type="number" name="times" value="1" min="1" style="width:4rem"> token request(s) fail with
    <select name="error">${scenarios}</select></label>
  <button type="submit">Apply</button>
</form>
<div class="actions">
  <form method="post" action="/__demo/reset"><button type="submit">Reset everything</button></form>
</div>
`,
  );
}

/** Avatar with the user's initials, generated on the fly. */
function avatarSvg(initials) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
<circle cx="48" cy="48" r="48" fill="#d3045d"/>
<text x="48" y="58" font-family="system-ui, sans-serif" font-size="36" text-anchor="middle" fill="#fff">${escapeHtml(initials)}</text>
</svg>
`;
}

/**
 * @param {ReturnType<import('./provider.mjs').createProvider>} provider
 * @param {{allowedOrigins?: ReadonlyArray<string>, log?: (line: string) => void}} [options]
 */
export function createRequestHandler(provider, options = {}) {
  const allowedOrigins = new Set(options.allowedOrigins ?? ['http://localhost:4200']);
  const log = options.log ?? (() => undefined);

  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    const path = url.pathname;

    const origin = req.headers.origin;
    if (typeof origin === 'string' && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    const finish = (status, headers, body) => {
      res.writeHead(status, headers);
      res.end(body);
      log(`${method} ${path} -> ${status}`);
    };
    const json = (status, body, headers = {}) =>
      finish(
        status,
        { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
        JSON.stringify(body),
      );
    const html = (status, body) =>
      finish(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body);
    const redirect = (location, status = 302) => finish(status, { Location: location }, '');
    const dropConnection = () => {
      log(`${method} ${path} -> connection dropped (network failure scenario)`);
      res.socket?.destroy();
    };

    try {
      if (method === 'OPTIONS') {
        finish(
          204,
          {
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type',
            'Access-Control-Max-Age': '600',
          },
          '',
        );
        return;
      }

      if (path === '/' && method === 'GET') {
        html(200, indexPage(provider));
        return;
      }

      if (path === '/oauth/authorize') {
        if (method === 'GET') {
          const params = queryOf(url);
          const validation = provider.validateAuthorizationRequest(params);
          if (validation.kind === 'invalid') {
            html(400, invalidRequestPage(validation.error, validation.description));
          } else if (validation.kind === 'redirect') {
            redirect(validation.location);
          } else {
            html(200, authorizePage(provider, params, validation.client, validation.request));
          }
          return;
        }
        if (method === 'POST') {
          const { fields } = await parseBody(req);
          const result = provider.authorize(fields, {
            approve: fields.decision === 'approve',
            username: typeof fields.username === 'string' ? fields.username : undefined,
            tokenError:
              typeof fields.token_error === 'string' && fields.token_error.length > 0
                ? fields.token_error
                : null,
          });
          if (result.kind === 'invalid') {
            html(400, invalidRequestPage(result.error, result.description));
          } else {
            redirect(result.location, 303);
          }
          return;
        }
      }

      if (path === '/oauth/token') {
        if (method !== 'POST') {
          json(405, { error: 'invalid_request', error_description: 'Use POST.' }, { Allow: 'POST' });
          return;
        }
        const { fields, contentType } = await parseBody(req);
        if (contentType !== 'application/x-www-form-urlencoded') {
          json(400, {
            error: 'invalid_request',
            error_description: 'The body must be application/x-www-form-urlencoded.',
          });
          return;
        }
        const result = provider.token(fields);
        if (result.kind === 'network_failure') {
          dropConnection();
          return;
        }
        json(result.status, result.body, { Pragma: 'no-cache' });
        return;
      }

      if (path === '/api/user' && method === 'GET') {
        const result = provider.userInfo(req.headers.authorization);
        json(result.status, result.body, result.headers);
        return;
      }

      const logoutMatch = /^\/api\/logout\/([^/]+)$/.exec(path);
      if (logoutMatch !== null && ['POST', 'DELETE', 'GET'].includes(method)) {
        const username = decodeURIComponent(logoutMatch[1]);
        const result = provider.logout(req.headers.authorization, username);
        json(result.status, result.body, result.headers);
        return;
      }

      const tenantMatch = /^\/api\/tenants\/([^/]+)$/.exec(path);
      if (tenantMatch !== null && method === 'GET') {
        const result = provider.tenant(req.headers.authorization, decodeURIComponent(tenantMatch[1]));
        json(result.status, result.body, result.headers);
        return;
      }

      const avatarMatch = /^\/images\/avatars\/([a-z0-9-]+)\.svg$/.exec(path);
      if (avatarMatch !== null && method === 'GET') {
        const user = provider.users.find((candidate) => candidate.photoPath === path);
        if (user === undefined) {
          json(404, { error: 'not_found' });
          return;
        }
        const initials = (user.name ?? user.username)
          .split(/[\s.@_-]+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0].toUpperCase())
          .join('');
        finish(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }, avatarSvg(initials));
        return;
      }

      if (path.startsWith('/__demo/')) {
        await handleDemoControl(path, method);
        return;
      }

      json(404, { error: 'not_found', error_description: `No route for ${method} ${path}.` });
    } catch (failure) {
      if (!res.headersSent) {
        json(500, { error: 'server_error', error_description: String(failure?.message ?? failure) });
      } else {
        res.end();
      }
    }

    async function handleDemoControl(controlPath, controlMethod) {
      if (controlPath === '/__demo/state' && controlMethod === 'GET') {
        json(200, provider.snapshot());
        return;
      }
      if (controlPath === '/__demo/users' && controlMethod === 'GET') {
        // Lets test code (e2e, scripts) discover the fictional accounts
        // instead of duplicating fixtures.mjs in another language.
        json(
          200,
          provider.users.map((user) => {
            const tenantId = tenantIdOf(user.username);
            const tenant =
              tenantId === null
                ? null
                : provider.tenants.find((candidate) => candidate.id.toLowerCase() === tenantId.toLowerCase()) ?? null;
            return {
              username: user.username,
              name: user.name,
              label: user.label ?? user.username,
              hasTenant: tenantId !== null,
              tenantName: tenant?.name ?? null,
            };
          }),
        );
        return;
      }
      if (controlMethod !== 'POST') {
        json(405, { error: 'invalid_request', error_description: 'Use POST.' }, { Allow: 'POST' });
        return;
      }
      const { fields, contentType } = await parseBody(req);
      const fromForm = contentType === 'application/x-www-form-urlencoded';
      const flag = (value) => value === true || value === 'true' || value === '1' || value === 'on';
      const done = () => (fromForm ? redirect('/', 303) : json(200, provider.snapshot()));

      switch (controlPath) {
        case '/__demo/revoke':
          if (flag(fields.refresh) || flag(url.searchParams.get('refresh'))) {
            provider.revokeAllTokens();
          } else {
            provider.revokeAccessTokens();
          }
          done();
          return;
        case '/__demo/logout-failure':
          provider.setLogoutFailure(flag(fields.enabled));
          done();
          return;
        case '/__demo/token-error': {
          const error = fields.error === '' || fields.error === undefined ? null : fields.error;
          if (error !== null && !isTokenErrorScenario(error)) {
            json(400, {
              error: 'invalid_request',
              error_description: `Unknown scenario; use one of ${TOKEN_ERROR_SCENARIOS.join(', ')}.`,
            });
            return;
          }
          provider.setTokenError(error, Number(fields.times ?? 1));
          done();
          return;
        }
        case '/__demo/reset':
          provider.reset();
          done();
          return;
        default:
          json(404, { error: 'not_found' });
      }
    }
  };
}
