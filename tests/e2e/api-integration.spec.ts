import { test, expect } from './helpers/fixtures';
import { assertNoHorizontalOverflow, assertNoOverlappingControls } from './helpers/audit';
import { gotoRoute, modeCard, quizOption, selfCheckBtn } from './helpers/selectors';

const MOCK_API_BASE = 'https://mock-llm.example.test/v1';

test.describe('V2 API Integration (feat/api-integration)', () => {
  test('API-E2E-01: API Settings modal opens, tests connection, fetches models, saves & persists without overflow', async ({
    page,
  }) => {
    await page.route(`${MOCK_API_BASE}/models`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'mock-deepseek-chat' }, { id: 'mock-qwen-plus' }],
        }),
      });
    });

    await page.route(`${MOCK_API_BASE}/chat/completions`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: 'mock-deepseek-chat',
          choices: [{ message: { content: 'OK' } }],
        }),
      });
    });

    await gotoRoute(page, 'hub');
    await assertNoHorizontalOverflow(page);
    await assertNoOverlappingControls(page);

    const navBtn = page.getByTestId('btn-api-settings');
    await expect(navBtn).toBeVisible();
    await expect(navBtn).toHaveAttribute('data-configured', 'false');

    await navBtn.click();
    const modal = page.getByTestId('api-settings-modal');
    await expect(modal).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await assertNoOverlappingControls(page);

    await page.getByTestId('api-preset-custom').click();
    await page.getByTestId('api-input-baseurl').fill(MOCK_API_BASE);
    await page.getByTestId('api-input-key').fill('sk-e2e-secret-9999');

    await page.getByTestId('api-fetch-models').click();
    await expect(page.getByTestId('api-settings-notice')).toContainText('已拉取 2 个可用模型');
    await page.getByRole('button', { name: 'mock-deepseek-chat' }).click();
    await expect(page.getByTestId('api-input-model')).toHaveValue('mock-deepseek-chat');

    await page.getByTestId('api-btn-test').click();
    await expect(page.getByTestId('api-test-result')).toContainText('连接成功');

    await page.getByTestId('api-btn-save').click();
    await expect(modal).toBeHidden();
    await expect(navBtn).toHaveAttribute('data-configured', 'true');

    // Verify persistence across reload and zero leakage into V1 quiz store
    await page.reload();
    await expect(page.getByTestId('btn-api-settings')).toHaveAttribute('data-configured', 'true');
    const quizStoreVal = await page.evaluate(() => localStorage.getItem('ai-intro-quiz-v1'));
    expect(quizStoreVal).toBeNull();
  });

  test('API-E2E-02: Objective question AI deep explanation & follow-up chat work cleanly after grading', async ({
    page,
  }) => {
    await page.addInitScript((baseUrl: string) => {
      localStorage.setItem(
        'ai-intro-quiz-api-config-v1',
        JSON.stringify({
          provider: 'custom',
          baseUrl,
          apiKey: 'sk-e2e-tutor',
          model: 'mock-tutor-1',
          temperature: 0.3,
          maxTokens: 800,
          timeoutMs: 30000,
          storageScope: 'local',
        }),
      );
    }, MOCK_API_BASE);

    await page.route(`${MOCK_API_BASE}/chat/completions`, async (route) => {
      const body = route.request().postDataJSON() as {
        messages?: Array<{ role: string; content: string }>;
      };
      const lastUser = body.messages?.[body.messages.length - 1]?.content ?? '';
      const reply = lastUser.includes('为什么')
        ? '这是一个直观的追问回复：**核心概念**对比非常清晰。'
        : '1) **核心考点**：识别基本概念。\n- 记忆口诀：先抓关键词，再排干扰项。';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: 'mock-tutor-1',
          choices: [{ message: { content: reply } }],
        }),
      });
    });

    await gotoRoute(page, 'quiz');
    await modeCard(page, 'choice').click();

    // Before grading, AI tutor must NOT be visible (no spoilers)
    await expect(page.getByTestId('ai-tutor-panel')).toHaveCount(0);

    await quizOption(page, 0).click();
    await expect(page.getByTestId('ai-tutor-panel')).toBeVisible();

    await page.getByTestId('ai-btn-explain').click();
    await expect(page.getByTestId('ai-explain-card')).toContainText('核心考点');

    await page.getByTestId('ai-btn-chat').click();
    await page.getByTestId('ai-chat-input').fill('为什么选这个？');
    await page.getByTestId('ai-chat-send').click();
    await expect(page.getByTestId('ai-chat-card')).toContainText('这是一个直观的追问回复');

    await assertNoHorizontalOverflow(page);
    await assertNoOverlappingControls(page);
  });

  test('API-E2E-03: Subjective AI grading evaluates draft and syncs recommended mastery self-check', async ({
    page,
  }) => {
    await page.addInitScript((baseUrl: string) => {
      localStorage.setItem(
        'ai-intro-quiz-api-config-v1',
        JSON.stringify({
          provider: 'custom',
          baseUrl,
          apiKey: 'sk-e2e-grader',
          model: 'mock-grader-1',
          temperature: 0.2,
          maxTokens: 900,
          timeoutMs: 30000,
          storageScope: 'local',
        }),
      );
    }, MOCK_API_BASE);

    await page.route(`${MOCK_API_BASE}/chat/completions`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: 'mock-grader-1',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  score: 88,
                  recommendedMastery: 2,
                  summary: '核心概念表述准确，逻辑清晰。',
                  matchedPoints: ['核心机制准确'],
                  missingPoints: ['可补充一个典型应用案例'],
                  improvedAnswer: '示范回答：结合核心机制与典型应用场景完整作答。',
                }),
              },
            },
          ],
        }),
      });
    });

    await gotoRoute(page, 'quiz');
    await modeCard(page, 'short').click();

    await page.getByTestId('ai-btn-grade-toggle').click();
    await page.getByTestId('ai-grade-textarea').fill('这是我的主观题作答草稿，涵盖核心机制。');
    await page.getByTestId('ai-btn-submit-grade').click();

    await expect(page.getByTestId('ai-grade-result')).toContainText('88 / 100');
    await expect(page.getByTestId('ai-grade-result')).toContainText('核心概念表述准确');

    await page.getByTestId('ai-btn-apply-mastery').click();
    await expect(selfCheckBtn(page, 2)).toHaveAttribute('aria-pressed', 'true');

    await assertNoHorizontalOverflow(page);
    await assertNoOverlappingControls(page);
  });
});
