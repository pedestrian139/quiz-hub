import { useEffect, useState } from 'react';
import { computeHomeStats } from '../../core/quizEngine';
import { safeConfirm } from '../../pages/quizTypes';
import type { QuestionType } from '../../types/quiz';
import {
  useOptionalBankLibraryContext,
  type ImportModalTab,
} from '../../utils/BankLibraryContext';
import { exportBankSharePackage } from '../../utils/bankDb';
import { appendDraftsToBank } from '../../utils/importers';
import { BUILTIN_AI_BANK_ID, type BankRecord } from '../../utils/quizImportTypes';
import { useBankLibrary, type BankLibraryApi } from '../../utils/useBankLibrary';
import { CustomBankPractice } from './CustomBankPractice';
import { ImportWorkbench } from './ImportWorkbench';
import './QuizImport.css';

type PortalTab = ImportModalTab;

function downloadShareJson(bank: BankRecord): void {
  const payload = exportBankSharePackage(bank);
  const safeBase =
    bank.name
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 48) || bank.id;
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeBase}.quizhub.json`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface QuizImportPortalInnerProps {
  library: BankLibraryApi;
  open: boolean;
  setOpen: (open: boolean) => void;
  initialTab: PortalTab;
  onOpenDefault?: () => void;
}

function QuizImportPortalInner({
  library,
  open,
  setOpen,
  initialTab,
  onOpenDefault,
}: QuizImportPortalInnerProps) {
  const [tab, setTab] = useState<PortalTab>(initialTab);
  const [toast, setToast] = useState<{ msg: string; tone: 'info' | 'success' | 'error' } | null>(
    null,
  );

  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [starterStem, setStarterStem] = useState('');
  const [starterType, setStarterType] = useState<QuestionType>('tf');
  const [starterAnswer, setStarterAnswer] = useState('正确');

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const notify = (msg: string, tone: 'info' | 'success' | 'error' = 'info') => {
    setToast({ msg, tone });
  };

  useEffect(() => {
    if (open) {
      setTab(initialTab);
    }
  }, [open, initialTab]);

  useEffect(() => {
    if (library.migratedFromV1) {
      setToast({
        msg: '已自动无损迁移 V1 本地刷题进度至多题库存储（quizhub-v2）',
        tone: 'success',
      });
    }
  }, [library.migratedFromV1]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const customBanks = library.banks.filter((b) => !b.builtin);
  const selectedPracticeBank =
    library.activeBank && !library.activeBank.builtin
      ? library.activeBank
      : (customBanks[0] ?? null);

  const handleCreateEmptyOrStarter = async () => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      notify('请输入新题库名称', 'error');
      return;
    }

    const questions = starterStem.trim()
      ? [
          {
            id: `man-c1-${starterType}-001`,
            type: starterType,
            chapter: 1,
            stem: starterStem.trim(),
            ...(starterType === 'choice' || starterType === 'multi'
              ? { options: ['选项 A', '选项 B', '选项 C', '选项 D'] }
              : {}),
            answer:
              starterType === 'tf'
                ? starterAnswer !== '错误'
                : starterType === 'choice'
                  ? 0
                  : starterType === 'multi'
                    ? [0, 1]
                    : starterAnswer.trim() || '参考答案',
            explain: '',
            source: {
              origin: 'comprehensive_bank' as const,
              file: trimmedName,
              ref: '手动录入 #1',
              note: '来源格式：手动录入',
            },
          },
        ]
      : [];

    const created = await library.importNewBank(
      {
        name: trimmedName,
        description: newDesc.trim() || undefined,
        sourceFormat: 'manual',
        chapters: [{ id: 1, short: '默认章节', title: '第 1 章 默认章节' }],
        questions,
      },
      true,
    );

    setNewName('');
    setNewDesc('');
    setStarterStem('');
    setShowNewForm(false);
    notify(`已新建题库《${created.name}》`, 'success');
  };

  return (
    <>
      <div className="qi-bar" role="region" aria-label="多题库离线导入扩展栏">
        <div className="qi-bar__inner">
          <div className="qi-bar__info">
            <span className="qi-bar__badge">AI 洗题 &amp; 多题库中心</span>
            <span>
              已保存 {library.banks.length} 个题库
              {customBanks.length > 0 ? `（含 ${customBanks.length} 个自定义题库）` : ''}
            </span>
          </div>

          <div className="qi-bar__actions">
            <button
              type="button"
              data-testid="btn-open-quiz-import"
              className="qi-trigger-btn"
              onClick={() => {
                if (onOpenDefault) {
                  onOpenDefault();
                } else {
                  setTab('import');
                  setOpen(true);
                }
              }}
            >
              AI 洗题导入 / 题库管理
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div
          className="qi-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            data-testid="quiz-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="多题库管理与 AI 智能洗题导入"
            className="qi-modal"
          >
            <div className="qi-modal__header">
              <div className="qi-modal__title-wrap">
                <h2 className="qi-modal__title">QuizHub 智能洗题与多题库管理中心</h2>
                <span className="qi-modal__sub">
                  支持 AI 非结构化洗题、Excel / CSV / Word / TXT / Markdown / JSON 导入与云端同步
                </span>
              </div>
              <button
                type="button"
                data-testid="btn-close-quiz-import"
                className="qi-close-btn"
                onClick={() => setOpen(false)}
              >
                关闭
              </button>
            </div>

            <div className="qi-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'import'}
                data-testid="qi-tab-import"
                className={`qi-tab${tab === 'import' ? ' is-active' : ''}`}
                onClick={() => setTab('import')}
              >
                导入 / AI 洗题
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'banks'}
                data-testid="qi-tab-banks"
                className={`qi-tab${tab === 'banks' ? ' is-active' : ''}`}
                onClick={() => setTab('banks')}
              >
                我的题库 ({library.banks.length})
              </button>
              {selectedPracticeBank && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'practice'}
                  data-testid="qi-tab-practice"
                  className={`qi-tab${tab === 'practice' ? ' is-active' : ''}`}
                  onClick={() => setTab('practice')}
                >
                  自定义题库刷题：{selectedPracticeBank.name}
                </button>
              )}
            </div>

            <div className="qi-modal__body">
              {toast && (
                <div
                  role="status"
                  className={`qi-toast${toast.tone === 'success' ? ' qi-toast--success' : toast.tone === 'error' ? ' qi-toast--error' : ''}`}
                >
                  {toast.msg}
                </div>
              )}

              {tab === 'import' && (
                <ImportWorkbench
                  existingBanks={library.banks}
                  notify={notify}
                  onCommit={async (payload) => {
                    if (payload.mode === 'new') {
                      const created = await library.importNewBank(payload.input, true);
                      await library.selectBank(created.id);
                      notify(
                        `成功导入题库《${created.name}》（共 ${created.data.questions.length} 题）`,
                        'success',
                      );
                    } else {
                      const target = library.banks.find(
                        (b) => b.id === payload.targetBankId && !b.builtin,
                      );
                      if (!target) {
                        throw new Error('未找到目标自定义题库，请重新选择');
                      }
                      const merged = appendDraftsToBank(target, payload.drafts, {
                        sourceFormat: payload.sourceFormat,
                      });
                      const saved = await library.saveBank(merged);
                      await library.selectBank(saved.id);
                      notify(
                        `已向题库《${saved.name}》追加题目（当前共 ${saved.data.questions.length} 题）`,
                        'success',
                      );
                    }
                    setOpen(false);
                    if (typeof window !== 'undefined' && window.location.hash !== '#/quiz') {
                      window.location.hash = '#/quiz';
                    }
                  }}
                />
              )}

              {tab === 'banks' && (
                <div className="qi-draft-list">
                  <div className="qi-toolbar">
                    <span style={{ fontSize: '13.5px', color: 'var(--sub)' }}>
                      每个题库的答题进度、错题本、收藏夹与掌握度均按题库独立隔离存储
                    </span>
                    <div className="qi-btn-group">
                      <button
                        type="button"
                        data-testid="btn-new-bank"
                        className="qi-btn qi-btn--primary"
                        onClick={() => setShowNewForm((v) => !v)}
                      >
                        {showNewForm ? '收起新建表单' : '+ 新建自定义题库'}
                      </button>
                    </div>
                  </div>

                  {showNewForm && (
                    <div className="qi-card" data-testid="new-bank-form">
                      <div className="qi-grid-two">
                        <label className="qi-field">
                          <span className="qi-field__label">题库名称（必填）</span>
                          <input
                            type="text"
                            data-testid="new-bank-name"
                            className="qi-input"
                            placeholder="例如：数据结构期末复习"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </label>
                        <label className="qi-field">
                          <span className="qi-field__label">题库简介（选填）</span>
                          <input
                            type="text"
                            data-testid="new-bank-desc"
                            className="qi-input"
                            value={newDesc}
                            onChange={(e) => setNewDesc(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </label>
                      </div>

                      <div className="qi-grid-two">
                        <label className="qi-field">
                          <span className="qi-field__label">首道示例题干（选填，留空可建空库）</span>
                          <input
                            type="text"
                            data-testid="new-bank-starter-stem"
                            className="qi-input"
                            placeholder="选填：快速录入 1 道题干"
                            value={starterStem}
                            onChange={(e) => setStarterStem(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </label>
                        <label className="qi-field">
                          <span className="qi-field__label">首题类型与答案（选填）</span>
                          <div className="qi-opt-row">
                            <select
                              className="qi-select"
                              value={starterType}
                              onChange={(e) => setStarterType(e.target.value as QuestionType)}
                            >
                              <option value="tf">判断</option>
                              <option value="short">简答</option>
                            </select>
                            <input
                              type="text"
                              className="qi-input"
                              value={starterAnswer}
                              onChange={(e) => setStarterAnswer(e.target.value)}
                              onKeyDown={(e) => e.stopPropagation()}
                            />
                          </div>
                        </label>
                      </div>

                      <div className="qi-btn-group">
                        <button
                          type="button"
                          data-testid="btn-create-bank-submit"
                          className="qi-btn qi-btn--primary"
                          onClick={() => void handleCreateEmptyOrStarter()}
                        >
                          确认创建题库
                        </button>
                      </div>
                    </div>
                  )}

                  <div data-testid="bank-list" className="qi-bank-grid">
                    {library.banks.map((bank) => {
                      const bankStore = library.getProgressFor(bank.id);
                      const stats = computeHomeStats(bank.data.questions, bankStore);
                      const isActive = library.activeBankId === bank.id;
                      const isRenaming = renamingId === bank.id;

                      return (
                        <article
                          key={bank.id}
                          data-testid={`bank-card-${bank.id}`}
                          data-active={isActive ? 'true' : 'false'}
                          className={`qi-bank-card${isActive ? ' is-active' : ''}`}
                        >
                          <div className="qi-bank-card__head">
                            {isRenaming ? (
                              <div className="qi-opt-row" style={{ flex: 1 }}>
                                <input
                                  type="text"
                                  data-testid="rename-bank-input"
                                  className="qi-input"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => e.stopPropagation()}
                                />
                                <button
                                  type="button"
                                  data-testid="btn-rename-save"
                                  className="qi-btn qi-btn--sm qi-btn--primary"
                                  onClick={async () => {
                                    const ok = await library.renameBank(bank.id, renameValue);
                                    if (ok) {
                                      setRenamingId(null);
                                      notify('题库名称已更新', 'success');
                                    } else {
                                      notify('题库名称不能为空', 'error');
                                    }
                                  }}
                                >
                                  保存
                                </button>
                                <button
                                  type="button"
                                  className="qi-btn qi-btn--sm"
                                  onClick={() => setRenamingId(null)}
                                >
                                  取消
                                </button>
                              </div>
                            ) : (
                              <>
                                <h3 className="qi-bank-card__title">{bank.name}</h3>
                                <div className="qi-pill-row">
                                  <span
                                    className={`qi-pill${bank.builtin ? ' qi-pill--brand' : ''}`}
                                  >
                                    {bank.builtin ? '内置示例' : '自定义'}
                                  </span>
                                  {isActive && (
                                    <span className="qi-pill qi-pill--ok">当前激活</span>
                                  )}
                                </div>
                              </>
                            )}
                          </div>

                          {bank.description && (
                            <p className="qi-bank-card__desc">{bank.description}</p>
                          )}

                          <div className="qi-pill-row">
                            <span className="qi-pill">共 {bank.data.questions.length} 题</span>
                            <span className="qi-pill">{bank.data.chapters.length} 章</span>
                            <span className="qi-pill">已练 {stats.practicedCount}</span>
                            <span className="qi-pill">错题 {stats.wrongCount}</span>
                            <span className="qi-pill">收藏 {stats.favCount}</span>
                          </div>

                          <div className="qi-btn-group">
                            {bank.id === BUILTIN_AI_BANK_ID ? (
                              <button
                                type="button"
                                data-testid={`btn-switch-bank-${bank.id}`}
                                className="qi-btn qi-btn--sm qi-btn--primary"
                                onClick={async () => {
                                  await library.selectBank(bank.id);
                                  setOpen(false);
                                }}
                              >
                                返回主页面刷此库
                              </button>
                            ) : (
                              <button
                                type="button"
                                data-testid={`btn-practice-bank-${bank.id}`}
                                className="qi-btn qi-btn--sm qi-btn--primary"
                                disabled={bank.data.questions.length === 0}
                                onClick={async () => {
                                  await library.selectBank(bank.id);
                                  setTab('practice');
                                }}
                              >
                                {isActive ? '进入刷题' : '切换并刷题'}
                              </button>
                            )}

                            <button
                              type="button"
                              data-testid={`btn-export-bank-${bank.id}`}
                              className="qi-btn qi-btn--sm"
                              onClick={() => {
                                downloadShareJson(bank);
                                notify(`已导出分享包（${bank.name}.quizhub.json）`, 'success');
                              }}
                            >
                              导出分享包
                            </button>

                            <button
                              type="button"
                              data-testid={`btn-clear-bank-progress-${bank.id}`}
                              className="qi-btn qi-btn--sm"
                              onClick={async () => {
                                if (
                                  safeConfirm(
                                    `确定要清空题库《${bank.name}》在多题库中心中的练习进度吗？（不影响其他题库）`,
                                  )
                                ) {
                                  await library.clearBankProgress(bank.id);
                                  notify(`已清空《${bank.name}》进度`, 'info');
                                }
                              }}
                            >
                              清空进度
                            </button>

                            {!bank.builtin && (
                              <>
                                <button
                                  type="button"
                                  data-testid={`btn-rename-bank-${bank.id}`}
                                  className="qi-btn qi-btn--sm"
                                  onClick={() => {
                                    setRenamingId(bank.id);
                                    setRenameValue(bank.name);
                                  }}
                                >
                                  重命名
                                </button>
                                <button
                                  type="button"
                                  data-testid={`btn-delete-bank-${bank.id}`}
                                  className="qi-btn qi-btn--sm qi-btn--danger"
                                  onClick={async () => {
                                    if (
                                      safeConfirm(
                                        `确定要永久删除自定义题库《${bank.name}》及其独立答题记录吗？`,
                                      )
                                    ) {
                                      await library.deleteBank(bank.id);
                                      notify(`已删除题库《${bank.name}》`, 'info');
                                    }
                                  }}
                                >
                                  删除
                                </button>
                              </>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}

              {tab === 'practice' && selectedPracticeBank && (
                <CustomBankPractice
                  key={selectedPracticeBank.id}
                  bank={selectedPracticeBank}
                  store={library.getProgressFor(selectedPracticeBank.id)}
                  onUpdateStore={(fn) =>
                    library.storeApiFor(selectedPracticeBank.id).update(fn)
                  }
                  onResetProgress={async () => {
                    await library.clearBankProgress(selectedPracticeBank.id);
                    notify(`已清空《${selectedPracticeBank.name}》独立刷题进度`, 'info');
                  }}
                  notify={notify}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function QuizImportPortalStandalone() {
  const library = useBankLibrary();
  const [open, setOpen] = useState(false);
  return (
    <QuizImportPortalInner
      library={library}
      open={open}
      setOpen={setOpen}
      initialTab="import"
    />
  );
}

export function QuizImportPortal() {
  const ctx = useOptionalBankLibraryContext();
  if (ctx) {
    return (
      <QuizImportPortalInner
        library={ctx}
        open={ctx.importModalOpen}
        setOpen={ctx.setImportModalOpen}
        initialTab={ctx.importInitialTab}
        onOpenDefault={() => ctx.openImportModal('import')}
      />
    );
  }
  return <QuizImportPortalStandalone />;
}
