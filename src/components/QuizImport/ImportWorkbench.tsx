import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { getOptionLabel, getTypeLabel } from '../../core/questionUtils';
import type { QuestionType } from '../../types/quiz';
import type { CreateCustomBankInput } from '../../utils/bankDb';
import {
  downloadExcelTemplate,
  downloadTxtTemplate,
  parseImportFile,
  parsePastedContent,
} from '../../utils/importers';
import {
  annotateDuplicateStems,
  extractChapterInfo,
  finalizeDraftsToBank,
  formatDraftRawAnswer,
  validateDraftQuestion,
} from '../../utils/importers/normalize';
import type { DraftQuestion, ImportParseResult } from '../../utils/quizImportTypes';

interface ImportWorkbenchProps {
  onCommitBank: (input: CreateCustomBankInput) => Promise<void>;
  notify: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

const QUESTION_TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: 'choice', label: '单选题' },
  { value: 'multi', label: '多选题' },
  { value: 'tf', label: '判断题' },
  { value: 'short', label: '简答题' },
  { value: 'analysis', label: '综合分析题' },
];

const PAGE_STEP = 50;

function stopShortcutBubble(e: React.KeyboardEvent) {
  e.stopPropagation();
}

export function ImportWorkbench({ onCommitBank, notify }: ImportWorkbenchProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [inputMode, setInputMode] = useState<'file' | 'paste'>('file');
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const [parseResult, setParseResult] = useState<ImportParseResult | null>(null);
  const [bankName, setBankName] = useState('');
  const [bankDesc, setBankDesc] = useState('');
  const [drafts, setDrafts] = useState<DraftQuestion[]>([]);
  const [filterIssuesOnly, setFilterIssuesOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);
  const [committing, setCommitting] = useState(false);

  const applyParseResult = (res: ImportParseResult) => {
    setParseResult(res);
    setBankName(res.suggestedName);
    setBankDesc(res.suggestedDescription ?? '');
    setDrafts(res.drafts);
    setFilterIssuesOnly(false);
    setEditingId(null);
    setVisibleCount(PAGE_STEP);
    if (res.fatalError) {
      notify(res.fatalError, 'error');
    } else if (res.drafts.length > 0) {
      notify(`已解析 ${res.drafts.length} 道题目，请确认预览后导入`, 'success');
    }
  };

  const handleSelectedFile = async (file: File) => {
    setParsing(true);
    try {
      const res = await parseImportFile(file);
      applyParseResult(res);
    } catch (err) {
      notify(
        `解析文件失败：${err instanceof Error ? err.message : '请检查文件格式'}`,
        'error',
      );
    } finally {
      setParsing(false);
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await handleSelectedFile(file);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleSelectedFile(file);
    }
  };

  const handleParsePaste = () => {
    const res = parsePastedContent(pasteText);
    applyParseResult(res);
  };

  const summary = useMemo(() => {
    let validIncluded = 0;
    let errorIncluded = 0;
    let warningCount = 0;
    let totalErrors = 0;

    for (const d of drafts) {
      const hasErr = d.issues.some((i) => i.severity === 'error');
      const hasWarn = d.issues.some((i) => i.severity === 'warning');
      if (hasErr) totalErrors += 1;
      if (hasWarn) warningCount += 1;
      if (d.included) {
        if (hasErr) errorIncluded += 1;
        else validIncluded += 1;
      }
    }

    return {
      total: drafts.length,
      validIncluded,
      errorIncluded,
      warningCount,
      totalErrors,
    };
  }, [drafts]);

  const updateDraft = (tempId: string, updater: (prev: DraftQuestion) => DraftQuestion) => {
    setDrafts((prev) => {
      const mapped = prev.map((d) =>
        d.tempId === tempId ? validateDraftQuestion(updater(d)) : d,
      );
      return annotateDuplicateStems(mapped);
    });
  };

  const handleExcludeAllErrors = () => {
    setDrafts((prev) =>
      prev.map((d) =>
        d.issues.some((i) => i.severity === 'error') ? { ...d, included: false } : d,
      ),
    );
    notify('已自动取消勾选全部异常题目', 'info');
  };

  const handleCommit = async () => {
    if (summary.validIncluded === 0 || summary.errorIncluded > 0 || committing) {
      return;
    }
    setCommitting(true);
    try {
      const finalized = finalizeDraftsToBank(drafts, {
        name: bankName,
        description: bankDesc,
        sourceFormat: parseResult?.format,
      });
      await onCommitBank(finalized);
      setParseResult(null);
      setDrafts([]);
      setPasteText('');
    } finally {
      setCommitting(false);
    }
  };

  const filteredDraftEntries = useMemo(() => {
    return drafts
      .map((draft, origIndex) => ({ draft, origIndex }))
      .filter(({ draft }) =>
        filterIssuesOnly ? draft.issues.length > 0 : true,
      );
  }, [drafts, filterIssuesOnly]);

  const visibleEntries = filteredDraftEntries.slice(0, visibleCount);

  return (
    <div className="qi-draft-list">
      <div className="qi-card">
        <div className="qi-toolbar">
          <div className="qi-btn-group">
            <button
              type="button"
              data-testid="import-tab-file"
              className={`qi-btn${inputMode === 'file' ? ' qi-btn--primary' : ''}`}
              onClick={() => setInputMode('file')}
            >
              上传文件导入
            </button>
            <button
              type="button"
              data-testid="import-tab-paste"
              className={`qi-btn${inputMode === 'paste' ? ' qi-btn--primary' : ''}`}
              onClick={() => setInputMode('paste')}
            >
              直接粘贴文本 / Markdown / JSON
            </button>
          </div>

          <div className="qi-btn-group">
            <button
              type="button"
              data-testid="btn-download-xlsx-tpl"
              className="qi-btn qi-btn--sm"
              onClick={() => {
                void downloadExcelTemplate().then(() => {
                  notify('已下载标准 Excel 导入模板（quizhub-template.xlsx）', 'success');
                });
              }}
            >
              下载 Excel 模板
            </button>
            <button
              type="button"
              data-testid="btn-download-txt-tpl"
              className="qi-btn qi-btn--sm"
              onClick={() => {
                downloadTxtTemplate();
                notify('已下载标准 TXT 导入模板（quizhub-template.txt）', 'success');
              }}
            >
              下载 TXT 模板
            </button>
          </div>
        </div>

        {inputMode === 'file' ? (
          <div
            className={`qi-dropzone${dragging ? ' is-dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <strong>支持 Excel (.xlsx/.xls) · CSV/TSV · Word (.docx) · TXT/Markdown · JSON</strong>
            <span style={{ fontSize: '13px', color: 'var(--sub)' }}>
              纯前端本地离线解析，智能兼容考试宝 / 超星 / 雨课堂 / 问卷星 / Quizlet 及 .quizhub.json 分享包
            </span>
            <input
              ref={fileInputRef}
              data-testid="bank-import-file-input"
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.docx,.txt,.md,.markdown,.json"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button
              type="button"
              data-testid="btn-pick-import-file"
              className="qi-btn qi-btn--primary"
              disabled={parsing}
              onClick={() => fileInputRef.current?.click()}
            >
              {parsing ? '正在加载解析器并拆题…' : '选择本地文件导入'}
            </button>
          </div>
        ) : (
          <div className="qi-field">
            <label className="qi-field__label" htmlFor="qi-paste-area">
              粘贴 TXT / Markdown 题库或 JSON（支持章节标题、题号、选项、行内/尾部答案与解析）
            </label>
            <textarea
              id="qi-paste-area"
              data-testid="import-paste-textarea"
              className="qi-textarea"
              placeholder={`# 第一章 基础概念\n1. 题目题干？\nA. 选项一\nB. 选项二\n答案：A\n解析：简要解析`}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              onKeyDown={stopShortcutBubble}
            />
            <div className="qi-btn-group">
              <button
                type="button"
                data-testid="btn-parse-paste"
                className="qi-btn qi-btn--primary"
                onClick={handleParsePaste}
              >
                智能解析预览
              </button>
              {pasteText.length > 0 && (
                <button
                  type="button"
                  className="qi-btn"
                  onClick={() => setPasteText('')}
                >
                  清空文本框
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {parseResult && (
        <div data-testid="import-preview" className="qi-card">
          <div className="qi-toolbar">
            <div>
              <h3 style={{ margin: 0, fontSize: '16px' }}>导入前可视化预览与校对</h3>
              <span style={{ fontSize: '12.5px', color: 'var(--sub)' }}>
                导入前可随时修改题目、修正答案，或取消勾选剔除异常项
              </span>
            </div>
            <button
              type="button"
              data-testid="btn-cancel-import"
              className="qi-btn qi-btn--sm"
              onClick={() => {
                setParseResult(null);
                setDrafts([]);
              }}
            >
              放弃本次预览
            </button>
          </div>

          {parseResult.fatalError && (
            <div className="qi-toast qi-toast--error">{parseResult.fatalError}</div>
          )}

          {parseResult.notes.length > 0 && (
            <div className="qi-pill-row">
              {parseResult.notes.map((n, i) => (
                <span key={i} className="qi-pill qi-pill--brand">
                  {n}
                </span>
              ))}
            </div>
          )}

          {drafts.length > 0 && (
            <>
              <div className="qi-grid-two">
                <label className="qi-field">
                  <span className="qi-field__label">新题库名称</span>
                  <input
                    type="text"
                    data-testid="import-bank-name"
                    className="qi-input"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    onKeyDown={stopShortcutBubble}
                  />
                </label>
                <label className="qi-field">
                  <span className="qi-field__label">题库简介（选填）</span>
                  <input
                    type="text"
                    data-testid="import-bank-desc"
                    className="qi-input"
                    placeholder="例如：期末重点题库 / 课后复习整理"
                    value={bankDesc}
                    onChange={(e) => setBankDesc(e.target.value)}
                    onKeyDown={stopShortcutBubble}
                  />
                </label>
              </div>

              <div data-testid="preview-summary" className="qi-toolbar">
                <div className="qi-pill-row">
                  <span className="qi-pill">共识别 {summary.total} 题</span>
                  <span className="qi-pill qi-pill--ok">
                    可入库 {summary.validIncluded} 题
                  </span>
                  {summary.warningCount > 0 && (
                    <span className="qi-pill qi-pill--warn">
                      告警 {summary.warningCount} 题
                    </span>
                  )}
                  {summary.totalErrors > 0 && (
                    <span className="qi-pill qi-pill--bad">
                      异常 {summary.totalErrors} 题（未剔除勾选 {summary.errorIncluded} 题）
                    </span>
                  )}
                </div>

                <div className="qi-btn-group">
                  <button
                    type="button"
                    data-testid="preview-filter-issues"
                    className={`qi-btn qi-btn--sm${filterIssuesOnly ? ' qi-btn--primary' : ''}`}
                    onClick={() => setFilterIssuesOnly((v) => !v)}
                  >
                    {filterIssuesOnly ? '显示全部题目' : '仅看异常与告警'}
                  </button>
                  {summary.errorIncluded > 0 && (
                    <button
                      type="button"
                      data-testid="btn-exclude-errors"
                      className="qi-btn qi-btn--sm qi-btn--danger"
                      onClick={handleExcludeAllErrors}
                    >
                      一键剔除异常项 ({summary.errorIncluded})
                    </button>
                  )}
                </div>
              </div>

              <div data-testid="preview-draft-list" className="qi-draft-list">
                {visibleEntries.map(({ draft, origIndex }) => {
                  const hasErr = draft.issues.some((i) => i.severity === 'error');
                  const hasWarn = draft.issues.some((i) => i.severity === 'warning');
                  const severity = hasErr ? 'error' : hasWarn ? 'warning' : 'ok';
                  const isEditing = editingId === draft.tempId;

                  return (
                    <div
                      key={draft.tempId}
                      data-testid={`preview-draft-${origIndex}`}
                      data-severity={severity}
                      className={`qi-draft-card${draft.included ? '' : ' is-excluded'}`}
                    >
                      <div className="qi-toolbar">
                        <div className="qi-pill-row">
                          <span className="qi-pill">#{origIndex + 1}</span>
                          <span className="qi-pill qi-pill--brand">
                            {getTypeLabel(draft.type)}
                          </span>
                          <span className="qi-pill">
                            第{draft.chapter || 1}章 · {draft.chapterName}
                          </span>
                          <span className="qi-pill">{draft.sourceLoc}</span>
                          {hasErr ? (
                            <span className="qi-pill qi-pill--bad">存在异常</span>
                          ) : hasWarn ? (
                            <span className="qi-pill qi-pill--warn">有告警</span>
                          ) : (
                            <span className="qi-pill qi-pill--ok">校验通过</span>
                          )}
                        </div>

                        <div className="qi-btn-group">
                          <button
                            type="button"
                            data-testid={`draft-toggle-${origIndex}`}
                            className={`qi-btn qi-btn--sm${draft.included ? '' : ' qi-btn--warn'}`}
                            onClick={() =>
                              updateDraft(draft.tempId, (d) => ({
                                ...d,
                                included: !d.included,
                              }))
                            }
                          >
                            {draft.included ? '已保留（点击剔除）' : '已剔除（点击恢复）'}
                          </button>
                          <button
                            type="button"
                            data-testid={`draft-edit-${origIndex}`}
                            className="qi-btn qi-btn--sm"
                            onClick={() =>
                              setEditingId((cur) => (cur === draft.tempId ? null : draft.tempId))
                            }
                          >
                            {isEditing ? '收起编辑' : '修正'}
                          </button>
                        </div>
                      </div>

                      <div style={{ fontWeight: 650, fontSize: '14.5px' }}>
                        {draft.stem || '（空题干）'}
                      </div>

                      {draft.options.length > 0 && (
                        <div style={{ fontSize: '13px', color: 'var(--sub)' }}>
                          {draft.options
                            .map((opt, oIdx) => `${getOptionLabel(oIdx)}. ${opt}`)
                            .join('  |  ')}
                        </div>
                      )}

                      <div style={{ fontSize: '13px', color: 'var(--ink-2)' }}>
                        <strong>当前答案：</strong>
                        {formatDraftRawAnswer(draft.type, draft.answer) || draft.rawAnswer || '（未设置）'}
                        {draft.explain ? ` · 解析：${draft.explain}` : ''}
                      </div>

                      {draft.issues.length > 0 && (
                        <ul className="qi-issue-list">
                          {draft.issues.map((issue, iIdx) => (
                            <li
                              key={iIdx}
                              className={
                                issue.severity === 'error'
                                  ? 'qi-issue--error'
                                  : 'qi-issue--warning'
                              }
                            >
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      )}

                      {isEditing && (
                        <div className="qi-draft-editor">
                          <div className="qi-grid-two">
                            <label className="qi-field">
                              <span className="qi-field__label">题型</span>
                              <select
                                data-testid={`draft-edit-type-${origIndex}`}
                                className="qi-select"
                                value={draft.type}
                                onChange={(e) => {
                                  const nextType = e.target.value as QuestionType;
                                  updateDraft(draft.tempId, (d) => {
                                    const nextOpts =
                                      nextType === 'choice' || nextType === 'multi'
                                        ? d.options.length >= 2
                                          ? d.options
                                          : ['选项 A', '选项 B', '选项 C', '选项 D']
                                        : [];
                                    let nextAns: number | number[] | boolean | string = '';
                                    if (nextType === 'choice') nextAns = 0;
                                    else if (nextType === 'multi') nextAns = [0, 1];
                                    else if (nextType === 'tf') nextAns = true;
                                    else if (typeof d.answer === 'string') nextAns = d.answer;
                                    return {
                                      ...d,
                                      type: nextType,
                                      options: nextOpts,
                                      answer: nextAns,
                                      rawAnswer: formatDraftRawAnswer(nextType, nextAns),
                                    };
                                  });
                                }}
                              >
                                {QUESTION_TYPE_OPTIONS.map((t) => (
                                  <option key={t.value} value={t.value}>
                                    {t.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="qi-field">
                              <span className="qi-field__label">章节</span>
                              <input
                                type="text"
                                data-testid={`draft-edit-chapter-${origIndex}`}
                                className="qi-input"
                                value={draft.chapterName}
                                onChange={(e) => {
                                  const info = extractChapterInfo(e.target.value, draft.chapter || 1);
                                  updateDraft(draft.tempId, (d) => ({
                                    ...d,
                                    chapter: info.chapter > 0 ? info.chapter : 1,
                                    chapterName: e.target.value,
                                  }));
                                }}
                                onKeyDown={stopShortcutBubble}
                              />
                            </label>
                          </div>

                          <label className="qi-field">
                            <span className="qi-field__label">题干</span>
                            <textarea
                              data-testid={`draft-edit-stem-${origIndex}`}
                              className="qi-textarea"
                              style={{ minHeight: '72px' }}
                              value={draft.stem}
                              onChange={(e) =>
                                updateDraft(draft.tempId, (d) => ({
                                  ...d,
                                  stem: e.target.value,
                                }))
                              }
                              onKeyDown={stopShortcutBubble}
                            />
                          </label>

                          {(draft.type === 'choice' || draft.type === 'multi') && (
                            <div className="qi-field">
                              <span className="qi-field__label">选项与正确答案勾选</span>
                              {draft.options.map((opt, optIdx) => {
                                const isChecked =
                                  draft.type === 'choice'
                                    ? draft.answer === optIdx
                                    : Array.isArray(draft.answer) &&
                                      draft.answer.includes(optIdx);
                                return (
                                  <div key={optIdx} className="qi-opt-row">
                                    <button
                                      type="button"
                                      data-testid={`draft-edit-ans-${origIndex}-${optIdx}`}
                                      className={`qi-btn qi-btn--sm${isChecked ? ' qi-btn--primary' : ''}`}
                                      onClick={() =>
                                        updateDraft(draft.tempId, (d) => {
                                          if (d.type === 'choice') {
                                            return {
                                              ...d,
                                              answer: optIdx,
                                              rawAnswer: getOptionLabel(optIdx),
                                            };
                                          }
                                          const prevArr = Array.isArray(d.answer)
                                            ? d.answer
                                            : [];
                                          const nextArr = prevArr.includes(optIdx)
                                            ? prevArr.filter((i) => i !== optIdx)
                                            : [...prevArr, optIdx].sort((a, b) => a - b);
                                          return {
                                            ...d,
                                            answer: nextArr,
                                            rawAnswer: formatDraftRawAnswer('multi', nextArr),
                                          };
                                        })
                                      }
                                    >
                                      {getOptionLabel(optIdx)} {isChecked ? '✓' : ''}
                                    </button>
                                    <input
                                      type="text"
                                      data-testid={`draft-edit-opt-${origIndex}-${optIdx}`}
                                      className="qi-input"
                                      value={opt}
                                      onChange={(e) =>
                                        updateDraft(draft.tempId, (d) => {
                                          const nextOpts = [...d.options];
                                          nextOpts[optIdx] = e.target.value;
                                          return { ...d, options: nextOpts };
                                        })
                                      }
                                      onKeyDown={stopShortcutBubble}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {draft.type === 'tf' && (
                            <div className="qi-field">
                              <span className="qi-field__label">判断题正确答案</span>
                              <div className="qi-btn-group">
                                <button
                                  type="button"
                                  data-testid={`draft-edit-tf-true-${origIndex}`}
                                  className={`qi-btn qi-btn--sm${draft.answer === true ? ' qi-btn--primary' : ''}`}
                                  onClick={() =>
                                    updateDraft(draft.tempId, (d) => ({
                                      ...d,
                                      answer: true,
                                      rawAnswer: '正确',
                                    }))
                                  }
                                >
                                  正确
                                </button>
                                <button
                                  type="button"
                                  data-testid={`draft-edit-tf-false-${origIndex}`}
                                  className={`qi-btn qi-btn--sm${draft.answer === false ? ' qi-btn--primary' : ''}`}
                                  onClick={() =>
                                    updateDraft(draft.tempId, (d) => ({
                                      ...d,
                                      answer: false,
                                      rawAnswer: '错误',
                                    }))
                                  }
                                >
                                  错误
                                </button>
                              </div>
                            </div>
                          )}

                          {(draft.type === 'short' || draft.type === 'analysis') && (
                            <label className="qi-field">
                              <span className="qi-field__label">参考答案</span>
                              <textarea
                                data-testid={`draft-edit-refans-${origIndex}`}
                                className="qi-textarea"
                                style={{ minHeight: '72px' }}
                                value={typeof draft.answer === 'string' ? draft.answer : ''}
                                onChange={(e) =>
                                  updateDraft(draft.tempId, (d) => ({
                                    ...d,
                                    answer: e.target.value,
                                    rawAnswer: e.target.value,
                                  }))
                                }
                                onKeyDown={stopShortcutBubble}
                              />
                            </label>
                          )}

                          <label className="qi-field">
                            <span className="qi-field__label">解析（选填）</span>
                            <input
                              type="text"
                              data-testid={`draft-edit-explain-${origIndex}`}
                              className="qi-input"
                              value={draft.explain}
                              onChange={(e) =>
                                updateDraft(draft.tempId, (d) => ({
                                  ...d,
                                  explain: e.target.value,
                                }))
                              }
                              onKeyDown={stopShortcutBubble}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}

                {filteredDraftEntries.length > visibleEntries.length && (
                  <button
                    type="button"
                    className="qi-btn"
                    onClick={() => setVisibleCount((c) => c + PAGE_STEP)}
                  >
                    继续加载更多（剩余 {filteredDraftEntries.length - visibleEntries.length} 题）
                  </button>
                )}
              </div>

              <div className="qi-toolbar" style={{ paddingTop: '8px', borderTop: '1px solid var(--line)' }}>
                <span style={{ fontSize: '13px', color: 'var(--sub)' }}>
                  {summary.errorIncluded > 0
                    ? `还有 ${summary.errorIncluded} 道已勾选题目存在异常，请点击“修正”或“一键剔除异常项”后再入库。`
                    : summary.validIncluded > 0
                      ? `准备就绪：将导入 ${summary.validIncluded} 道有效题目至独立题库。`
                      : '当前没有可入库的有效题目。'}
                </span>
                <button
                  type="button"
                  data-testid="btn-confirm-import"
                  className="qi-btn qi-btn--primary"
                  disabled={summary.validIncluded === 0 || summary.errorIncluded > 0 || committing}
                  onClick={handleCommit}
                >
                  {committing
                    ? '正在入库…'
                    : `确认导入 ${summary.validIncluded} 题并开始刷题`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
