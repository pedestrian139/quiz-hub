import { test, expect } from './helpers/fixtures.ts';
import { assertFullLayoutAudit } from './helpers/audit.ts';
import { FIXTURE_BANK, seedFixtureBank } from './helpers/fixtureBank.ts';
import {
  MOCK_API_BASE,
  clearGuestApiConfig,
  installMockLlm,
  seedGuestApiConfig,
} from './helpers/mockLlm.ts';
import {
  btnNext,
  btnRevealAnswer,
  modeCard,
  qRefAnswer,
  selectQuizFilters,
  selfCheckBtn,
} from './helpers/selectors.ts';
import { makeEmptyStore } from './helpers/storage.ts';

test.describe('Short-Answer Optional AI Grading (Desktop & Mobile)', () => {
  test('SHORT-AI-01: Default fresh state renders 3-level self-eval with zero API requests', async ({
    page,
  }) => {
    const mock = await installMockLlm(page);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();

    await expect(page.getByTestId('short-mode-self')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('short-mode-ai')).toHaveAttribute('aria-pressed', 'false');
    await expect(btnRevealAnswer(page)).toBeVisible();
    await expect(page.getByTestId('short-ai-textarea')).toBeHidden();
    expect(mock.requests).toHaveLength(0);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await assertFullLayoutAudit(page);

    await btnRevealAnswer(page).click();
    await expect(qRefAnswer(page)).toBeVisible();
    await selfCheckBtn(page, 2).click();
    await expect(selfCheckBtn(page, 2)).toHaveAttribute('aria-pressed', 'true');
    expect(mock.requests).toHaveLength(0);
  });

  test('SHORT-AI-02: AI grading shows cost hint, locks while loading, displays score/points/ref, auto-records mastery, supports override and retry', async ({
    page,
  }) => {
    await seedGuestApiConfig(page);
    const mock = await installMockLlm(page, {
      delayMs: 180,
      customHandler: async ({ body }, route) => {
        const sys = body.messages?.find((m) => m.role === 'system')?.content ?? '';
        if (!/阅卷助教|recommendedMastery/.test(sys)) return false;
        await new Promise((r) => setTimeout(r, 250));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            model: 'mock-quizhub-chat',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 85,
                    suggestedLevel: 2,
                    recommendedMastery: 2,
                    matchedPoints: ['阐述了核心结构约束', '覆盖关键边界条件'],
                    missingPoints: ['可补充时间复杂度对比'],
                    comment: '整体回答准确完整，建议补充复杂度分析。',
                    summary: '整体回答准确完整，建议补充复杂度分析。',
                  }),
                },
              },
            ],
          }),
        });
        return true;
      },
    });

    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();

    await page.getByTestId('short-mode-ai').click();
    await expect(page.getByTestId('short-mode-ai')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('short-ai-cost-hint')).toBeVisible();
    await expect(page.getByTestId('short-ai-submit')).toBeDisabled();
    expect(mock.requests).toHaveLength(0);

    const textarea = page.getByTestId('short-ai-textarea');
    await textarea.fill('核心结构约束能够稳定边界条件并保证逻辑一致。');
    expect(mock.requests).toHaveLength(0);
    await expect(page.getByTestId('short-ai-submit')).toBeEnabled();

    await page.getByTestId('short-ai-submit').click();
    await expect(page.getByTestId('short-ai-submit')).toBeDisabled();
    await expect(textarea).toBeDisabled();

    const result = page.getByTestId('short-ai-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('85 / 100');
    await expect(result).toContainText('阐述了核心结构约束');
    await expect(result).toContainText('可补充时间复杂度对比');
    await expect(result).toContainText('整体回答准确完整');

    await expect(qRefAnswer(page)).toBeVisible();
    await expect(selfCheckBtn(page, 2)).toHaveAttribute('aria-pressed', 'true');
    expect(mock.requests).toHaveLength(1);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await assertFullLayoutAudit(page);

    // Manual override
    await selfCheckBtn(page, 1).click();
    await expect(selfCheckBtn(page, 1)).toHaveAttribute('aria-pressed', 'true');
    await expect(selfCheckBtn(page, 2)).toHaveAttribute('aria-pressed', 'false');

    // Retry
    await page.getByTestId('short-ai-retry').click();
    await expect(page.getByTestId('short-ai-result')).toBeHidden();
    await expect(page.getByTestId('short-ai-textarea')).toBeEnabled();
    await expect(page.getByTestId('short-ai-textarea')).toHaveValue(
      '核心结构约束能够稳定边界条件并保证逻辑一致。',
    );
  });

  test('SHORT-AI-03: Selected mode persists across next question and page reload', async ({
    page,
  }) => {
    const mock = await installMockLlm(page);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();

    await page.getByTestId('short-mode-ai').click();
    await expect(page.getByTestId('short-ai-textarea')).toBeVisible();

    await btnNext(page).click();
    await expect(page.getByTestId('quiz-progress-text')).toContainText('2 /');
    await expect(page.getByTestId('short-mode-ai')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('short-ai-textarea')).toBeVisible();
    expect(mock.requests).toHaveLength(0);

    await page.reload();
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();
    await expect(page.getByTestId('short-mode-ai')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('short-ai-textarea')).toBeVisible();

    // Switch back to self-eval and navigate to next question -> stays in self-eval
    await page.getByTestId('short-mode-self').click();
    await expect(btnRevealAnswer(page)).toBeVisible();
    await btnNext(page).click();
    await expect(page.getByTestId('short-mode-self')).toHaveAttribute('aria-pressed', 'true');
    await expect(btnRevealAnswer(page)).toBeVisible();
    expect(mock.requests).toHaveLength(0);
  });

  test('SHORT-AI-04: Missing API key opens settings or switches back; 429 API error preserves draft', async ({
    page,
    healthTrap,
  }) => {
    await clearGuestApiConfig(page);
    const mock = await installMockLlm(page);
    await seedFixtureBank(page, FIXTURE_BANK, makeEmptyStore(), { targetHashRoute: '#/quiz' });
    await selectQuizFilters(page, { count: 10 });
    await modeCard(page, 'short').click();

    await page.getByTestId('short-mode-ai').click();
    await page.getByTestId('short-ai-textarea').fill('先写一段作答草稿用于验证配置提示。');
    await page.getByTestId('short-ai-submit').click();

    expect(mock.requests).toHaveLength(0);
    await expect(page.getByTestId('short-ai-missing-key')).toBeVisible();
    await expect(page.getByTestId('short-ai-textarea')).toHaveValue(
      '先写一段作答草稿用于验证配置提示。',
    );

    await page.getByTestId('short-ai-open-settings').click();
    await expect(page.getByTestId('api-settings-modal')).toBeVisible();
    await page.getByTestId('api-settings-close').click();
    await expect(page.getByTestId('api-settings-modal')).toBeHidden();

    await page.getByTestId('short-ai-switch-self').click();
    await expect(page.getByTestId('short-mode-self')).toHaveAttribute('aria-pressed', 'true');
    await expect(btnRevealAnswer(page)).toBeVisible();

    // Now test 429 API error preserving draft
    await mock.unroute();
    await page.evaluate((baseUrl: string) => {
      localStorage.setItem(
        'ai-intro-quiz-api-config-v1',
        JSON.stringify({
          provider: 'custom',
          baseUrl,
          apiKey: 'sk-e2e-err-key',
          model: 'mock-quizhub-chat',
          temperature: 0.3,
          maxTokens: 1200,
          timeoutMs: 30000,
          storageScope: 'local',
        }),
      );
    }, MOCK_API_BASE);

    await installMockLlm(page, {
      failOnMatch: /./,
      failCount: 1,
      failStatus: 429,
      failBody: { error: { message: 'rate limit exceeded' } },
    });
    healthTrap.expectHttpError(/chat\/completions/, 429);

    await page.getByTestId('short-mode-ai').click();
    const draft = '需要保留的作答草稿：HTTP 429 发生后内容不得丢失。';
    await page.getByTestId('short-ai-textarea').fill(draft);
    await page.getByTestId('short-ai-submit').click();

    await expect(page.getByTestId('short-ai-error')).toBeVisible();
    await expect(page.getByTestId('short-ai-textarea')).toHaveValue(draft);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await assertFullLayoutAudit(page);
  });
});
