import { useEffect, useState } from 'react';
import {
  isApiConfigReady,
  loadApiConfig,
  maskApiKey,
  OPEN_API_SETTINGS_EVENT,
  subscribeApiConfig,
  type ApiConfig,
} from '../../services';
import { ApiSettingsModal } from './ApiSettingsModal';
import './ApiSettings.css';

export function ApiSettingsButton() {
  const [config, setConfig] = useState<ApiConfig>(loadApiConfig);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeApiConfig((next) => setConfig(next));
    const onOpenRequest = () => setOpen(true);
    window.addEventListener(OPEN_API_SETTINGS_EVENT, onOpenRequest);
    return () => {
      unsubscribe();
      window.removeEventListener(OPEN_API_SETTINGS_EVENT, onOpenRequest);
    };
  }, []);

  const ready = isApiConfigReady(config);
  const titleText = ready
    ? `API 已就绪：${config.model}（${maskApiKey(config.apiKey)}）`
    : '配置大模型 API（用于 AI 解析、主观题批改与题库扩展）';

  return (
    <>
      <button
        type="button"
        data-testid="btn-api-settings"
        data-configured={ready ? 'true' : 'false'}
        className={`api-nav-btn${ready ? ' api-nav-btn--ready' : ''}`}
        aria-label="API 设置"
        title={titleText}
        onClick={() => setOpen(true)}
      >
        <span className="api-nav-btn__dot" aria-hidden="true" />
        <span className="api-nav-btn__icon" aria-hidden="true">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3.5 13.6 8.4 18.5 10l-4.9 1.6L12 16.5l-1.6-4.9L5.5 10l4.9-1.6Z" />
            <path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" />
          </svg>
        </span>
        <span>API 设置</span>
      </button>

      <ApiSettingsModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(saved) => setConfig(saved)}
      />
    </>
  );
}
