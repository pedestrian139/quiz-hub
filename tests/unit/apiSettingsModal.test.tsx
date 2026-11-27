// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiSettingsModal } from '../../src/components/ApiSettings/ApiSettingsModal';
import { PracticeScopeContext } from '../../src/hooks/practiceScope';
import { accountPracticeScope, LEGACY_GUEST_SCOPE, type PracticeScope } from '../../src/core/practiceScope';
import { API_MODELS_CACHE_KEY, loadCachedProviderModels } from '../../src/services/apiConfig';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flushMicrotasks(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

describe('ApiSettingsModal dynamic model catalog & combobox UX', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = null;
    }
    container.remove();
  });

  async function renderModal(scope: PracticeScope = LEGACY_GUEST_SCOPE): Promise<void> {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <PracticeScopeContext.Provider value={scope}>
          <ApiSettingsModal open onClose={() => {}} />
        </PracticeScopeContext.Provider>,
      );
    });
  }

  it('shows updated guest/cloud privacy copy, DeepSeek V4 presets, and default maxTokens=4096', async () => {
    await renderModal(LEGACY_GUEST_SCOPE);
    const privacyDesc = document.body.querySelector('[data-testid="api-privacy-desc"]')!;
    expect(privacyDesc.textContent).toContain('游客模式');
    expect(privacyDesc.textContent).toContain('登录账号');

    const modelInput = document.body.querySelector<HTMLInputElement>('[data-testid="api-input-model"]')!;
    expect(modelInput.value).toBe('deepseek-flash');

    // Open dropdown to check fallback DeepSeek presets
    const toggleBtn = document.body.querySelector<HTMLButtonElement>('[data-testid="api-model-dropdown-toggle"]')!;
    await act(async () => {
      toggleBtn.click();
    });
    const flashOpt = document.body.querySelector('[data-testid="api-model-option-deepseek-flash"]')!;
    const proOpt = document.body.querySelector('[data-testid="api-model-option-deepseek-v4-pro"]')!;
    expect(flashOpt.textContent).toContain('V4.1-Flash');
    expect(proOpt.textContent).toContain('V4-Pro');

    // Expand advanced settings and check default maxTokens=4096
    const advBtn = document.body.querySelector<HTMLButtonElement>('[data-testid="api-toggle-advanced"]')!;
    await act(async () => {
      advBtn.click();
    });
    const numberInputs = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    const [tempInput, maxTokensInput, timeoutInput] = numberInputs;
    expect(tempInput?.min).toBe('0');
    expect(tempInput?.max).toBe('2');
    expect(tempInput?.step).toBe('0.01');
    for (const val of ['0.3', '0.25']) {
      await act(async () => setInputValue(tempInput!, val));
      expect(tempInput!.validity.stepMismatch).toBe(false);
      expect(tempInput!.checkValidity()).toBe(true);
    }

    expect(maxTokensInput?.value).toBe('4096');
    expect(maxTokensInput?.min).toBe('64');
    expect(maxTokensInput?.max).toBe('65536');
    expect(maxTokensInput?.step).toBe('1');
    for (const val of ['4096', '4000', '8192', '65536']) {
      await act(async () => setInputValue(maxTokensInput!, val));
      expect(maxTokensInput!.validity.stepMismatch).toBe(false);
      expect(maxTokensInput!.checkValidity()).toBe(true);
    }

    expect(timeoutInput?.min).toBe('5');
    expect(timeoutInput?.max).toBe('180');
    expect(timeoutInput?.step).toBe('1');
    for (const val of ['45', '12']) {
      await act(async () => setInputValue(timeoutInput!, val));
      expect(timeoutInput!.validity.stepMismatch).toBe(false);
      expect(timeoutInput!.checkValidity()).toBe(true);
    }

    // Re-render under logged-in cloud account scope
    await act(async () => {
      root!.render(
        <PracticeScopeContext.Provider value={accountPracticeScope('user-123')}>
          <ApiSettingsModal open onClose={() => {}} />
        </PracticeScopeContext.Provider>,
      );
    });
    expect(document.body.querySelector('[data-testid="api-privacy-desc"]')?.textContent).toContain('加密同步');
  });

  it('auto-fetches on key blur, replaces presets completely, filters non-chat models, supports search & show-all toggle, and caches public models', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'live-pro-model', name: 'Live Pro', context_window: 1000000, max_output_tokens: 8192 },
            { id: 'live-mini-model', display_name: 'Live Mini', context_window: 131072 },
            { id: 'text-embedding-3-large' },
            { id: 'whisper-1' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    await renderModal(LEGACY_GUEST_SCOPE);
    const keyInput = document.body.querySelector<HTMLInputElement>('[data-testid="api-input-key"]')!;
    await act(async () => {
      keyInput.focus();
      setInputValue(keyInput, 'sk-live-auto-123456');
      keyInput.blur();
      await flushMicrotasks();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://api.deepseek.com/v1/models');
    expect((calledInit.headers as Record<string, string>).Authorization).toBe('Bearer sk-live-auto-123456');

    // Stale preset default (deepseek-flash) was auto-switched to first real chat model
    const modelInput = document.body.querySelector<HTMLInputElement>('[data-testid="api-input-model"]')!;
    expect(modelInput.value).toBe('live-mini-model');

    // Public cache saved without API key
    const cached = loadCachedProviderModels('deepseek', 'https://api.deepseek.com/v1');
    expect(cached).toHaveLength(4);
    expect(localStorage.getItem(API_MODELS_CACHE_KEY)).not.toContain('sk-live-auto-123456');

    // Open dropdown: static presets replaced, non-chat models hidden by default
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="api-model-dropdown-toggle"]')!.click();
    });
    expect(document.body.querySelector('[data-testid="api-model-option-deepseek-flash"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="api-model-option-live-pro-model"]')?.textContent).toContain('Live Pro');
    expect(document.body.querySelector('[data-testid="api-model-option-live-pro-model"]')?.textContent).toContain('1M');
    expect(document.body.querySelector('[data-testid="api-model-option-text-embedding-3-large"]')).toBeNull();

    // Toggle "显示全部模型" reveals filtered non-chat models
    const showAll = document.body.querySelector<HTMLInputElement>('[data-testid="api-show-all-models"]')!;
    await act(async () => {
      showAll.click();
    });
    expect(document.body.querySelector('[data-testid="api-model-option-text-embedding-3-large"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="api-model-option-whisper-1"]')).not.toBeNull();

    // Search filters visible list
    const searchInput = document.body.querySelector<HTMLInputElement>('[data-testid="api-model-search"]')!;
    await act(async () => {
      setInputValue(searchInput, 'pro');
    });
    expect(document.body.querySelector('[data-testid="api-model-option-live-pro-model"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="api-model-option-live-mini-model"]')).toBeNull();

    // Selecting option writes real id to model input
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="api-model-option-live-pro-model"]')!.click();
    });
    expect(modelInput.value).toBe('live-pro-model');

    // Manually typing an unlisted model shows stale warning + 1-click switch
    await act(async () => {
      setInputValue(modelInput, 'retired-old-model');
    });
    expect(document.body.querySelector('[data-testid="api-model-stale-warning"]')).not.toBeNull();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="api-model-use-first"]')!.click();
    });
    expect(modelInput.value).toBe('live-mini-model');
  });

  it('degrades to fallback presets with readable message when /models returns 401 or 404', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', mockFetch);

    await renderModal(LEGACY_GUEST_SCOPE);
    const keyInput = document.body.querySelector<HTMLInputElement>('[data-testid="api-input-key"]')!;
    await act(async () => {
      setInputValue(keyInput, 'sk-invalid-key');
    });
    const fetchBtn = document.body.querySelector<HTMLButtonElement>('[data-testid="api-fetch-models"]')!;
    await act(async () => {
      fetchBtn.click();
      await flushMicrotasks();
    });

    const errBanner = document.body.querySelector('[data-testid="api-model-fetch-error"]')!;
    expect(errBanner.textContent).toContain('HTTP 401');
    // Fallback preset remains selectable
    expect(document.body.querySelector('[data-testid="api-model-option-deepseek-flash"]')).not.toBeNull();
  });

  it('auto-fetches after 600ms debounce when typing API key without blurring', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: 'debounced-chat-model', name: 'Debounced Chat', context_window: 65536 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    await renderModal(LEGACY_GUEST_SCOPE);
    const keyInput = document.body.querySelector<HTMLInputElement>('[data-testid="api-input-key"]')!;
    await act(async () => {
      setInputValue(keyInput, 'sk-debounced-9999');
    });
    expect(mockFetch).toHaveBeenCalledTimes(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
      await flushMicrotasks();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const modelInput = document.body.querySelector<HTMLInputElement>('[data-testid="api-input-model"]')!;
    expect(modelInput.value).toBe('debounced-chat-model');
  });
});
