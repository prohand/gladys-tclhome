import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const BASE = `# Changelog

## [Unreleased]

### Added

- Something.

[Unreleased]: https://github.com/prohand/gladys-tclhome/commits/main
`;

test('moves the Unreleased section under the released version', () => {
  const rolled = rollChangelog(BASE, '1.0.0', '2026-11-15');
  assert.match(
    rolled,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-11-15\n\n### Added\n\n- Something\./,
  );
  assert.match(
    rolled,
    /\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-tclhome\/compare\/v1\.0\.0\.\.\.HEAD/,
  );
  assert.match(
    rolled,
    /\[1\.0\.0\]: https:\/\/github\.com\/prohand\/gladys-tclhome\/releases\/tag\/v1\.0\.0/,
  );
});

test('an empty Unreleased section still names the release', () => {
  const rolled = rollChangelog('## [Unreleased]\n', '1.0.1', '2026-11-16');
  assert.match(rolled, /## \[1\.0\.1\] - 2026-11-16\n\n- Maintenance release/);
});

test('the changelog of the repository has an Unreleased section and no hand-written version', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(text, /^## \[Unreleased\]$/m);
  if (pkg.version === '0.0.0') {
    assert.doesNotMatch(
      text,
      /^## \[\d+\.\d+\.\d+\]/m,
      'versions are written by the Release workflow',
    );
  }
});
