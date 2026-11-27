import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { isAccountPracticeScope } from '../../core/practiceScope';
import { usePracticeScope } from '../../hooks/practiceScope';
import {
  API_PROVIDER_PRESETS,
  clearApiConfig,
  createDefaultApiConfig,
  fetchAvailableModelInfos,
  formatContextWindow,
  getCloudMemoryApiConfig,
  getPresetModelMetas,
  getProviderPreset,
  hasSessionApiConfig,
  isApiConfigReady,
  isLocalEndpoint,
  isNonChatModel,
  isValidHttpUrl,
  loadApiConfig,
  loadCachedProviderModels,
  LlmApiError,
  normalizeBaseUrl,
  saveApiConfig,
  saveCachedProviderModels,
  subscribeApiConfig,
  testApiConnection,
  type ApiConfig,
  type ApiConnectionTestResult,
  type ApiProviderId,
  type ModelInfo,
} from '../../services';
import { clearAccountCloudApiConfig, saveAccountCloudApiConfig } from '../../services/cloudSync';
import { Icon } from '../ui/Icons';
import './ApiSettings.css';

export interface ApiSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (config: ApiConfig) => void;
}

const BLUR_SKIP_TESTIDS = new Set([
  'api-btn-save',
  'api-btn-clear',
  'api-settings-close',
  'api-fetch-models',
  'api-btn-test',
  'api-toggle-key-visibility',
]);

export function ApiSettingsModal({ open, onClose, onSaved }: ApiSettingsModalProps) {
  const scope = usePracticeScope();
  const isCloudAccount = isAccountPracticeScope(scope);
  const [draft, replaceDraft] = useState<ApiConfig>(() => loadApiConfig(scope));
  const draftRef = useRef<ApiConfig>(draft);
  draftRef.current = draft;
  const draftEdited = useRef(false);
  const apiKeyEditedRef = useRef(false);
  const modelManuallyEditedRef = useRef(false);
  const lastAutoFetchSigRef = useRef('');
  const autoFetchTimerRef = useRef<number | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [testResult, setTestResult] = useState<ApiConnectionTestResult | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [remoteModels, setRemoteModels] = useState<ModelInfo[]>([]);
  const [modelSource, setModelSource] = useState<'remote' | 'cache' | 'preset'>('preset');
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const [showAllModels, setShowAllModels] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);

  const busy = saving || clearing;
  const abortRef = useRef<AbortController | null>(null);

  const clearAutoFetchTimer = useCallback(() => {
    if (autoFetchTimerRef.current !== null) {
      window.clearTimeout(autoFetchTimerRef.current);
      autoFetchTimerRef.current = null;
    }
  }, []);

  function setDraft(update: (current: ApiConfig) => ApiConfig): void {
    draftEdited.current = true;
    replaceDraft((prev) => {
      const next = update(prev);
      draftRef.current = next;
      return next;
    });
  }

  const hydrateModelsFromCache = useCallback((provider: ApiProviderId, baseUrl: string): ModelInfo[] => {
    const cached = loadCachedProviderModels(provider, baseUrl);
    if (cached.length > 0) {
      setRemoteModels(cached);
      setModelSource('cache');
    } else {
      setRemoteModels([]);
      setModelSource('preset');
    }
    return cached;
  }, []);

  useEffect(() => {
    if (!open) return;
    clearAutoFetchTimer();
    draftEdited.current = false;
    apiKeyEditedRef.current = false;
    modelManuallyEditedRef.current = false;
    lastAutoFetchSigRef.current = '';
    const initial = loadApiConfig(scope);
    draftRef.current = initial;
    replaceDraft(initial);
    hydrateModelsFromCache(initial.provider, initial.baseUrl);
    setShowKey(false);
    setShowAdvanced(false);
    setSaving(false);
    setClearing(false);
    setTestResult(null);
    setModelFetchError(null);
    setShowAllModels(false);
    setDropdownOpen(false);
    setModelSearch('');
    setNotice(null);
    if (isCloudAccount) return subscribeApiConfig((config) => {
      if (!draftEdited.current) {
        draftRef.current = config;
        replaceDraft(config);
        hydrateModelsFromCache(config.provider, config.baseUrl);
      }
    }, scope);
  }, [clearAutoFetchTimer, hydrateModelsFromCache, isCloudAccount, open, scope]);

  useEffect(() => {
    return () => {
      clearAutoFetchTimer();
      abortRef.current?.abort();
    };
  }, [clearAutoFetchTimer]);

  useEffect(() => {
    if (!open) return;

    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
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
  }, [busy, onClose, open]);

  const preset = getProviderPreset(draft.provider);
  const presetModels = useMemo(() => getPresetModelMetas(preset), [preset]);
  const usingDynamicModels = remoteModels.length > 0;
  const activeCatalog = usingDynamicModels ? remoteModels : presetModels;

  const nonChatCount = useMemo(
    () => (usingDynamicModels ? activeCatalog.filter((m) => isNonChatModel(m)).length : 0),
    [activeCatalog, usingDynamicModels],
  );

  const chatFilteredModels = useMemo(() => {
    if (!usingDynamicModels || showAllModels) return activeCatalog;
    const onlyChat = activeCatalog.filter((m) => !isNonChatModel(m));
    return onlyChat.length > 0 ? onlyChat : activeCatalog;
  }, [activeCatalog, showAllModels, usingDynamicModels]);

  const effectiveSearchQuery = useMemo(() => {
    const manualSearch = modelSearch.trim().toLowerCase();
    if (manualSearch) return manualSearch;
    const typedModel = draft.model.trim();
    if (!typedModel) return '';
    const exactMatch = activeCatalog.some((m) => m.id === typedModel);
    return exactMatch ? '' : typedModel.toLowerCase();
  }, [activeCatalog, draft.model, modelSearch]);

  const filteredModels = useMemo(() => {
    if (!effectiveSearchQuery) return chatFilteredModels;
    return chatFilteredModels.filter((m) => {
      const idMatch = m.id.toLowerCase().includes(effectiveSearchQuery);
      const nameMatch = m.name ? m.name.toLowerCase().includes(effectiveSearchQuery) : false;
      return idMatch || nameMatch;
    });
  }, [chatFilteredModels, effectiveSearchQuery]);

  const recommendedFirstModel = chatFilteredModels[0]?.id ?? activeCatalog[0]?.id ?? '';
  const isCurrentModelStale =
    usingDynamicModels &&
    draft.model.trim().length > 0 &&
    !remoteModels.some((m) => m.id === draft.model.trim());

  if (!open || typeof document === 'undefined') {
    return null;
  }

  const performFetchModels = async (trigger: 'manual' | 'auto', targetDraft: ApiConfig) => {
    clearAutoFetchTimer();
    const normalizedUrl = normalizeBaseUrl(targetDraft.baseUrl);
    if (!isValidHttpUrl(normalizedUrl)) {
      if (trigger === 'manual') {
        setNotice({ tone: 'bad', text: '请先填写有效的 API Base URL（以 http:// 或 https:// 开头）。' });
      }
      return;
    }

    const trimmedKey = targetDraft.apiKey.trim();
    if (trigger === 'auto' && !trimmedKey && !isLocalEndpoint(normalizedUrl)) {
      return;
    }

    const sig = `${targetDraft.provider}::${normalizedUrl}::${trimmedKey}`;
    if (trigger === 'auto' && lastAutoFetchSigRef.current === sig) {
      return;
    }
    lastAutoFetchSigRef.current = sig;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingModels(true);
    setModelFetchError(null);
    if (trigger === 'manual') {
      setNotice(null);
    }

    try {
      const list = await fetchAvailableModelInfos(
        { ...targetDraft, baseUrl: normalizedUrl, apiKey: trimmedKey },
        controller.signal,
        scope,
      );
      if (controller.signal.aborted) return;

      setRemoteModels(list);
      setModelSource(list.length > 0 ? 'remote' : 'preset');
      setShowAllModels(false);
      setModelSearch('');

      if (list.length === 0) {
        const emptyMsg = '接口返回了空的模型列表，已回退至兜底预设，也可直接手动输入模型 ID。';
        setModelFetchError(emptyMsg);
        if (trigger === 'manual') {
          setNotice({ tone: 'info', text: emptyMsg });
          setDropdownOpen(true);
        }
        return;
      }

      saveCachedProviderModels(targetDraft.provider, normalizedUrl, list);
      const chatOnly = list.filter((m) => !isNonChatModel(m));
      const preferredFirst = chatOnly[0]?.id ?? list[0]!.id;
      const currentModel = draftRef.current.model.trim();
      const existsInRemote = currentModel.length > 0 && list.some((m) => m.id === currentModel);

      let autoSwitchNote = '';
      if (!currentModel) {
        setDraft((prev) => ({ ...prev, model: preferredFirst }));
      } else if (!existsInRemote && !modelManuallyEditedRef.current) {
        setDraft((prev) => ({ ...prev, model: preferredFirst }));
        autoSwitchNote = `（原模型 ${currentModel} 不在最新列表中，已自动切换为 ${preferredFirst}）`;
      }

      const hiddenCount = list.length - chatOnly.length;
      const filterSuffix =
        hiddenCount > 0 && chatOnly.length > 0
          ? `（已过滤 ${hiddenCount} 个非对话模型，可在下拉框切换显示全部）`
          : '';
      setNotice({
        tone: 'ok',
        text: `已拉取 ${list.length} 个可用模型${filterSuffix}${autoSwitchNote}`,
      });
      if (trigger === 'manual') {
        setDropdownOpen(true);
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof LlmApiError && err.code === 'ABORTED')) {
        return;
      }
      const msg =
        err instanceof LlmApiError
          ? err.userMessage
          : '拉取模型列表失败，已降级为兜底预设，也可手动输入模型 ID。';
      setModelFetchError(msg);
      if (trigger === 'manual') {
        setNotice({ tone: 'bad', text: msg });
        setDropdownOpen(true);
      }
    } finally {
      if (abortRef.current === controller) {
        setLoadingModels(false);
      }
    }
  };

  const handleSelectProvider = (providerId: ApiProviderId) => {
    clearAutoFetchTimer();
    abortRef.current?.abort();
    const nextPreset = getProviderPreset(providerId);
    const nextBaseUrl = providerId === 'custom' ? draftRef.current.baseUrl : nextPreset.baseUrl;
    const cached = hydrateModelsFromCache(providerId, nextBaseUrl);
    const firstCachedChat = cached.find((m) => !isNonChatModel(m))?.id ?? cached[0]?.id;

    modelManuallyEditedRef.current = false;
    lastAutoFetchSigRef.current = '';
    setDraft((prev) => ({
      ...prev,
      provider: providerId,
      baseUrl: providerId === 'custom' ? prev.baseUrl : nextPreset.baseUrl,
      model:
        providerId === 'custom'
          ? prev.model
          : (firstCachedChat ?? nextPreset.defaultModel),
    }));
    setTestResult(null);
    setModelFetchError(null);
    setShowAllModels(false);
    setModelSearch('');
    setNotice(null);
  };

  const handleFetchModels = () => {
    void performFetchModels('manual', draftRef.current);
  };

  const handleApiKeyChange = (nextKey: string) => {
    apiKeyEditedRef.current = true;
    const nextDraft: ApiConfig = { ...draftRef.current, apiKey: nextKey };
    setDraft(() => nextDraft);
    setTestResult(null);
    setModelFetchError(null);
    clearAutoFetchTimer();

    if (isValidHttpUrl(nextDraft.baseUrl) && nextKey.trim().length > 0) {
      autoFetchTimerRef.current = window.setTimeout(() => {
        autoFetchTimerRef.current = null;
        void performFetchModels('auto', draftRef.current);
      }, 600);
    }
  };

  const handleApiKeyBlur = (e: FocusEvent<HTMLInputElement>) => {
    const nextTarget = e.relatedTarget as HTMLElement | null;
    const targetTestId = nextTarget?.getAttribute('data-testid');
    if (targetTestId && BLUR_SKIP_TESTIDS.has(targetTestId)) {
      return;
    }
    const current = draftRef.current;
    if (apiKeyEditedRef.current && isValidHttpUrl(current.baseUrl) && current.apiKey.trim().length > 0) {
      clearAutoFetchTimer();
      void performFetchModels('auto', current);
    }
  };

  const handleTest = async () => {
    clearAutoFetchTimer();
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

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    clearAutoFetchTimer();
    abortRef.current?.abort();
    const normalizedUrl = normalizeBaseUrl(draft.baseUrl);
    if (!isValidHttpUrl(normalizedUrl)) {
      setNotice({ tone: 'bad', text: 'API Base URL 格式无效，请填写以 http:// 或 https:// 开头的地址。' });
      return;
    }
    if (!draft.model.trim()) {
      setNotice({ tone: 'bad', text: '请填写模型名称（如 deepseek-flash、glm-4-flash 或 gpt-4o-mini）。' });
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

    if (isAccountPracticeScope(scope) && toSave.storageScope !== 'session') {
      setSaving(true);
      setNotice(null);
      try {
        await saveAccountCloudApiConfig(scope, toSave);
        onSaved?.({ ...toSave, storageScope: 'local' });
        onClose();
      } catch (error) {
        setNotice({
          tone: 'bad',
          text: error instanceof Error ? `云端保存 API 配置失败。${error.message}` : '云端保存 API 配置失败，请稍后重试。',
        });
      } finally {
        setSaving(false);
      }
      return;
    }

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

  const handleClear = async () => {
    if (busy) return;
    clearAutoFetchTimer();
    abortRef.current?.abort();
    apiKeyEditedRef.current = false;
    modelManuallyEditedRef.current = false;
    lastAutoFetchSigRef.current = '';

    if (isAccountPracticeScope(scope)) {
      setClearing(true);
      setNotice(null);
      try {
        await clearAccountCloudApiConfig(scope);
        draftEdited.current = false;
        const fresh = createDefaultApiConfig();
        draftRef.current = fresh;
        replaceDraft(fresh);
        hydrateModelsFromCache(fresh.provider, fresh.baseUrl);
        setTestResult(null);
        setModelFetchError(null);
        setShowAllModels(false);
        setModelSearch('');
        setNotice({ tone: 'info', text: '已清除云端及当前页面的 API Key 与自定义配置。' });
      } catch (error) {
        setNotice({ tone: 'bad', text: error instanceof Error ? `清除云端 API 配置失败。${error.message}` : '清除云端 API 配置失败，请稍后重试。' });
      } finally {
        setClearing(false);
      }
      return;
    }

    const cleared = clearApiConfig(scope);
    draftEdited.current = false;
    draftRef.current = cleared;
    replaceDraft(cleared);
    hydrateModelsFromCache(cleared.provider, cleared.baseUrl);
    setTestResult(null);
    setModelFetchError(null);
    setShowAllModels(false);
    setModelSearch('');
    setNotice({ tone: 'info', text: '已清除本地保存的 API Key 与自定义配置。' });
  };

  const sessionOnlyActive = hasSessionApiConfig(scope);
  const cloudMemoryActive = getCloudMemoryApiConfig(scope) !== null;
  const cloudStatusText = sessionOnlyActive
    ? '当前存储方式：仅当前标签页有效（只存 sessionStorage，未上传云端）'
    : cloudMemoryActive
      ? '当前存储方式：已加密同步至云端（明文仅保留在当前页面内存）'
      : isApiConfigReady(loadApiConfig(scope)) ? '检测到旧版浏览器配置，保存后可同步至云端。'
        : '当前存储方式：未配置（保存后默认加密同步至云端）';

  return createPortal(
    <div
      className="api-modal-backdrop"
      data-testid="api-settings-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) {
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
            <p className="api-modal__sub" data-testid="api-privacy-desc">
              {isCloudAccount
                ? '采用通用 OpenAI 兼容协议。当前为登录账号：密钥默认经 AES-256-GCM 加密同步至云端（明文仅留存于页面内存，不写入 localStorage），游客模式仅存本地浏览器。'
                : '采用通用 OpenAI 兼容协议。游客模式下密钥仅保存在本地浏览器，请求直连所填端点；登录账号后将默认加密同步上云以支持跨设备使用。'}
            </p>
          </div>
          <button
            type="button"
            className="api-modal__close"
            data-testid="api-settings-close"
            aria-label="关闭 API 设置"
            disabled={busy}
            onClick={() => {
              clearAutoFetchTimer();
              abortRef.current?.abort();
              onClose();
            }}
          >
            <Icon name="x" size={18} />
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
                  const nextUrl = e.target.value;
                  setDraft((prev) => ({ ...prev, baseUrl: nextUrl }));
                  hydrateModelsFromCache(draftRef.current.provider, nextUrl);
                  lastAutoFetchSigRef.current = '';
                  setModelFetchError(null);
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
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  onBlur={handleApiKeyBlur}
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
              <span className="api-field__hint">
                输入或粘贴 Key 后将自动尝试从 <code>/models</code> 拉取该账号实时可用模型列表。
              </span>
            </div>

            <div className="api-field">
              <div className="api-field__head">
                <label className="api-field__label" htmlFor="api-model-input">
                  模型名称（Model ID）
                </label>
                <button
                  type="button"
                  className={`api-fetch-btn${loadingModels ? ' is-loading' : ''}`}
                  data-testid="api-fetch-models"
                  disabled={loadingModels}
                  onClick={handleFetchModels}
                >
                  <Icon
                    name="refreshCw"
                    size={14}
                    className={`api-fetch-btn__icon${loadingModels ? ' is-spinning' : ''}`}
                  />
                  <span>{loadingModels ? '拉取模型中…' : '刷新模型列表'}</span>
                </button>
              </div>

              <div className="api-combobox">
                <div className="api-input-row">
                  <input
                    id="api-model-input"
                    data-testid="api-input-model"
                    role="combobox"
                    aria-expanded={dropdownOpen ? 'true' : 'false'}
                    aria-controls="api-model-listbox"
                    aria-autocomplete="list"
                    type="text"
                    className={`api-input api-input--mono${isCurrentModelStale ? ' api-input--warn' : ''}`}
                    placeholder="可直接输入任意 Model ID，或展开下方列表搜索选择"
                    value={draft.model}
                    onFocus={() => setDropdownOpen(true)}
                    onChange={(e) => {
                      modelManuallyEditedRef.current = true;
                      setDraft((prev) => ({ ...prev, model: e.target.value }));
                      setTestResult(null);
                      if (!dropdownOpen) setDropdownOpen(true);
                    }}
                  />
                  <button
                    type="button"
                    className="api-btn-inline api-combobox__toggle"
                    data-testid="api-model-dropdown-toggle"
                    aria-label={dropdownOpen ? '收起模型列表' : '展开模型列表'}
                    aria-expanded={dropdownOpen ? 'true' : 'false'}
                    onClick={() => setDropdownOpen((v) => !v)}
                  >
                    <span>{dropdownOpen ? '收起' : `选择 (${chatFilteredModels.length})`}</span>
                  </button>
                </div>

                {isCurrentModelStale && recommendedFirstModel && (
                  <div className="api-model-stale" data-testid="api-model-stale-warning" role="status">
                    <span>
                      当前模型 <code>{draft.model.trim()}</code> 不在最新拉取列表中，可能已停用。
                    </span>
                    <button
                      type="button"
                      className="api-model-stale__btn"
                      data-testid="api-model-use-first"
                      onClick={() => {
                        modelManuallyEditedRef.current = true;
                        setDraft((prev) => ({ ...prev, model: recommendedFirstModel }));
                      }}
                    >
                      切换为 {recommendedFirstModel}
                    </button>
                  </div>
                )}

                {modelFetchError && (
                  <div className="api-model-error" data-testid="api-model-fetch-error" role="status">
                    {modelFetchError}
                  </div>
                )}

                {dropdownOpen && (
                  <div className="api-model-panel" data-testid="api-model-panel">
                    <div className="api-model-panel__toolbar">
                      <input
                        type="search"
                        data-testid="api-model-search"
                        className="api-input api-model-panel__search"
                        placeholder="关键词搜索模型名称或 ID…"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                      />
                      <div className="api-model-panel__meta">
                        <span className="api-model-source-badge" data-testid="api-model-source">
                          {modelSource === 'remote'
                            ? `接口实时列表 · ${chatFilteredModels.length}`
                            : modelSource === 'cache'
                              ? `本地缓存列表 · ${chatFilteredModels.length}`
                              : `兜底预设 · ${chatFilteredModels.length}`}
                        </span>
                        {nonChatCount > 0 && (
                          <label className="api-model-filter-toggle">
                            <input
                              type="checkbox"
                              data-testid="api-show-all-models"
                              checked={showAllModels}
                              onChange={(e) => setShowAllModels(e.target.checked)}
                            />
                            <span>显示全部模型 (+{nonChatCount})</span>
                          </label>
                        )}
                      </div>
                    </div>

                    <div
                      id="api-model-listbox"
                      className="api-model-listbox"
                      data-testid="api-model-listbox"
                      aria-label="可选模型列表"
                    >
                      {filteredModels.length > 0 ? (
                        filteredModels.map((item) => {
                          const selected = draft.model.trim() === item.id;
                          const ctxLabel = formatContextWindow(item.contextWindow);
                          const nonChat = usingDynamicModels && isNonChatModel(item);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-testid={`api-model-option-${item.id}`}
                              aria-pressed={selected ? 'true' : 'false'}
                              className={`api-model-option${selected ? ' is-active' : ''}`}
                              onClick={() => {
                                modelManuallyEditedRef.current = true;
                                setDraft((prev) => ({ ...prev, model: item.id }));
                                setModelSearch('');
                                setDropdownOpen(false);
                                setTestResult(null);
                              }}
                            >
                              <span className="api-model-option__main">
                                {item.name ? (
                                  <>
                                    <span className="api-model-option__name">{item.name}</span>
                                    <span className="api-model-option__id">{item.id}</span>
                                  </>
                                ) : (
                                  <span className="api-model-option__id api-model-option__id--solo">
                                    {item.id}
                                  </span>
                                )}
                              </span>
                              {(ctxLabel || nonChat) && (
                                <span className="api-model-option__badges">
                                  {ctxLabel && (
                                    <span className="api-model-badge api-model-badge--ctx">
                                      {ctxLabel}
                                    </span>
                                  )}
                                  {nonChat && (
                                    <span className="api-model-badge api-model-badge--nonchat">
                                      非对话
                                    </span>
                                  )}
                                </span>
                              )}
                            </button>
                          );
                        })
                      ) : (
                        <div className="api-model-empty" data-testid="api-model-empty">
                          {effectiveSearchQuery
                            ? `未匹配到含「${modelSearch.trim() || draft.model.trim()}」的候选模型，可直接保留手动输入的 Model ID。`
                            : '暂无候选模型，可点击「刷新模型列表」拉取或直接手动输入 Model ID。'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
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
                        step={0.01}
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
                        min={64}
                        max={65536}
                        step={1}
                        className="api-input"
                        value={draft.maxTokens}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            maxTokens: Number.isFinite(Number(e.target.value))
                              ? Number(e.target.value)
                              : 4096,
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
                        step={1}
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

                  {!isCloudAccount && (
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
                  )}
                </>
              )}
            </div>

            {isCloudAccount && (
              <div className="api-storage-panel" role="radiogroup" aria-label="已登录账号 API 存储方式">
                <div className="api-storage-panel__status" data-testid="api-storage-status">
                  {cloudStatusText}
                </div>
                <label className="api-radio-label">
                  <input
                    type="radio"
                    name="api-storage-scope"
                    data-testid="api-scope-cloud"
                    checked={draft.storageScope === 'local'}
                    onChange={() => setDraft((prev) => ({ ...prev, storageScope: 'local' }))}
                  />
                  <span>已加密同步至云端（默认 · 跨设备可用，密钥不写入 localStorage）</span>
                </label>
                <label className="api-radio-label">
                  <input
                    type="radio"
                    name="api-storage-scope"
                    data-testid="api-scope-session"
                    checked={draft.storageScope === 'session'}
                    onChange={() => setDraft((prev) => ({ ...prev, storageScope: 'session' }))}
                  />
                  <span>仅当前标签页有效（只存 sessionStorage，不上传云端）</span>
                </label>
              </div>
            )}

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
              className="btn api-btn-clear"
              data-testid="api-btn-clear"
              disabled={busy}
              onClick={() => { void handleClear(); }}
            >
              {clearing ? '清除中...' : '清除配置'}
            </button>

            <div className="api-modal__footer-group">
              <button
                type="button"
                className="btn btn--ghost api-btn-secondary"
                data-testid="api-btn-test"
                disabled={testing || busy}
                onClick={handleTest}
              >
                {testing ? '测试中...' : '测试连接'}
              </button>
              <button
                type="submit"
                className="btn btn--primary api-btn-primary"
                data-testid="api-btn-save"
                disabled={busy}
              >
                {saving ? '保存中...' : '保存配置'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
