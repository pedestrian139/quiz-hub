import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { usePracticeScope } from '../../hooks/practiceScope';
import {
  API_PROVIDER_PRESETS,
  clearApiConfig,
  fetchAvailableModels,
  getProviderPreset,
  isLocalEndpoint,
  isValidHttpUrl,
  loadApiConfig,
  LlmApiError,
  normalizeBaseUrl,
  saveApiConfig,
  testApiConnection,
  type ApiConfig,
  type ApiConnectionTestResult,
  type ApiProviderId,
} from '../../services';
import './ApiSettings.css';

export interface ApiSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (config: ApiConfig) => void;
}

export function ApiSettingsModal({ open, onClose, onSaved }: ApiSettingsModalProps) {
  const scope = usePracticeScope();
  const [draft, setDraft] = useState<ApiConfig>(() => loadApiConfig(scope));
  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ApiConnectionTestResult | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(loadApiConfig(scope));
    setShowKey(false);
    setShowAdvanced(false);
    setTestResult(null);
    setRemoteModels([]);
    setNotice(null);
  }, [open, scope]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        abortRef.current?.abort();
        onClose();
        return;
      }
      // Prevent global quiz shortcuts underneath the modal from firing while dialog is open
      const target = e.target as HTMLElement | null;
      if (!target || !target.closest('input, textarea, select')) {
        if (
          ['ArrowLeft', 'ArrowRight', ' ', 't', 'T', 'f', 'F'].includes(e.key) ||
          /^[1-9a-iA-I]$/.test(e.key)
        ) {
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => window.removeEventListener('keydown', onKeyDownCapture, true);
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  const preset = getProviderPreset(draft.provider);
  const suggestedModels = remoteModels.length > 0 ? remoteModels.slice(0, 12) : preset.models;

  const handleSelectProvider = (providerId: ApiProviderId) => {
    const nextPreset = getProviderPreset(providerId);
    setDraft((prev) => ({
      ...prev,
      provider: providerId,
      baseUrl: providerId === 'custom' ? prev.baseUrl : nextPreset.baseUrl,
      model: providerId === 'custom' ? prev.model : nextPreset.defaultModel,
    }));
    setTestResult(null);
    setRemoteModels([]);
    setNotice(null);
  };

  const handleFetchModels = async () => {
    if (!isValidHttpUrl(draft.baseUrl)) {
      setNotice({ tone: 'bad', text: '请先填写有效的 API Base URL（以 http:// 或 https:// 开头）。' });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingModels(true);
    setNotice(null);
    try {
      const list = await fetchAvailableModels(draft, controller.signal, scope);
      setRemoteModels(list);
      if (list.length === 0) {
        setNotice({ tone: 'info', text: '接口返回了空的模型列表，你可以直接手动输入模型名称。' });
      } else {
        setNotice({ tone: 'ok', text: `已拉取 ${list.length} 个可用模型，点击下方标签即可选用。` });
        if (!draft.model.trim() && list[0]) {
          setDraft((prev) => ({ ...prev, model: list[0] }));
        }
      }
    } catch (err) {
      if (err instanceof LlmApiError && err.code === 'ABORTED') return;
      const msg = err instanceof LlmApiError ? err.userMessage : '拉取模型列表失败，请手动输入模型名。';
      setNotice({ tone: 'bad', text: msg });
    } finally {
      setLoadingModels(false);
    }
  };

  const handleTest = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setTesting(true);
    setTestResult(null);
    setNotice(null);
    try {
      const res = await testApiConnection(draft, controller.signal, scope);
      setTestResult(res);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    const normalizedUrl = normalizeBaseUrl(draft.baseUrl);
    if (!isValidHttpUrl(normalizedUrl)) {
      setNotice({ tone: 'bad', text: 'API Base URL 格式无效，请填写以 http:// 或 https:// 开头的地址。' });
      return;
    }
    if (!draft.model.trim()) {
      setNotice({ tone: 'bad', text: '请填写模型名称（如 deepseek-chat、glm-4-flash 或 gpt-4o-mini）。' });
      return;
    }
    if (!draft.apiKey.trim() && !isLocalEndpoint(normalizedUrl)) {
      setNotice({
        tone: 'bad',
        text: '请填写 API Key（仅连接 localhost / 127.0.0.1 本地模型时可留空）。',
      });
      return;
    }

    const toSave: ApiConfig = {
      ...draft,
      baseUrl: normalizedUrl,
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
    };

    const ok = saveApiConfig(toSave, scope);
    if (!ok) {
      setNotice({
        tone: 'bad',
        text: '浏览器禁止写入本地存储（如隐私模式或空间已满），本次配置仅在当前内存生效。',
      });
      return;
    }

    onSaved?.(toSave);
    onClose();
  };

  const handleClear = () => {
    abortRef.current?.abort();
    const cleared = clearApiConfig(scope);
    setDraft(cleared);
    setTestResult(null);
    setRemoteModels([]);
    setNotice({ tone: 'info', text: '已清除本地保存的 API Key 与自定义配置。' });
  };

  return createPortal(
    <div
      className="api-modal-backdrop"
      data-testid="api-settings-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          abortRef.current?.abort();
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-settings-title"
        data-testid="api-settings-modal"
        className="api-modal"
      >
        <div className="api-modal__header">
          <div className="api-modal__title-wrap">
            <h2 id="api-settings-title" className="api-modal__title">
              大模型 API 设置
            </h2>
            <p className="api-modal__sub">
              采用通用 OpenAI 兼容协议。密钥仅保存在你的浏览器本地，请求直接发往所填端点，不经过第三方服务器。
            </p>
          </div>
          <button
            type="button"
            className="api-modal__close"
            data-testid="api-settings-close"
            aria-label="关闭 API 设置"
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form className="api-modal__form" onSubmit={handleSave}>
          <div className="api-modal__body">
            <div className="api-field">
              <span className="api-field__label">服务商预设</span>
              <div className="api-preset-grid" role="group" aria-label="选择 API 服务商预设">
                {API_PROVIDER_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`api-preset-${item.id}`}
                    aria-pressed={draft.provider === item.id ? 'true' : 'false'}
                    className={`api-preset-chip${draft.provider === item.id ? ' is-active' : ''}`}
                    onClick={() => handleSelectProvider(item.id)}
                  >
                    {item.shortName}
                  </button>
                ))}
              </div>
              <span className="api-field__hint">{preset.hint}</span>
            </div>

            <div className="api-field">
              <label className="api-field__label" htmlFor="api-base-url">
                API Base URL
              </label>
              <input
                id="api-base-url"
                data-testid="api-input-baseurl"
                type="url"
                className="api-input api-input--mono"
                placeholder="https://api.deepseek.com/v1"
                value={draft.baseUrl}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, baseUrl: e.target.value }));
                  setTestResult(null);
                }}
              />
              <span className="api-field__hint">
                无需包含 <code>/chat/completions</code> 后缀，系统会自动规范拼接。
              </span>
            </div>

            <div className="api-field">
              <label className="api-field__label" htmlFor="api-key-input">
                API Key
              </label>
              <div className="api-input-row">
                <input
                  id="api-key-input"
                  data-testid="api-input-key"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  className="api-input api-input--mono"
                  placeholder={preset.keyPlaceholder}
                  value={draft.apiKey}
                  onChange={(e) => {
                    setDraft((prev) => ({ ...prev, apiKey: e.target.value }));
                    setTestResult(null);
                  }}
                />
                <button
                  type="button"
                  className="api-btn-inline"
                  data-testid="api-toggle-key-visibility"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>
            </div>

            <div className="api-field">
              <div className="api-field__head">
                <label className="api-field__label" htmlFor="api-model-input">
                  模型名称（Model ID）
                </label>
                <button
                  type="button"
                  className="api-tutor-link"
                  data-testid="api-fetch-models"
                  disabled={loadingModels}
                  onClick={handleFetchModels}
                >
                  {loadingModels ? '正在拉取模型...' : '从接口拉取模型列表'}
                </button>
              </div>
              <input
                id="api-model-input"
                data-testid="api-input-model"
                type="text"
                className="api-input api-input--mono"
                placeholder="例如：deepseek-chat / glm-4-flash / gpt-4o-mini"
                value={draft.model}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, model: e.target.value }));
                  setTestResult(null);
                }}
              />
              {suggestedModels.length > 0 && (
                <div className="api-model-chips" aria-label="快捷选用模型">
                  {suggestedModels.map((modelId) => (
                    <button
                      key={modelId}
                      type="button"
                      className={`api-model-chip${draft.model === modelId ? ' is-active' : ''}`}
                      onClick={() => setDraft((prev) => ({ ...prev, model: modelId }))}
                    >
                      {modelId}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="api-advanced">
              <button
                type="button"
                className="api-advanced__summary"
                data-testid="api-toggle-advanced"
                aria-expanded={showAdvanced ? 'true' : 'false'}
                onClick={() => setShowAdvanced((v) => !v)}
              >
                <span>高级参数与密钥存储方式</span>
                <span>{showAdvanced ? '收起' : '展开'}</span>
              </button>
              {showAdvanced && (
                <>
                  <div className="api-advanced__grid">
                    <label className="api-field">
                      <span className="api-field__label">温度 (Temperature)</span>
                      <input
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        className="api-input"
                        value={draft.temperature}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            temperature: Number.isFinite(Number(e.target.value))
                              ? Number(e.target.value)
                              : 0.3,
                          }))
                        }
                      />
                    </label>
                    <label className="api-field">
                      <span className="api-field__label">最大输出 Tokens</span>
                      <input
                        type="number"
                        min={128}
                        max={16384}
                        step={100}
                        className="api-input"
                        value={draft.maxTokens}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            maxTokens: Number.isFinite(Number(e.target.value))
                              ? Number(e.target.value)
                              : 1200,
                          }))
                        }
                      />
                    </label>
                    <label className="api-field">
                      <span className="api-field__label">超时时间（秒）</span>
                      <input
                        type="number"
                        min={5}
                        max={180}
                        step={5}
                        className="api-input"
                        value={Math.round(draft.timeoutMs / 1000)}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            timeoutMs: Math.max(5, Number(e.target.value) || 45) * 1000,
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div className="api-scope-row" role="radiogroup" aria-label="API 密钥保存范围">
                    <label className="api-radio-label">
                      <input
                        type="radio"
                        name="api-storage-scope"
                        checked={draft.storageScope === 'local'}
                        onChange={() => setDraft((prev) => ({ ...prev, storageScope: 'local' }))}
                      />
                      持久化到本机浏览器（localStorage）
                    </label>
                    <label className="api-radio-label">
                      <input
                        type="radio"
                        name="api-storage-scope"
                        checked={draft.storageScope === 'session'}
                        onChange={() => setDraft((prev) => ({ ...prev, storageScope: 'session' }))}
                      />
                      仅当前标签页有效（关闭即清除）
                    </label>
                  </div>
                </>
              )}
            </div>

            {testResult && (
              <div
                data-testid="api-test-result"
                role="status"
                className={`api-banner ${testResult.ok ? 'api-banner--ok' : 'api-banner--bad'}`}
              >
                <div>{testResult.message}</div>
                {!testResult.ok && testResult.statusCode === undefined && (
                  <div style={{ marginTop: 4, fontSize: 12 }}>
                    排查建议：请确认所选服务商支持浏览器前端直接请求（如 DeepSeek、硅基流动、智谱或开启了 CORS 的中转接口）。
                  </div>
                )}
              </div>
            )}

            {notice && (
              <div
                data-testid="api-settings-notice"
                role="status"
                className={`api-banner api-banner--${notice.tone}`}
              >
                {notice.text}
              </div>
            )}
          </div>

          <div className="api-modal__footer">
            <button
              type="button"
              className="btn btn--ghost"
              data-testid="api-btn-clear"
              onClick={handleClear}
            >
              清除配置
            </button>

            <div className="api-modal__footer-group">
              <button
                type="button"
                className="btn btn--ghost"
                data-testid="api-btn-test"
                disabled={testing}
                onClick={handleTest}
              >
                {testing ? '测试中...' : '测试连接'}
              </button>
              <button type="submit" className="btn btn--primary" data-testid="api-btn-save">
                保存配置
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
