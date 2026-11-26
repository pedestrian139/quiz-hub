import { beforeEach, expect, it, vi } from 'vitest';
import { createDefaultApiConfig } from '../../src/services/apiConfig';
import { clearCloudApiConfig, restoreCloudApiConfig, saveCloudApiConfig } from '../../src/services/db/cloudData';

const { getSession, invoke } = vi.hoisted(() => ({ getSession: vi.fn(), invoke: vi.fn() }));
vi.mock('../../src/services/db/client', () => ({
  getDatabaseClient: () => ({ auth: { getSession } }), invokeDatabaseFunction: invoke,
}));

beforeEach(() => { vi.resetAllMocks(); });

it('rejects without invoking the function after logout or an account switch', async () => {
  getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
  await expect(restoreCloudApiConfig('first')).rejects.toThrow('请先登录');
  getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'second' } } }, error: null });
  await expect(saveCloudApiConfig(createDefaultApiConfig(), 'first')).rejects.toThrow('登录账号已变更');
  expect(invoke).not.toHaveBeenCalled();
});

it('keeps tab-only configurations local and forwards a verified owner and access token for deletion', async () => {
  await expect(saveCloudApiConfig({ ...createDefaultApiConfig(), storageScope: 'session' }, 'owner')).rejects.toThrow('仅当前标签页');
  expect(getSession).not.toHaveBeenCalled();
  getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'owner' }, access_token: 'test-token' } }, error: null });
  invoke.mockResolvedValueOnce({ ok: true });
  await clearCloudApiConfig('owner');
  expect(invoke).toHaveBeenCalledExactlyOnceWith('user-data', { action: 'clear_api_config', ownerId: 'owner' }, 'test-token');
});
