import { test as base, expect } from '@playwright/test';
import type { TestInfo } from '@playwright/test';

export interface RequestFailureEntry {
  url: string;
  method: string;
  reason: string;
}

export interface HttpErrorEntry {
  url: string;
  status: number;
  statusText: string;
}

export interface RuntimeHealthTrap {
  consoleErrors: string[];
  pageErrors: string[];
  requestFailed: RequestFailureEntry[];
  httpErrors: HttpErrorEntry[];
  allowUrlOnce(pattern: string | RegExp): void;
}

function matchesPattern(url: string, pattern: string | RegExp): boolean {
  if (typeof pattern === 'string') {
    return url.includes(pattern);
  }
  return pattern.test(url);
}

export function assertRuntimeClean(trap: RuntimeHealthTrap): void {
  const issues: string[] = [];

  if (trap.consoleErrors.length > 0) {
    issues.push(
      `console.error (${trap.consoleErrors.length}):\n  - ${trap.consoleErrors.join('\n  - ')}`,
    );
  }
  if (trap.pageErrors.length > 0) {
    issues.push(
      `pageerror (${trap.pageErrors.length}):\n  - ${trap.pageErrors.join('\n  - ')}`,
    );
  }
  if (trap.requestFailed.length > 0) {
    issues.push(
      `requestfailed (${trap.requestFailed.length}):\n  - ${trap.requestFailed
        .map((r) => `${r.method} ${r.url} (${r.reason})`)
        .join('\n  - ')}`,
    );
  }
  if (trap.httpErrors.length > 0) {
    issues.push(
      `HTTP >= 400 (${trap.httpErrors.length}):\n  - ${trap.httpErrors
        .map((e) => `${e.status} ${e.statusText} ${e.url}`)
        .join('\n  - ')}`,
    );
  }

  expect(issues, `Runtime health check failed:\n${issues.join('\n')}`).toEqual([]);
}

export function onlyDesktop(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== 'desktop',
    'Desktop (1440x900) designated scenario',
  );
}

export function onlyMobile(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== 'mobile',
    'Mobile (390x844) designated scenario',
  );
}

export const test = base.extend<{
  healthTrap: RuntimeHealthTrap;
  viewportKind: 'desktop' | 'mobile';
}>({
  viewportKind: async ({}, use, testInfo) => {
    const kind = testInfo.project.name === 'mobile' ? 'mobile' : 'desktop';
    await use(kind);
  },

  healthTrap: [
    async ({ page }, use) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const requestFailed: RequestFailureEntry[] = [];
      const httpErrors: HttpErrorEntry[] = [];
      const allowedOnce: Array<string | RegExp> = [];

      const consumeAllowed = (url: string): boolean => {
        const idx = allowedOnce.findIndex((p) => matchesPattern(url, p));
        if (idx !== -1) {
          allowedOnce.splice(idx, 1);
          return true;
        }
        return false;
      };

      const onConsole = (msg: { type(): string; text(): string }) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      };

      const onPageError = (err: Error) => {
        pageErrors.push(err.stack ?? err.message);
      };

      const onRequestFailed = (req: {
        url(): string;
        method(): string;
        failure(): { errorText: string } | null;
      }) => {
        const url = req.url();
        if (consumeAllowed(url)) {
          return;
        }
        requestFailed.push({
          url,
          method: req.method(),
          reason: req.failure()?.errorText ?? 'unknown',
        });
      };

      const onResponse = (res: {
        url(): string;
        status(): number;
        statusText(): string;
      }) => {
        if (res.status() >= 400) {
          const url = res.url();
          if (consumeAllowed(url)) {
            return;
          }
          httpErrors.push({
            url,
            status: res.status(),
            statusText: res.statusText(),
          });
        }
      };

      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      page.on('requestfailed', onRequestFailed);
      page.on('response', onResponse);

      const trap: RuntimeHealthTrap = {
        consoleErrors,
        pageErrors,
        requestFailed,
        httpErrors,
        allowUrlOnce(pattern: string | RegExp) {
          allowedOnce.push(pattern);
        },
      };

      await use(trap);

      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);

      assertRuntimeClean(trap);
    },
    { auto: true },
  ],
});

export { expect };
