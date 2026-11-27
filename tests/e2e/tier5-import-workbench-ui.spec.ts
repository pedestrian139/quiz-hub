import type { Page } from '@playwright/test';
import {
  expect,
  onlyDesktop,
  onlyMobile,
  test,
} from './helpers/fixtures.ts';
import { assertFullLayoutAudit } from './helpers/audit.ts';
import { installMockLlm, seedGuestApiConfig } from './helpers/mockLlm.ts';
import {
  aiRewashDirtyHint,
  aiWashBtn,
  btnConfirmImportSticky,
  btnOpenQuizImport,
  draftEdit,
  gotoRoute,
  importPasteTextarea,
  importTab,
  previewDraft,
  quizImportDialog,
  washPrefExplain,
  washTargetBankName,
  washTypeCheckbox,
  washTypeObjectiveBtn,
  workbenchSidebar,
  workbenchSidebarClose,
  workbenchSidebarToggle,
  workbenchStickyBar,
} from './helpers/selectors.ts';

function buildMultiTypeQuestionsText(count = 4): string {
  const base = [
    '1. HTTP 默认使用的传输层端口是？',
    'A. 21',
    'B. 80',
    'C. 443',
    'D. 3306',
    '答案：B',
    '',
    '2. 以下哪些属于面向对象程序设计的基本特征？（多选）',
    'A. 封装',
    'B. 轮询',
    'C. 继承',
    'D. 多态',
    '答案：A、C、D',
    '',
    '3. 判断题：在关系数据库中，主键不允许包含 NULL 值。',
    '答案：正确',
    '',
    '4. 简答题：请简述哈希冲突的常见解决方法。',
    '答案：链地址法与开放定址法。',
  ];
  if (count <= 4) return base.join('\n');

  const blocks = [base.join('\n')];
  for (let i = 5; i <= count; i++) {
    blocks.push(
      [
        `${i}. 长列表滚动测试第 ${i} 题：关于分布式系统与并发控制的原理辨析，下列说法正确的是？`,
        'A. 满足状态机安全性约束',
        'B. 允许任意节点覆盖已提交日志',
        'C. 无需任何心跳超时检测',
        'D. 必须关闭持久化写盘',
        '答案：A',
      ].join('\n'),
    );
  }
  return blocks.join('\n\n');
}

async function openWorkbenchPaste(page: Page): Promise<void> {
  await btnOpenQuizImport(page).click();
  await expect(quizImportDialog(page)).toBeVisible();
  await importTab(page, 'paste').click();
}

test.describe('ImportWorkbench Apple 3-State Layout, Push-Aside Sidebar & Dual-Track Linkage', () => {
  test('Desktop 1440x900: centered initial state, auto-collapsed review, push-aside independent scroll, dual-track linkage & light/dark audit', async ({
    page,
  }, testInfo) => {
    onlyDesktop(testInfo);
    await seedGuestApiConfig(page);
    const mockLlm = await installMockLlm(page);

    await gotoRoute(page, '#/');
    await openWorkbenchPaste(page);

    // 1. State 1: Initial centered single-column (no placeholder, no preview, modal height locked)
    await expect(page.locator('.qi-preview-placeholder')).toHaveCount(0);
    await expect(page.getByTestId('import-preview')).toHaveCount(0);
    await expect(workbenchSidebarToggle(page)).toHaveCount(0);

    const initialMetrics = await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="quiz-import-dialog"]') as HTMLElement;
      const input = document.querySelector('.qi-workbench__input--initial') as HTMLElement;
      const mRect = modal.getBoundingClientRect();
      const iRect = input.getBoundingClientRect();
      return {
        modalHeight: mRect.height,
        viewportHeight: window.innerHeight,
        modalScrollHeight: modal.scrollHeight,
        modalClientHeight: modal.clientHeight,
        inputWidth: iRect.width,
        leftGap: iRect.left - mRect.left,
        rightGap: mRect.right - iRect.right,
      };
    });
    expect(initialMetrics.modalHeight).toBeLessThanOrEqual(initialMetrics.viewportHeight);
    expect(initialMetrics.modalScrollHeight).toBeLessThanOrEqual(
      initialMetrics.modalClientHeight + 2,
    );
    expect(initialMetrics.inputWidth).toBeLessThanOrEqual(700);
    expect(Math.abs(initialMetrics.leftGap - initialMetrics.rightGap)).toBeLessThanOrEqual(24);
    await assertFullLayoutAudit(page);

    // 2. State 2: Parse 4 types -> auto-enter 100% full-width review with sidebar collapsed
    await importPasteTextarea(page).fill(buildMultiTypeQuestionsText(4));
    await page.getByTestId('btn-parse-paste').click();

    await expect(page.getByTestId('import-preview')).toBeVisible();
    const toggleBtn = workbenchSidebarToggle(page);
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(toggleBtn).toHaveAttribute('aria-label', '展开导入配置');
    await expect(toggleBtn.locator('svg')).toHaveCount(1);
    await expect(workbenchSidebar(page)).toBeHidden();

    // Normal valid card must NOT have green '校验通过' pill
    await expect(previewDraft(page, 0)).not.toContainText('校验通过');

    // Toast visible right after parse must not overlap btn-cancel-import and must have opaque base surface
    const desktopToast = page.locator('.qi-modal__body--workbench > .qi-toast');
    await expect(desktopToast).toBeVisible();
    const desktopToastMetrics = await page.evaluate(() => {
      const toast = document.querySelector('.qi-modal__body--workbench > .qi-toast') as HTMLElement;
      const cancelBtn = document.querySelector('[data-testid="btn-cancel-import"]') as HTMLElement;
      const tRect = toast.getBoundingClientRect();
      const cRect = cancelBtn.getBoundingClientRect();
      const intersects =
        Math.min(tRect.right, cRect.right) > Math.max(tRect.left, cRect.left) &&
        Math.min(tRect.bottom, cRect.bottom) > Math.max(tRect.top, cRect.top);
      const bg = window.getComputedStyle(toast).backgroundColor;
      return { intersects, toastTop: tRect.top, cancelBottom: cRect.bottom, bg };
    });
    expect(desktopToastMetrics.intersects).toBe(false);
    expect(desktopToastMetrics.toastTop).toBeGreaterThanOrEqual(desktopToastMetrics.cancelBottom);
    expect(desktopToastMetrics.bg).toMatch(/^rgb\(/);

    const fullWidthMetrics = await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="quiz-import-dialog"]')!.getBoundingClientRect();
      const preview = document.querySelector('.qi-workbench__preview')!.getBoundingClientRect();
      return { modalWidth: modal.width, previewWidth: preview.width };
    });
    expect(fullWidthMetrics.previewWidth).toBeGreaterThan(fullWidthMetrics.modalWidth * 0.9);
    await assertFullLayoutAudit(page);

    // 3. State 3: Click panelLeft toggle -> push-aside split (no overlay covering preview)
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(workbenchSidebar(page)).toBeVisible();
    await expect(page.locator('.qi-sidebar-backdrop')).toHaveCount(0);

    await expect
      .poll(async () => {
        const side = await page.evaluate(
          () => document.querySelector('[data-testid="workbench-sidebar"]')!.getBoundingClientRect().width,
        );
        return side;
      })
      .toBeGreaterThanOrEqual(340);

    const splitMetrics = await page.evaluate(() => {
      const side = document.querySelector('[data-testid="workbench-sidebar"]')!.getBoundingClientRect();
      const preview = document.querySelector('.qi-workbench__preview')!.getBoundingClientRect();
      return { sideRight: side.right, previewLeft: preview.left, sideWidth: side.width };
    });
    expect(splitMetrics.sideWidth).toBeGreaterThanOrEqual(340);
    expect(splitMetrics.sideRight).toBeLessThanOrEqual(splitMetrics.previewLeft + 2);
    await assertFullLayoutAudit(page);

    // 4. Track A: Real-time filtering & target bank sync with 0 LLM requests + lossless restore
    mockLlm.clear();
    await draftEdit(page, 3).click();
    await page.getByTestId('draft-edit-stem-3').fill('人工编辑后的简答题干');

    await washTypeObjectiveBtn(page).click();
    await expect(page.locator('[data-testid^="preview-draft-"]')).toHaveCount(3);
    await expect(btnConfirmImportSticky(page)).toContainText('共 3 题');

    await washTypeCheckbox(page, 'short').check();
    await expect(page.locator('[data-testid^="preview-draft-"]')).toHaveCount(4);
    await expect(previewDraft(page, 3)).toContainText('人工编辑后的简答题干');

    await washTargetBankName(page).fill('双轨联动测试库');
    await expect(workbenchStickyBar(page)).toContainText('《双轨联动测试库》');
    expect(mockLlm.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(0);

    // 5. Track B: AI preference / paste changes never auto-call AI or overwrite edits until click
    await washPrefExplain(page).uncheck();
    await importPasteTextarea(page).fill(buildMultiTypeQuestionsText(4) + '\n');
    await page.waitForTimeout(300);

    expect(mockLlm.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(0);
    await expect(previewDraft(page, 3)).toContainText('人工编辑后的简答题干');
    await expect(aiWashBtn(page)).toHaveAttribute('data-dirty', 'true');
    await expect(aiWashBtn(page)).toContainText('按新配置重新洗题');
    await expect(aiRewashDirtyHint(page)).toBeVisible();

    await aiWashBtn(page).click();
    await expect(page.getByTestId('ai-wash-progress')).toHaveCount(0);
    await expect(previewDraft(page, 0)).toBeVisible();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(
      mockLlm.requests.filter((r) => r.url.endsWith('/chat/completions')).length,
    ).toBeGreaterThanOrEqual(1);

    // 6. Long-list independent scroll + sticky bar non-occlusion + light/dark mode check
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(workbenchSidebar(page)).toBeVisible();
    await importTab(page, 'paste').click();
    await importPasteTextarea(page).fill(buildMultiTypeQuestionsText(28));
    await page.getByTestId('btn-parse-paste').click();
    await expect(page.locator('[data-testid^="preview-draft-"]')).toHaveCount(28);

    // Ensure sidebar is open and scroll preview to bottom; sidebar input must stay pinned in viewport
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    await toggleBtn.click();
    await expect
      .poll(async () =>
        page.evaluate(
          () => document.querySelector('[data-testid="workbench-sidebar"]')!.getBoundingClientRect().width,
        ),
      )
      .toBeGreaterThanOrEqual(340);
    const sidebarBeforeScroll = await washTargetBankName(page).boundingBox();
    const scrollNonOcclusion = await page.evaluate(() => {
      const scroller = document.querySelector('.qi-preview-scroll') as HTMLElement;
      scroller.scrollTop = scroller.scrollHeight;
      const cards = document.querySelectorAll('[data-testid^="preview-draft-"]');
      const lastCard = cards[cards.length - 1] as HTMLElement;
      const sticky = document.querySelector('[data-testid="workbench-sticky-bar"]') as HTMLElement;
      const lastRect = lastCard.getBoundingClientRect();
      const stickyRect = sticky.getBoundingClientRect();
      const stickyStyle = window.getComputedStyle(sticky);
      return {
        scrollerScrollTop: scroller.scrollTop,
        lastBottom: lastRect.bottom,
        stickyTop: stickyRect.top,
        stickyBg: stickyStyle.backgroundColor,
        stickyBorderTop: stickyStyle.borderTopWidth,
      };
    });
    const sidebarAfterScroll = await washTargetBankName(page).boundingBox();

    expect(scrollNonOcclusion.scrollerScrollTop).toBeGreaterThan(100);
    expect(scrollNonOcclusion.lastBottom).toBeLessThanOrEqual(scrollNonOcclusion.stickyTop + 2);
    expect(scrollNonOcclusion.stickyBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(Number.parseFloat(scrollNonOcclusion.stickyBorderTop)).toBeGreaterThan(0);
    expect(Math.abs(sidebarAfterScroll!.y - sidebarBeforeScroll!.y)).toBeLessThanOrEqual(2);

    // Close modal briefly to verify light & dark themes on open workbench
    await page.getByTestId('btn-close-quiz-import').click();
    for (const theme of ['dark', 'light'] as const) {
      await page.getByTestId(`theme-option-${theme}`).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await openWorkbenchPaste(page);
      await assertFullLayoutAudit(page);
      await importPasteTextarea(page).fill(buildMultiTypeQuestionsText(4));
      await page.getByTestId('btn-parse-paste').click();
      await assertFullLayoutAudit(page);

      const modalBg = await quizImportDialog(page).evaluate(
        (el) => window.getComputedStyle(el).backgroundColor,
      );
      if (theme === 'dark') {
        expect(modalBg).toBe('rgb(0, 0, 0)');
      } else {
        expect(modalBg).toBe('rgb(245, 245, 247)');
      }

      await workbenchSidebarToggle(page).click();
      await assertFullLayoutAudit(page);
      await page.getByTestId('btn-close-quiz-import').click();
    }
  });

  test('Mobile 390x844: initial centered, collapsed drawer, slide-over drawer live filter & sticky bar non-occlusion', async ({
    page,
  }, testInfo) => {
    onlyMobile(testInfo);
    const mockLlm = await installMockLlm(page);

    await gotoRoute(page, '#/');
    await openWorkbenchPaste(page);
    await expect(page.locator('.qi-preview-placeholder')).toHaveCount(0);
    await assertFullLayoutAudit(page);

    await importPasteTextarea(page).fill(buildMultiTypeQuestionsText(14));
    await page.getByTestId('btn-parse-paste').click();

    await expect(page.locator('[data-testid^="preview-draft-"]')).toHaveCount(14);
    await expect(workbenchSidebarToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(workbenchSidebar(page)).toBeHidden();

    // Mobile toast visible right after parse must not overlap btn-cancel-import and must have opaque base surface
    const mobileToast = page.locator('.qi-modal__body--workbench > .qi-toast');
    await expect(mobileToast).toBeVisible();
    const mobileToastMetrics = await page.evaluate(() => {
      const toast = document.querySelector('.qi-modal__body--workbench > .qi-toast') as HTMLElement;
      const cancelBtn = document.querySelector('[data-testid="btn-cancel-import"]') as HTMLElement;
      const tRect = toast.getBoundingClientRect();
      const cRect = cancelBtn.getBoundingClientRect();
      const intersects =
        Math.min(tRect.right, cRect.right) > Math.max(tRect.left, cRect.left) &&
        Math.min(tRect.bottom, cRect.bottom) > Math.max(tRect.top, cRect.top);
      const bg = window.getComputedStyle(toast).backgroundColor;
      return { intersects, toastTop: tRect.top, cancelBottom: cRect.bottom, bg };
    });
    expect(mobileToastMetrics.intersects).toBe(false);
    expect(mobileToastMetrics.toastTop).toBeGreaterThanOrEqual(mobileToastMetrics.cancelBottom);
    expect(mobileToastMetrics.bg).toMatch(/^rgb\(/);

    await assertFullLayoutAudit(page);

    // Open mobile slide-over drawer -> audit passes (preview aria-hidden while drawer open)
    await workbenchSidebarToggle(page).click();
    await expect(workbenchSidebar(page)).toBeVisible();
    const drawerBox = await workbenchSidebar(page).boundingBox();
    expect(drawerBox!.width).toBeLessThanOrEqual(390);
    await assertFullLayoutAudit(page);

    // Filter out tf inside drawer -> 0 LLM calls -> close drawer -> count updated
    await washTypeCheckbox(page, 'tf').uncheck();
    expect(mockLlm.requests.filter((r) => r.url.endsWith('/chat/completions'))).toHaveLength(0);
    await workbenchSidebarClose(page).click();
    await expect(workbenchSidebar(page)).toBeHidden();
    await expect(page.locator('[data-testid^="preview-draft-"]')).toHaveCount(13);
    await assertFullLayoutAudit(page);

    // Scroll preview to bottom on mobile -> last card stays above sticky bar
    const mobileScroll = await page.evaluate(() => {
      const scroller = document.querySelector('.qi-preview-scroll') as HTMLElement;
      scroller.scrollTop = scroller.scrollHeight;
      const cards = document.querySelectorAll('[data-testid^="preview-draft-"]');
      const lastCard = cards[cards.length - 1] as HTMLElement;
      const sticky = document.querySelector('[data-testid="workbench-sticky-bar"]') as HTMLElement;
      return {
        lastBottom: lastCard.getBoundingClientRect().bottom,
        stickyTop: sticky.getBoundingClientRect().top,
      };
    });
    expect(mobileScroll.lastBottom).toBeLessThanOrEqual(mobileScroll.stickyTop + 2);
  });
});
