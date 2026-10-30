/**
 * Cross-check between the Angular local-demo configuration
 * (`src/app/auth.config.local-demo.ts`, `src/environments/environment.demo.ts`,
 * `angular.json`) and the provider fixtures: the two sides of the contract
 * must name the same client, redirect URI and endpoints.
 *
 * The Angular files are read as text so that this suite stays free of any
 * TypeScript tooling; the Angular unit tests check the same values from the
 * TypeScript side.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { DEMO_CLIENT, DEMO_TENANTS, DEMO_USERS } from './fixtures.mjs';
import { tenantIdOf } from './provider.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const PROVIDER_ORIGIN = 'http://localhost:9001';

describe('Angular local-demo configuration vs provider fixtures', () => {
  const demoConfig = read('src/app/auth.config.local-demo.ts');

  it('names the fictional public client and its redirect URI', () => {
    assert.ok(demoConfig.includes(`clientId: '${DEMO_CLIENT.id}'`));
    assert.ok(demoConfig.includes(`redirectUri: '${DEMO_CLIENT.redirectUris[0]}'`));
  });

  it('points every endpoint at the provider routes served by http.mjs', () => {
    const expected = {
      authorizationEndpoint: `${PROVIDER_ORIGIN}/oauth/authorize`,
      tokenEndpoint: `${PROVIDER_ORIGIN}/oauth/token`,
      userInfoEndpoint: `${PROVIDER_ORIGIN}/api/user`,
      logoutEndpoint: `${PROVIDER_ORIGIN}/api/logout`,
      tenantsEndpoint: `${PROVIDER_ORIGIN}/api/tenants`,
    };
    for (const [key, url] of Object.entries(expected)) {
      assert.ok(demoConfig.includes(`${key}: '${url}'`), `${key} should be ${url}`);
    }
    const http = read('tools/mock-oauth-server/http.mjs');
    for (const route of ["'/oauth/authorize'", "'/oauth/token'", "'/api/user'", '\\/api\\/logout\\/', '\\/api\\/tenants\\/']) {
      assert.ok(http.includes(route), `http.mjs should route ${route}`);
    }
  });

  it('uses the provider default port', () => {
    assert.ok(read('tools/mock-oauth-server/server.mjs').includes('positiveInteger(env.PORT, 9001)'));
  });

  it('is wired through the demo build configuration only', () => {
    const angular = JSON.parse(read('angular.json'));
    const build = angular.projects['asso-angular-client'].architect.build.configurations;
    assert.deepEqual(build.demo.fileReplacements, [
      { replace: 'src/environments/environment.ts', with: 'src/environments/environment.demo.ts' },
    ]);
    assert.equal(build.production.fileReplacements, undefined);
    assert.equal(build.development.fileReplacements, undefined);
    const serve = angular.projects['asso-angular-client'].architect.serve.configurations;
    assert.equal(serve.demo.buildTarget, 'asso-angular-client:build:demo');

    assert.ok(read('src/environments/environment.demo.ts').includes('LOCAL_DEMO_AUTH_CONFIG'));
    assert.ok(read('src/environments/environment.ts').includes('DEVELOPMENT_AUTH_CONFIG'));
    assert.equal(read('src/environments/environment.ts').includes('LOCAL_DEMO'), false);
  });

  it('offers accounts whose tenant exists in the fixtures, or deliberately has none', () => {
    for (const user of DEMO_USERS) {
      const tenantId = tenantIdOf(user.username);
      if (tenantId !== null) {
        assert.ok(DEMO_TENANTS.some((tenant) => tenant.id === tenantId), user.username);
      }
    }
    assert.ok(DEMO_USERS.some((user) => tenantIdOf(user.username) === null));
  });
});
