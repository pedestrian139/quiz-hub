import { useEffect, useState } from 'react';
import { usePracticeScope } from '../../hooks/practiceScope';
import {
  isApiConfigReady,
  loadApiConfig,
  maskApiKey,
  OPEN_API_SETTINGS_EVENT,
  subscribeApiConfig,
  type ApiConfig,
} from '../../services';
import { Icon } from '../ui/Icons';
import { ApiSettingsModal } from './ApiSettingsModal';
import './ApiSettings.css';

export function ApiSettingsButton() {
  const scope = usePracticeScope();
  const [config, setConfig] = useState<ApiConfig>(() => loadApiConfig(scope));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setConfig(loadApiConfig(scope));
    const unsubscribe = subscribeApiConfig(setConfig, scope);
    const onOpenRequest = () => setOpen(true);
    window.addEventListener(OPEN_API_SETTINGS_EVENT, onOpenRequest);
    return () => {
      unsubscribe();
      window.removeEventListener(OPEN_API_SETTINGS_EVENT, onOpenRequest);
    };
  }, [scope]);

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
          <Icon name="sparkles" size={15} />
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
