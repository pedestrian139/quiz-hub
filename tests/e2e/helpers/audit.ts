import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function waitForLayoutSettle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (document.fonts && 'ready' in document.fonts) {
      try {
        await document.fonts.ready;
      } catch {
        // Ignore font readiness rejections in restricted contexts
      }
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

export async function assertNoHorizontalOverflow(
  page: Page,
  tolerancePx = 1,
): Promise<void> {
  await waitForLayoutSettle(page);
  const configuredWidth = page.viewportSize()?.width ?? null;

  const report = await page.evaluate(
    ({ tol, expectedWidth }: { tol: number; expectedWidth: number | null }) => {
      const innerWidth = window.innerWidth;
      const limitWidth =
        expectedWidth !== null ? Math.min(innerWidth, expectedWidth) : innerWidth;
      const scrollWidth = document.documentElement.scrollWidth;
      if (scrollWidth <= limitWidth + tol && innerWidth <= limitWidth + tol) {
        return {
          ok: true as const,
          scrollWidth,
          innerWidth,
          limitWidth,
          offenders: [] as string[],
        };
      }

      const isClippedByAncestor = (el: Element): boolean => {
        let cur = el.parentElement;
        while (cur && cur !== document.documentElement) {
          const style = window.getComputedStyle(cur);
          const ox = style.overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') {
            const curRect = cur.getBoundingClientRect();
            if (curRect.right <= limitWidth + tol && curRect.left >= -tol) {
              return true;
            }
          }
          cur = cur.parentElement;
        }
        return false;
      };

      const offenders: string[] = [];
      const nodes = document.querySelectorAll('body *');
      for (const el of nodes) {
        if (offenders.length >= 10) break;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if ((rect.right > limitWidth + tol || rect.left < -tol) && !isClippedByAncestor(el)) {
          const tag = el.tagName.toLowerCase();
          const testId = el.getAttribute('data-testid');
          const cls =
            typeof el.className === 'string' && el.className.trim()
              ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
              : '';
          offenders.push(
            `${tag}${testId ? `[data-testid="${testId}"]` : ''}${cls} rect=[${rect.left.toFixed(1)}..${rect.right.toFixed(1)}] > ${limitWidth}`,
          );
        }
      }

      return { ok: false as const, scrollWidth, innerWidth, limitWidth, offenders };
    },
    { tol: tolerancePx, expectedWidth: configuredWidth },
  );

  expect(
    report.ok,
    `Horizontal overflow detected: scrollWidth=${report.scrollWidth}, innerWidth=${report.innerWidth}, limit=${report.limitWidth}. Offenders:\n${report.offenders.join('\n')}`,
  ).toBe(true);
}

export async function assertNoOverlappingControls(
  page: Page,
  tolerancePx = 1.5,
): Promise<void> {
  await waitForLayoutSettle(page);

  const collisions = await page.evaluate((tol: number) => {
    const selector = [
      'button',
      'a[href]',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const getVisibleClippedRect = (el: Element) => {
      const r = el.getBoundingClientRect();
      let left = r.left;
      let top = r.top;
      let right = r.right;
      let bottom = r.bottom;
      if (right - left < 2 || bottom - top < 2) return null;

      let childPos = window.getComputedStyle(el).position;
      let cur = el.parentElement;
      while (cur && cur !== document.documentElement) {
        if (childPos === 'fixed') break;
        const cst = window.getComputedStyle(cur);
        const ox = cst.overflowX;
        const oy = cst.overflowY;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') {
          const cr = cur.getBoundingClientRect();
          left = Math.max(left, cr.left);
          right = Math.min(right, cr.right);
        }
        if (oy === 'auto' || oy === 'scroll' || oy === 'hidden' || oy === 'clip') {
          const cr = cur.getBoundingClientRect();
          top = Math.max(top, cr.top);
          bottom = Math.min(bottom, cr.bottom);
        }
        if (right - left < 2 || bottom - top < 2) return null;
        childPos = cst.position;
        cur = cur.parentElement;
      }
      return { left, top, right, bottom };
    };

    const isElementVisible = (el: Element): boolean => {
      if (el.closest('[hidden], [aria-hidden="true"]')) return false;
      let cur: Element | null = el;
      while (cur && cur !== document.documentElement) {
        const st = window.getComputedStyle(cur);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') {
          return false;
        }
        cur = cur.parentElement;
      }
      if (el.getClientRects().length === 0) return false;
      return getVisibleClippedRect(el) !== null;
    };

    const modals = Array.from(
      document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
    ).filter((m) => isElementVisible(m));

    const rawCandidates = Array.from(document.querySelectorAll(selector)).filter((el) => {
      if (!isElementVisible(el)) return false;
      if (modals.length > 0) {
        return modals.some((m) => m.contains(el));
      }
      return true;
    });

    const items = rawCandidates
      .map((el) => {
        const rect = getVisibleClippedRect(el);
        if (!rect) return null;
        const tag = el.tagName.toLowerCase();
        const testId = el.getAttribute('data-testid');
        const label = (
          el.getAttribute('aria-label') ||
          (el as HTMLElement).innerText ||
          el.textContent ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 32);
        return {
          el,
          rect,
          desc: `${tag}${testId ? `[data-testid="${testId}"]` : ''}(${label})`,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const found: string[] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (!a || !b) continue;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;

        const ixW = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const ixH = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (ixW > tol && ixH > tol) {
          found.push(
            `${a.desc} [${a.rect.left.toFixed(1)},${a.rect.top.toFixed(1)},${a.rect.right.toFixed(1)},${a.rect.bottom.toFixed(1)}] overlaps ${b.desc} [${b.rect.left.toFixed(1)},${b.rect.top.toFixed(1)},${b.rect.right.toFixed(1)},${b.rect.bottom.toFixed(1)}] by ${ixW.toFixed(1)}x${ixH.toFixed(1)}px`,
          );
          if (found.length >= 10) return found;
        }
      }
    }

    return found;
  }, tolerancePx);

  expect(
    collisions,
    `Overlapping interactive controls detected:\n${collisions.join('\n')}`,
  ).toEqual([]);
}

export async function assertHandbookTablesContained(
  page: Page,
  tolerancePx = 1,
): Promise<void> {
  await assertNoHorizontalOverflow(page, tolerancePx);
  const configuredWidth = page.viewportSize()?.width ?? null;

  const tableIssues = await page.evaluate(
    ({ tol, expectedWidth }: { tol: number; expectedWidth: number | null }) => {
      const innerWidth =
        expectedWidth !== null
          ? Math.min(window.innerWidth, expectedWidth)
          : window.innerWidth;
      const issues: string[] = [];
      const tables = Array.from(document.querySelectorAll('table'));

      tables.forEach((table, idx) => {
        const style = window.getComputedStyle(table);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        const rect = table.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        const parentClientWidth = table.parentElement?.clientWidth ?? innerWidth;
        const needsScrollContainer =
          rect.right > innerWidth + tol ||
          table.scrollWidth > parentClientWidth + tol ||
          table.scrollWidth > innerWidth + tol;

        if (!needsScrollContainer) {
          return;
        }

        let wrapper: HTMLElement | null = table.parentElement;
        let validWrapper: HTMLElement | null = null;
        while (wrapper && wrapper !== document.body && wrapper !== document.documentElement) {
          const wst = window.getComputedStyle(wrapper);
          if (wst.overflowX === 'auto' || wst.overflowX === 'scroll') {
            const wRect = wrapper.getBoundingClientRect();
            if (
              wRect.right <= innerWidth + tol &&
              wrapper.clientWidth <= innerWidth + tol
            ) {
              validWrapper = wrapper;
              break;
            }
          }
          wrapper = wrapper.parentElement;
        }

        if (!validWrapper) {
          issues.push(
            `Table #${idx} (scrollWidth=${table.scrollWidth}, rect.right=${rect.right.toFixed(1)}, limitWidth=${innerWidth}) lacks a bounded overflow-x:auto|scroll wrapper`,
          );
          return;
        }

        if (validWrapper.scrollWidth > validWrapper.clientWidth + tol) {
          const prev = validWrapper.scrollLeft;
          validWrapper.scrollLeft = 16;
          const moved = validWrapper.scrollLeft;
          validWrapper.scrollLeft = prev;
          if (moved <= 0) {
            issues.push(
              `Table #${idx} wrapper has scrollWidth=${validWrapper.scrollWidth} > clientWidth=${validWrapper.clientWidth}, but scrollLeft probe did not advance`,
            );
          }
        }
      });

      return issues;
    },
    { tol: tolerancePx, expectedWidth: configuredWidth },
  );

  expect(
    tableIssues,
    `Handbook table containment issues:\n${tableIssues.join('\n')}`,
  ).toEqual([]);
}

export async function assertFullLayoutAudit(
  page: Page,
  opts?: { checkTables?: boolean; tolerancePx?: number },
): Promise<void> {
  const tol = opts?.tolerancePx ?? 1;
  await assertNoHorizontalOverflow(page, tol);
  await assertNoOverlappingControls(page, 1.5);
  const shouldCheckTables =
    opts?.checkTables || (await page.locator('table:visible').count()) > 0;
  if (shouldCheckTables) {
    await assertHandbookTablesContained(page, tol);
  }
}
