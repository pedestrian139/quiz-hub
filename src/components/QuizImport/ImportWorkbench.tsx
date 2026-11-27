import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { Icon } from '../ui/Icons';
import { getOptionLabel, getTypeLabel } from '../../core/questionUtils';
import { usePracticeScope } from '../../hooks/practiceScope';
import {
  isApiConfigReady,
  loadApiConfig,
  requestOpenApiSettings,
  subscribeApiConfig,
  type ApiConfig,
} from '../../services/apiConfig';
import {
  ApiClientError,
  retryWashChunk,
  washQuestionsChunked,
  type FailedWashChunk,
  type WashProgressEvent,
} from '../../services/quizAiService';
import type { QuestionType } from '../../types/quiz';
import type { CreateCustomBankInput } from '../../utils/bankDb';
import {
  decodeTextBuffer,
  detectStandardQuizJson,
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
  suggestBankNameFromFile,
  validateDraftQuestion,
} from '../../utils/importers/normalize';
import type {
  BankRecord,
  DraftQuestion,
  ImportParseResult,
  ImportSourceFormat,
} from '../../utils/quizImportTypes';
import { RichContent } from '../RichContent';

export interface CommitNewBankPayload {
  mode: 'new';
  input: CreateCustomBankInput;
}

export interface CommitAppendBankPayload {
  mode: 'existing';
  targetBankId: string;
  drafts: DraftQuestion[];
  sourceFormat?: ImportSourceFormat | 'manual';
}

export type ImportCommitPayload = CommitNewBankPayload | CommitAppendBankPayload;

interface ImportWorkbenchProps {
  existingBanks?: BankRecord[];
  onCommit?: (payload: ImportCommitPayload) => Promise<void>;
  onCommitBank?: (input: CreateCustomBankInput) => Promise<void>;
  notify: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

const QUESTION_TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: 'choice', label: '单选题' },
  { value: 'multi', label: '多选题' },
  { value: 'tf', label: '判断题' },
  { value: 'short', label: '简答题' },
  { value: 'analysis', label: '综合分析题' },
];

type WashQuestionType = 'choice' | 'multi' | 'tf' | 'short';

const ALL_WASH_TYPES: WashQuestionType[] = ['choice', 'multi', 'tf', 'short'];
const OBJECTIVE_WASH_TYPES: WashQuestionType[] = ['choice', 'multi', 'tf'];
const WASH_TYPE_OPTIONS: { value: WashQuestionType; label: string }[] = [
  { value: 'choice', label: '单选' },
  { value: 'multi', label: '多选' },
  { value: 'tf', label: '判断' },
  { value: 'short', label: '简答' },
];

interface PendingJsonIntercept {
  rawText: string;
  fileName?: string;
  parseResult: ImportParseResult;
  trigger: 'paste' | 'drop' | 'wash';
}

const PAGE_STEP = 50;
const MAX_OPTIONS = 8;

function stopShortcutBubble(e: React.KeyboardEvent) {
  e.stopPropagation();
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function getDraftWashBatchIndex(draft: DraftQuestion): number | null {
  const match = draft.sourceLoc.match(/第\s*(\d+)\s*批/);
  if (!match) return null;
  const oneBased = Number.parseInt(match[1]!, 10);
  return Number.isInteger(oneBased) && oneBased > 0 ? oneBased - 1 : null;
}

function mergeRetriedChunkDrafts(
  existingDrafts: DraftQuestion[],
  chunkIndex: number,
  recovered: DraftQuestion[],
): DraftQuestion[] {
  if (recovered.length === 0) return existingDrafts;
  const insertPos = existingDrafts.findIndex((draft) => {
    const batchIdx = getDraftWashBatchIndex(draft);
    return batchIdx !== null && batchIdx > chunkIndex;
  });
  const combined =
    insertPos === -1
      ? [...existingDrafts, ...recovered]
      : [
          ...existingDrafts.slice(0, insertPos),
          ...recovered,
          ...existingDrafts.slice(insertPos),
        ];
  return annotateDuplicateStems(combined);
}

function parseTagsInput(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(/[,，、;；\n]+/)) {
    const cleaned = part.trim();
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      tags.push(cleaned);
    }
  }
  return tags;
}

export function ImportWorkbench({
  existingBanks = [],
  onCommit,
  onCommitBank,
  notify,
}: ImportWorkbenchProps) {
  const scope = usePracticeScope();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bankNameDirtyRef = useRef(false);
  const pendingPasteDetectRef = useRef(false);

  const customBanks = useMemo(
    () => existingBanks.filter((b) => !b.builtin),
    [existingBanks],
  );

  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => loadApiConfig(scope));
  useEffect(() => {
    setApiConfig(loadApiConfig(scope));
    return subscribeApiConfig(setApiConfig, scope);
  }, [scope]);

  const apiReady = isApiConfigReady(apiConfig);

  const [inputMode, setInputMode] = useState<'file' | 'paste'>('file');
  const [dragging, setDragging] = useState(false);
  const [pasteDragging, setPasteDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [washSourceText, setWashSourceText] = useState('');
  const [washSourceFileName, setWashSourceFileName] = useState('');

  const [targetBankMode, setTargetBankMode] = useState<'new' | 'existing'>('new');
  const [targetBankId, setTargetBankId] = useState<string>('');
  const [autoFillExplain, setAutoFillExplain] = useState(true);
  const [autoTag, setAutoTag] = useState(true);
  const [selectedWashTypes, setSelectedWashTypes] = useState<WashQuestionType[]>(() => [
    ...ALL_WASH_TYPES,
  ]);
  const [pendingJsonIntercept, setPendingJsonIntercept] =
    useState<PendingJsonIntercept | null>(null);
  const [bypassedJsonText, setBypassedJsonText] = useState<string | null>(null);

  const [washing, setWashing] = useState(false);
  const [washProgress, setWashProgress] = useState<WashProgressEvent | null>(null);
  const [failedChunks, setFailedChunks] = useState<FailedWashChunk[]>([]);
  const [retryingChunkIndex, setRetryingChunkIndex] = useState<number | null>(null);
  const [washConfigError, setWashConfigError] = useState<string | null>(null);

  const toggleWashType = (type: WashQuestionType) => {
    setSelectedWashTypes((prev) =>
      prev.includes(type)
        ? prev.filter((t) => t !== type)
        : ALL_WASH_TYPES.filter((t) => t === type || prev.includes(t)),
    );
  };

  const [parseResult, setParseResult] = useState<ImportParseResult | null>(null);
  const [bankName, setBankName] = useState('');
  const [bankDesc, setBankDesc] = useState('');
  const [drafts, setDrafts] = useState<DraftQuestion[]>([]);
  const [filterIssuesOnly, setFilterIssuesOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formulaPreviewIds, setFormulaPreviewIds] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);
  const [committing, setCommitting] = useState(false);

  const toggleFormulaPreview = (tempId: string) => {
    setFormulaPreviewIds((prev) => ({ ...prev, [tempId]: !prev[tempId] }));
  };

  const canAppendExisting = Boolean(onCommit) && customBanks.length > 0;
  const effectiveTargetBankMode: 'new' | 'existing' =
    targetBankMode === 'existing' && canAppendExisting ? 'existing' : 'new';

  const effectiveTargetBank = useMemo(() => {
    if (customBanks.length === 0) return null;
    return customBanks.find((b) => b.id === targetBankId) ?? customBanks[0] ?? null;
  }, [customBanks, targetBankId]);

  useEffect(() => {
    if (apiReady && washConfigError) {
      setWashConfigError(null);
    }
  }, [apiReady, washConfigError]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const applyParseResult = (
    res: ImportParseResult,
    options?: { suppressZeroDraftToast?: boolean },
  ) => {
    pendingPasteDetectRef.current = false;
    setPendingJsonIntercept(null);
    setBypassedJsonText(null);
    setParseResult(res);
    if (res.suggestedName) {
      setBankName((prev) =>
        bankNameDirtyRef.current && prev.trim() ? prev : res.suggestedName,
      );
    }
    setBankDesc(res.suggestedDescription ?? '');
    setDrafts(res.drafts);
    setFilterIssuesOnly(false);
    setEditingId(null);
    setFormulaPreviewIds({});
    setVisibleCount(PAGE_STEP);
    setFailedChunks([]);
    setWashProgress(null);

    if (res.fatalError) {
      notify(res.fatalError, 'error');
    } else if (res.drafts.length > 0) {
      notify(`已解析 ${res.drafts.length} 道题目，请确认预览后导入`, 'success');
    } else if (!options?.suppressZeroDraftToast) {
      notify('未能从内容中直接拆出标准题目，可点击「开始 AI 洗题」智能识别', 'info');
    }
  };

  const handleSelectedFile = async (file: File, targetArea: 'file' | 'paste' = 'file') => {
    pendingPasteDetectRef.current = false;
    setPendingJsonIntercept(null);
    setBypassedJsonText(null);
    const fileName = file.name || '未命名文件';
    const lower = fileName.toLowerCase();
    const isTextLike =
      lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.markdown');
    const isJson = lower.endsWith('.json');

    setParsing(true);
    try {
      if (isTextLike || isJson) {
        const buffer = await file.arrayBuffer();
        const decoded = decodeTextBuffer(buffer);
        setWashSourceText(decoded);
        setWashSourceFileName(fileName);
        if (targetArea === 'paste') {
          setPasteText(decoded);
        }
      } else {
        setWashSourceText('');
        setWashSourceFileName('');
      }

      const res = await parseImportFile(file);
      if (isTextLike && res.drafts.length === 0 && !res.fatalError) {
        setParseResult(res);
        setBankName((prev) => prev.trim() || res.suggestedName);
        setBankDesc(res.suggestedDescription ?? '');
        setDrafts([]);
        setFailedChunks([]);
        notify(`已加载文件《${fileName}》，点击「开始 AI 洗题」即可智能识别题目`, 'info');
      } else {
        applyParseResult(res);
      }
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
    await handleSelectedFile(file, 'file');
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleSelectedFile(file, 'file');
    }
  };

  const handlePasteDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setPasteDragging(false);
    pendingPasteDetectRef.current = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      const lower = (file.name || '').toLowerCase();
      const isTextOrJson =
        lower.endsWith('.json') ||
        lower.endsWith('.txt') ||
        lower.endsWith('.md') ||
        lower.endsWith('.markdown') ||
        file.type === 'application/json' ||
        file.type.startsWith('text/');
      if (isTextOrJson) {
        try {
          const decoded = normalizeLineEndings(
            typeof file.arrayBuffer === 'function'
              ? decodeTextBuffer(await file.arrayBuffer())
              : await file.text(),
          );
          const detected = detectStandardQuizJson(decoded, file.name);
          if (detected) {
            setPasteText(decoded);
            setWashSourceText(decoded);
            setWashSourceFileName(file.name || '');
            setBypassedJsonText(null);
            setPendingJsonIntercept({
              rawText: decoded,
              fileName: file.name || undefined,
              parseResult: detected,
              trigger: 'drop',
            });
            return;
          }
        } catch {
          // fallback to standard file handler
        }
      }
      await handleSelectedFile(file, 'paste');
      return;
    }
    const droppedText = normalizeLineEndings(
      e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('text') || '',
    );
    if (droppedText) {
      setPasteText(droppedText);
      setBypassedJsonText(null);
      const detected = detectStandardQuizJson(droppedText);
      setPendingJsonIntercept(
        detected
          ? {
              rawText: droppedText,
              parseResult: detected,
              trigger: 'drop',
            }
          : null,
      );
    }
  };

  const handlePasteTextChange = (nextVal: string) => {
    const normalizedNext = normalizeLineEndings(nextVal);
    const normalizedBypass =
      bypassedJsonText !== null ? normalizeLineEndings(bypassedJsonText) : null;
    setPasteText(normalizedNext);
    setBypassedJsonText((prev) =>
      prev !== null && normalizeLineEndings(prev) !== normalizedNext ? null : prev,
    );

    if (pendingPasteDetectRef.current) {
      pendingPasteDetectRef.current = false;
      if (!normalizedNext.trim() || normalizedBypass === normalizedNext) {
        setPendingJsonIntercept(null);
        return;
      }
      const detected = detectStandardQuizJson(normalizedNext);
      setPendingJsonIntercept(
        detected
          ? {
              rawText: normalizedNext,
              parseResult: detected,
              trigger: 'paste',
            }
          : null,
      );
      return;
    }

    setPendingJsonIntercept((prev) =>
      prev && normalizeLineEndings(prev.rawText) !== normalizedNext ? null : prev,
    );
  };

  const handleTextareaPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const rawPasted =
      e.clipboardData?.getData('text/plain') || e.clipboardData?.getData('text') || '';
    if (!rawPasted) {
      pendingPasteDetectRef.current = true;
      return;
    }

    pendingPasteDetectRef.current = false;
    const pasted = normalizeLineEndings(rawPasted);
    const target = e.currentTarget;
    const currentVal = normalizeLineEndings(target.value ?? pasteText);
    const start = target.selectionStart ?? currentVal.length;
    const end = target.selectionEnd ?? currentVal.length;
    const nextText = `${currentVal.slice(0, start)}${pasted}${currentVal.slice(end)}`;

    if (
      !nextText.trim() ||
      (bypassedJsonText !== null && normalizeLineEndings(bypassedJsonText) === nextText)
    ) {
      return;
    }
    const detected = detectStandardQuizJson(nextText);
    if (detected) {
      setPendingJsonIntercept({
        rawText: nextText,
        parseResult: detected,
        trigger: 'paste',
      });
    }
  };

  const handleJsonInterceptDirectImport = () => {
    if (!pendingJsonIntercept) return;
    pendingPasteDetectRef.current = false;
    const { parseResult: detectedResult } = pendingJsonIntercept;
    setPendingJsonIntercept(null);
    setBypassedJsonText(null);
    applyParseResult(detectedResult);
  };

  const handleJsonInterceptUseAi = () => {
    if (!pendingJsonIntercept) return;
    pendingPasteDetectRef.current = false;
    const { rawText, trigger } = pendingJsonIntercept;
    setBypassedJsonText(normalizeLineEndings(rawText));
    setPendingJsonIntercept(null);
    if (trigger === 'wash') {
      void handleAiWash({ bypassIntercept: true });
    }
  };

  const handleParsePaste = () => {
    pendingPasteDetectRef.current = false;
    const res = parsePastedContent(pasteText);
    applyParseResult(res);
  };

  const getActiveWashSource = (): { sourceText: string; sourceFile?: string } => {
    if (inputMode === 'paste') {
      return { sourceText: pasteText };
    }
    if (washSourceText.trim()) {
      return {
        sourceText: washSourceText,
        sourceFile: washSourceFileName || undefined,
      };
    }
    if (pasteText.trim()) {
      return { sourceText: pasteText };
    }
    return { sourceText: '' };
  };

  const handleAiWash = async (washOptions?: { bypassIntercept?: boolean }) => {
    if (washing || parsing || selectedWashTypes.length === 0) return;

    const { sourceText, sourceFile } = getActiveWashSource();
    if (!sourceText.trim()) {
      notify('请先粘贴文本或上传 .txt / .md 文件后再开始 AI 洗题', 'error');
      return;
    }

    const normalizedSource = normalizeLineEndings(sourceText);
    const shouldBypass =
      washOptions?.bypassIntercept === true ||
      (bypassedJsonText !== null && normalizeLineEndings(bypassedJsonText) === normalizedSource);
    if (!shouldBypass) {
      const detected = detectStandardQuizJson(normalizedSource, sourceFile);
      if (detected) {
        setPendingJsonIntercept({
          rawText: normalizedSource,
          fileName: sourceFile,
          parseResult: detected,
          trigger: 'wash',
        });
        return;
      }
    }

    const liveConfig = loadApiConfig(scope);
    if (!isApiConfigReady(liveConfig)) {
      const msg = '尚未配置 AI API Key 或模型接口地址，请先前往 API 设置完成配置。';
      setWashConfigError(msg);
      notify(msg, 'error');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setWashConfigError(null);
    setWashing(true);
    setDrafts([]);
    setParseResult(null);
    setFailedChunks([]);
    setFilterIssuesOnly(false);
    setEditingId(null);
    setVisibleCount(PAGE_STEP);
    setWashProgress({
      completedChunks: 0,
      totalChunks: 1,
      statusText: '正在准备 AI 洗题任务...',
      draftsSoFar: [],
      failedChunks: [],
    });

    const fallbackName = sourceFile
      ? suggestBankNameFromFile(sourceFile, 'AI 智能洗题题库')
      : 'AI 智能洗题题库';

    try {
      const res = await washQuestionsChunked(
        sourceText,
        {
          practiceScope: scope,
          allowedTypes: selectedWashTypes,
          autoFillExplain,
          autoTag,
          sourceFile,
          signal: controller.signal,
        },
        {
          onProgress: (ev) => {
            if (controller.signal.aborted || abortRef.current !== controller) return;
            setWashProgress(ev);
            setFailedChunks(ev.failedChunks);
            if (ev.draftsSoFar.length > 0) {
              setDrafts(ev.draftsSoFar);
              setParseResult((prev) => ({
                format: 'txt',
                suggestedName: prev?.suggestedName || fallbackName,
                drafts: ev.draftsSoFar,
                notes: [`AI 洗题正在识别（${ev.statusText}）`],
              }));
            }
          },
        },
      );

      if (abortRef.current !== controller) {
        return;
      }

      if (res.cancelled || controller.signal.aborted) {
        if (res.drafts.length > 0) {
          setDrafts(res.drafts);
          setParseResult({
            format: 'txt',
            suggestedName: bankName.trim() || fallbackName,
            drafts: res.drafts,
            notes: [`AI 洗题已取消，保留已识别的 ${res.drafts.length} 道题目`],
          });
        }
        notify('已取消 AI 洗题', 'info');
        return;
      }

      setFailedChunks(res.failedChunks);
      if (res.drafts.length > 0 || res.failedChunks.length > 0) {
        setDrafts(res.drafts);
        setBankName((prev) => (prev.trim() ? prev : fallbackName));
        setParseResult({
          format: 'txt',
          suggestedName: bankName.trim() || fallbackName,
          drafts: res.drafts,
          notes:
            res.failedChunks.length > 0
              ? [
                  `AI 洗题完成 ${res.totalChunks - res.failedChunks.length}/${res.totalChunks} 批，${res.failedChunks.length} 批失败可单独重试`,
                ]
              : [`AI 智能洗题完成，共提取 ${res.drafts.length} 道标准化题目`],
        });
      }

      if (res.failedChunks.length > 0) {
        notify(
          `部分批次识别失败（${res.failedChunks.length}/${res.totalChunks} 批），请点击重试`,
          'error',
        );
      } else if (res.drafts.length > 0) {
        notify(`AI 洗题完成，共识别 ${res.drafts.length} 道题目`, 'success');
      } else {
        notify('AI 未能从文本中识别出有效题目，请补充更完整的题目内容', 'info');
      }
    } catch (err) {
      if (
        controller.signal.aborted ||
        (err instanceof ApiClientError && err.code === 'ABORTED')
      ) {
        notify('已取消 AI 洗题', 'info');
        return;
      }
      if (
        err instanceof ApiClientError &&
        (err.code === 'NOT_CONFIGURED' || err.code === 'INVALID_URL')
      ) {
        setWashConfigError(err.userMessage);
        notify(err.userMessage, 'error');
        return;
      }
      notify(
        `AI 洗题失败：${err instanceof ApiClientError ? err.userMessage : err instanceof Error ? err.message : '请稍后重试'}`,
        'error',
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setWashing(false);
        setWashProgress(null);
      }
    }
  };

  const handleCancelWash = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setWashing(false);
    setWashProgress(null);
    notify('已取消 AI 洗题', 'info');
  };

  const handleRetryChunk = async (chunk: FailedWashChunk) => {
    if (washing || retryingChunkIndex !== null || selectedWashTypes.length === 0) return;

    const liveConfig = loadApiConfig(scope);
    if (!isApiConfigReady(liveConfig)) {
      const msg = '尚未配置 AI API Key 或模型接口地址，请先前往 API 设置完成配置。';
      setWashConfigError(msg);
      notify(msg, 'error');
      return;
    }

    setWashConfigError(null);
    setRetryingChunkIndex(chunk.chunkIndex);
    try {
      const recovered = await retryWashChunk(chunk, {
        practiceScope: scope,
        allowedTypes: selectedWashTypes,
        autoFillExplain,
        autoTag,
        sourceFile: washSourceFileName || undefined,
      });

      const nextFailed = failedChunks.filter((c) => c.chunkIndex !== chunk.chunkIndex);
      setFailedChunks(nextFailed);

      const merged = mergeRetriedChunkDrafts(drafts, chunk.chunkIndex, recovered);
      setDrafts(merged);

      const fallbackName = washSourceFileName
        ? suggestBankNameFromFile(washSourceFileName, 'AI 智能洗题题库')
        : 'AI 智能洗题题库';
      setBankName((prev) => (prev.trim() ? prev : fallbackName));
      setParseResult((prev) => ({
        format: prev?.format ?? 'txt',
        suggestedName: prev?.suggestedName || bankName.trim() || fallbackName,
        drafts: merged,
        notes:
          nextFailed.length > 0
            ? [`已重试恢复第 ${chunk.chunkIndex + 1} 批（新增 ${recovered.length} 题），仍有 ${nextFailed.length} 批待重试`]
            : [`全部批次已恢复，共提取 ${merged.length} 道题目`],
      }));

      notify(`第 ${chunk.chunkIndex + 1} 批重试成功，恢复 ${recovered.length} 道题目`, 'success');
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        (err.code === 'NOT_CONFIGURED' || err.code === 'INVALID_URL')
      ) {
        setWashConfigError(err.userMessage);
        notify(err.userMessage, 'error');
        return;
      }
      const errMsg =
        err instanceof ApiClientError
          ? err.userMessage
          : err instanceof Error
            ? err.message
            : '重试失败';
      setFailedChunks((prev) =>
        prev.map((c) =>
          c.chunkIndex === chunk.chunkIndex ? { ...c, errorMessage: errMsg } : c,
        ),
      );
      notify(`第 ${chunk.chunkIndex + 1} 批重试失败：${errMsg}`, 'error');
    } finally {
      setRetryingChunkIndex(null);
    }
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

  const handleDeleteDraft = (tempId: string) => {
    setDrafts((prev) => annotateDuplicateStems(prev.filter((d) => d.tempId !== tempId)));
    setEditingId((cur) => (cur === tempId ? null : cur));
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
    if (summary.validIncluded === 0 || summary.errorIncluded > 0 || committing || washing) {
      return;
    }
    setCommitting(true);
    try {
      if (effectiveTargetBankMode === 'existing' && effectiveTargetBank && onCommit) {
        await onCommit({
          mode: 'existing',
          targetBankId: effectiveTargetBank.id,
          drafts,
          sourceFormat: parseResult?.format,
        });
      } else {
        const finalized = finalizeDraftsToBank(drafts, {
          name: bankName,
          description: bankDesc,
          sourceFormat: parseResult?.format,
        });
        if (onCommit) {
          await onCommit({ mode: 'new', input: finalized });
        } else if (onCommitBank) {
          await onCommitBank(finalized);
        }
      }

      setParseResult(null);
      setDrafts([]);
      setPasteText('');
      setWashSourceText('');
      setWashSourceFileName('');
      setPendingJsonIntercept(null);
      setBypassedJsonText(null);
      pendingPasteDetectRef.current = false;
      setWashProgress(null);
      setFailedChunks([]);
      setBankName('');
      setBankDesc('');
      bankNameDirtyRef.current = false;
    } catch (err) {
      notify(
        `入库失败：${err instanceof Error ? err.message : '请稍后重试'}`,
        'error',
      );
    } finally {
      setCommitting(false);
    }
  };

  const filteredDraftEntries = useMemo(() => {
    return drafts
      .map((draft, origIndex) => ({ draft, origIndex }))
      .filter(({ draft }) => (filterIssuesOnly ? draft.issues.length > 0 : true));
  }, [drafts, filterIssuesOnly]);

  const visibleEntries = filteredDraftEntries.slice(0, visibleCount);
  const showPreviewPane =
    Boolean(parseResult) || drafts.length > 0 || washing || failedChunks.length > 0;
  const progressPct =
    washProgress && washProgress.totalChunks > 0
      ? Math.min(
          100,
          Math.round((washProgress.completedChunks / washProgress.totalChunks) * 100),
        )
      : 0;

  return (
    <div className="qi-workbench">
      {/* Left Pane: Source Input, Target Bank & AI Wash Config */}
      <div className="qi-workbench__input">
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
                粘贴文本 / Markdown / JSON
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
                拖拽或选择文件上传；结构化题库立即预览，杂乱文本 / Markdown 可直接发起 AI 智能洗题
              </span>
              {washSourceFileName && (
                <span className="qi-pill qi-pill--brand">
                  已加载文本文件：{washSourceFileName}
                </span>
              )}
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
                disabled={parsing || washing}
                onClick={() => fileInputRef.current?.click()}
              >
                {parsing ? '正在加载解析器并拆题…' : '选择本地文件导入'}
              </button>
              <div className="qi-template-links">
                <span className="qi-template-links__label">格式参考：</span>
                <button
                  type="button"
                  data-testid="btn-download-xlsx-tpl"
                  className="qi-text-link"
                  onClick={() => {
                    void downloadExcelTemplate().then(() => {
                      notify('已下载标准 Excel 导入模板（quizhub-template.xlsx）', 'success');
                    });
                  }}
                >
                  下载 Excel 模板
                </button>
                <span className="qi-template-links__sep" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  data-testid="btn-download-txt-tpl"
                  className="qi-text-link"
                  onClick={() => {
                    downloadTxtTemplate();
                    notify('已下载标准 TXT 导入模板（quizhub-template.txt）', 'success');
                  }}
                >
                  下载 TXT 模板
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`qi-field qi-paste-dropwrap${pasteDragging ? ' is-dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setPasteDragging(true);
              }}
              onDragLeave={() => setPasteDragging(false)}
              onDrop={handlePasteDrop}
            >
              <label className="qi-field__label" htmlFor="qi-paste-area">
                粘贴任意杂乱试题文本 / Markdown / JSON（亦支持直接拖入 .txt / .md / .json 文件）
              </label>
              <textarea
                id="qi-paste-area"
                data-testid="import-paste-textarea"
                className="qi-textarea"
                placeholder={`可粘贴杂乱无规律网页试题、课堂笔记，或标准格式：\n1. HTTP 默认端口是？\nA. 21  B. 80  C. 443\n答案：B`}
                value={pasteText}
                onChange={(e) => handlePasteTextChange(e.target.value)}
                onPaste={handleTextareaPaste}
                onKeyDown={stopShortcutBubble}
              />
              <div className="qi-btn-group">
                <button
                  type="button"
                  data-testid="btn-parse-paste"
                  className="qi-btn"
                  disabled={washing}
                  onClick={handleParsePaste}
                >
                  本地规则解析预览
                </button>
                {pasteText.length > 0 && (
                  <button
                    type="button"
                    className="qi-btn qi-btn--sm"
                    disabled={washing}
                    onClick={() => {
                      pendingPasteDetectRef.current = false;
                      setPasteText('');
                      setPendingJsonIntercept(null);
                      setBypassedJsonText(null);
                    }}
                  >
                    清空文本框
                  </button>
                )}
              </div>
            </div>
          )}

          {pendingJsonIntercept && (
            <div
              data-testid="json-intercept-banner"
              className="qi-json-intercept"
              role="alert"
            >
              <div className="qi-json-intercept__text">
                <strong>检测到这已经是标准题库格式，是否跳过 AI 消耗直接秒导？</strong>
                <span>
                  本地已识别 {pendingJsonIntercept.parseResult.drafts.length} 道标准题目，直接导入零 API 请求、零 Token 消耗。
                </span>
              </div>
              <div className="qi-json-intercept__actions">
                <button
                  type="button"
                  data-testid="json-intercept-direct-btn"
                  className="qi-btn qi-btn--sm qi-btn--primary"
                  onClick={handleJsonInterceptDirectImport}
                >
                  直接导入
                </button>
                <button
                  type="button"
                  data-testid="json-intercept-ai-btn"
                  className="qi-btn qi-btn--sm"
                  onClick={handleJsonInterceptUseAi}
                >
                  仍用 AI 洗题
                </button>
              </div>
            </div>
          )}

          {/* Target Bank & AI Wash Preferences */}
          <div className="qi-wash-config">
            <div className="qi-grid-two">
              <label className="qi-field">
                <span className="qi-field__label">导入目标方式</span>
                <select
                  data-testid="wash-target-bank-mode"
                  className="qi-select"
                  value={effectiveTargetBankMode}
                  disabled={washing}
                  onChange={(e) =>
                    setTargetBankMode(e.target.value === 'existing' ? 'existing' : 'new')
                  }
                >
                  <option value="new">新建独立题库</option>
                  <option value="existing" disabled={!canAppendExisting}>
                    追加到已有题库
                    {customBanks.length === 0
                      ? '（暂无自定义题库）'
                      : !onCommit
                        ? '（当前模式不支持追加）'
                        : ''}
                  </option>
                </select>
              </label>

              {effectiveTargetBankMode === 'new' ? (
                <label className="qi-field">
                  <span className="qi-field__label">目标题库名称</span>
                  <input
                    type="text"
                    data-testid="wash-target-bank-name"
                    className="qi-input"
                    placeholder="例如：操作系统期末复习"
                    value={bankName}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      bankNameDirtyRef.current = nextVal.trim().length > 0;
                      setBankName(nextVal);
                    }}
                    onKeyDown={stopShortcutBubble}
                  />
                </label>
              ) : (
                <label className="qi-field">
                  <span className="qi-field__label">选择已有自定义题库</span>
                  <select
                    data-testid="wash-target-existing-bank"
                    className="qi-select"
                    value={effectiveTargetBank?.id ?? ''}
                    disabled={washing}
                    onChange={(e) => setTargetBankId(e.target.value)}
                  >
                    {customBanks.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.name}（{bank.data.questions.length} 题）
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="qi-wash-prefs">
              <label className="qi-checkbox-label">
                <input
                  type="checkbox"
                  data-testid="wash-pref-explain"
                  checked={autoFillExplain}
                  disabled={washing}
                  onChange={(e) => setAutoFillExplain(e.target.checked)}
                />
                <span>自动补全缺失解析</span>
              </label>
              <label className="qi-checkbox-label">
                <input
                  type="checkbox"
                  data-testid="wash-pref-tags"
                  checked={autoTag}
                  disabled={washing}
                  onChange={(e) => setAutoTag(e.target.checked)}
                />
                <span>自动归类标签</span>
              </label>
            </div>

            <div className="qi-wash-types">
              <div className="qi-wash-types__head">
                <span className="qi-field__label">允许洗出题型</span>
                <button
                  type="button"
                  data-testid="wash-type-objective-btn"
                  className="qi-btn qi-btn--sm"
                  disabled={washing}
                  onClick={() => setSelectedWashTypes([...OBJECTIVE_WASH_TYPES])}
                >
                  仅选客观题
                </button>
              </div>
              <div className="qi-wash-types__list">
                {WASH_TYPE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="qi-checkbox-label">
                    <input
                      type="checkbox"
                      data-testid={`wash-type-${opt.value}`}
                      checked={selectedWashTypes.includes(opt.value)}
                      disabled={washing}
                      onChange={() => toggleWashType(opt.value)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
              {selectedWashTypes.length === 0 && (
                <div
                  data-testid="wash-type-guard-hint"
                  className="qi-wash-type-hint"
                  role="status"
                >
                  请至少选择 1 种题型
                </div>
              )}
            </div>

            {(!apiReady || washConfigError) && (
              <div className="qi-config-guard" role="alert">
                <span className="qi-config-guard__text">
                  {washConfigError ??
                    '尚未配置 AI 模型 API Key 或接口地址，配置后即可使用「AI 智能洗题」自动清洗非结构化试题。'}
                </span>
                <button
                  type="button"
                  data-testid="ai-open-settings-inline"
                  className="qi-btn qi-btn--sm qi-btn--primary"
                  onClick={() => requestOpenApiSettings()}
                >
                  打开 API 设置
                </button>
              </div>
            )}

            <div className="qi-wash-actions">
              <button
                type="button"
                data-testid="ai-wash-btn"
                className="qi-btn qi-btn--primary qi-wash-cta"
                disabled={washing || parsing || selectedWashTypes.length === 0}
                onClick={() => void handleAiWash()}
              >
                {washing ? (
                  'AI 正在分段洗题…'
                ) : (
                  <>
                    <Icon name="sparkles" size={15} />
                    <span>开始 AI 洗题</span>
                  </>
                )}
              </button>
              {washing && (
                <button
                  type="button"
                  data-testid="ai-wash-cancel"
                  className="qi-btn qi-btn--danger"
                  onClick={handleCancelWash}
                >
                  取消洗题
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right Pane: Washing Progress, Failed Chunk Retry, Draft Cards & Sticky Confirm */}
      <div className="qi-workbench__preview">
        {washing && washProgress && (
          <div data-testid="ai-wash-progress" className="qi-card qi-wash-progress">
            <div className="qi-toolbar">
              <strong style={{ fontSize: '14px' }}>{washProgress.statusText}</strong>
              <span className="qi-pill qi-pill--brand">{progressPct}%</span>
            </div>
            <div className="qi-progress-track" aria-hidden="true">
              <div className="qi-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <span style={{ fontSize: '12.5px', color: 'var(--sub)' }}>
              长文本已自动分段处理，已识别 {washProgress.draftsSoFar.length} 道题目将实时显示在下方预览区
            </span>
          </div>
        )}

        {failedChunks.length > 0 && (
          <div className="qi-card qi-failed-chunks" role="alert">
            <strong style={{ fontSize: '14px', color: 'var(--bad-text)' }}>
              部分分段洗题失败（{failedChunks.length} 批），可单独重试恢复：
            </strong>
            <div className="qi-draft-list">
              {failedChunks.map((chunk) => (
                <div key={chunk.chunkIndex} className="qi-failed-chunk-item">
                  <div className="qi-failed-chunk-item__info">
                    <strong>
                      第 {chunk.chunkIndex + 1}/{chunk.totalChunks} 批失败
                    </strong>
                    <span>{chunk.errorMessage}</span>
                  </div>
                  <button
                    type="button"
                    data-testid={`ai-wash-retry-chunk-${chunk.chunkIndex}`}
                    className="qi-btn qi-btn--sm qi-btn--warn"
                    disabled={
                      washing ||
                      retryingChunkIndex !== null ||
                      selectedWashTypes.length === 0
                    }
                    onClick={() => void handleRetryChunk(chunk)}
                  >
                    {retryingChunkIndex === chunk.chunkIndex
                      ? '重试中…'
                      : `重试第 ${chunk.chunkIndex + 1} 批`}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!showPreviewPane && (
          <div className="qi-card qi-preview-placeholder">
            <strong style={{ fontSize: '15px' }}>清洗预览与校对台</strong>
            <span style={{ fontSize: '13.5px', color: 'var(--sub)', lineHeight: 1.6 }}>
              在左侧上传题库文件或粘贴任意格式试题文本，点击「开始 AI 洗题」或「本地规则解析预览」，洗出的题目将渲染为可编辑预览卡片（无答案题干自动推导并标注“AI 推断答案”）。
            </span>
          </div>
        )}

        {showPreviewPane && (
          <div data-testid="import-preview" className="qi-card">
            <div className="qi-toolbar">
              <div>
                <h3 style={{ margin: 0, fontSize: '16px' }}>导入前可视化预览与校对</h3>
                <span style={{ fontSize: '12.5px', color: 'var(--sub)' }}>
                  支持直接在卡片上修改题干、增删选项、切换正确答案、编辑标签与删题
                </span>
              </div>
              <button
                type="button"
                data-testid="btn-cancel-import"
                className="qi-btn qi-btn--sm"
                disabled={washing}
                onClick={() => {
                  setParseResult(null);
                  setDrafts([]);
                  setFailedChunks([]);
                  setWashProgress(null);
                }}
              >
                放弃本次预览
              </button>
            </div>

            {parseResult?.fatalError && (
              <div className="qi-toast qi-toast--error">{parseResult.fatalError}</div>
            )}

            {parseResult && parseResult.notes.length > 0 && (
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
                {effectiveTargetBankMode === 'new' ? (
                  <div className="qi-grid-two">
                    <label className="qi-field">
                      <span className="qi-field__label">新题库名称</span>
                      <input
                        type="text"
                        data-testid="import-bank-name"
                        className="qi-input"
                        value={bankName}
                        onChange={(e) => {
                          const nextVal = e.target.value;
                          bankNameDirtyRef.current = nextVal.trim().length > 0;
                          setBankName(nextVal);
                        }}
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
                ) : (
                  <div className="qi-toast">
                    将追加 {summary.validIncluded} 道有效题目到已有题库：
                    <strong>《{effectiveTargetBank?.name}》</strong>
                    （当前 {effectiveTargetBank?.data.questions.length ?? 0} 题）
                  </div>
                )}

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

                <div data-testid="draft-list-container" className="qi-draft-list">
                  {visibleEntries.map(({ draft, origIndex }) => {
                    const hasErr = draft.issues.some((i) => i.severity === 'error');
                    const hasWarn = draft.issues.some((i) => i.severity === 'warning');
                    const severity = hasErr ? 'error' : hasWarn ? 'warning' : 'ok';
                    const isEditing = editingId === draft.tempId;
                    const isFormulaPreviewOpen = Boolean(formulaPreviewIds[draft.tempId]);

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
                            {draft.aiInferredAnswer === true && (
                              <span
                                data-testid={`draft-ai-inferred-${origIndex}`}
                                className="qi-pill qi-pill--warn"
                              >
                                AI 推断答案
                              </span>
                            )}
                            {draft.tags.map((tag, tIdx) => (
                              <span key={tIdx} className="qi-pill qi-pill--tag">
                                #{tag}
                              </span>
                            ))}
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
                                setEditingId((cur) =>
                                  cur === draft.tempId ? null : draft.tempId,
                                )
                              }
                            >
                              {isEditing ? '收起编辑' : '修正'}
                            </button>
                            <button
                              type="button"
                              data-testid={`draft-delete-${origIndex}`}
                              className="qi-btn qi-btn--sm qi-btn--danger"
                              onClick={() => handleDeleteDraft(draft.tempId)}
                            >
                              删除
                            </button>
                          </div>
                        </div>

                        <div className="qi-draft-stem">
                          {draft.stem.trim() ? draft.stem : '（空题干）'}
                        </div>

                        {draft.options.length > 0 && (
                          <div className="qi-draft-options">
                            {draft.options
                              .map((opt, oIdx) => `${getOptionLabel(oIdx)}. ${opt}`)
                              .join('  |  ')}
                          </div>
                        )}

                        <div className="qi-draft-answer">
                          <strong>当前答案：</strong>
                          {formatDraftRawAnswer(draft.type, draft.answer) ||
                            draft.rawAnswer ||
                            '（未设置）'}
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
                            <div className="qi-draft-editor__bar">
                              <span className="qi-field__label">编辑草稿内容</span>
                              <button
                                type="button"
                                data-testid={`draft-formula-preview-toggle-${origIndex}`}
                                className={`qi-btn qi-btn--sm qi-formula-toggle${isFormulaPreviewOpen ? ' qi-btn--primary' : ''}`}
                                aria-pressed={isFormulaPreviewOpen}
                                onClick={() => toggleFormulaPreview(draft.tempId)}
                              >
                                {isFormulaPreviewOpen ? '隐藏公式预览' : '公式预览'}
                              </button>
                            </div>
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
                                    const info = extractChapterInfo(
                                      e.target.value,
                                      draft.chapter || 1,
                                    );
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
                                <div className="qi-toolbar">
                                  <span className="qi-field__label">选项与正确答案勾选</span>
                                  {draft.options.length < MAX_OPTIONS && (
                                    <button
                                      type="button"
                                      data-testid={`draft-add-opt-${origIndex}`}
                                      className="qi-btn qi-btn--sm"
                                      onClick={() =>
                                        updateDraft(draft.tempId, (d) => ({
                                          ...d,
                                          options: [
                                            ...d.options,
                                            `选项 ${getOptionLabel(d.options.length)}`,
                                          ],
                                        }))
                                      }
                                    >
                                      + 添加选项
                                    </button>
                                  )}
                                </div>
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
                                        className={`qi-btn qi-btn--sm qi-opt-badge${isChecked ? ' qi-btn--primary' : ''}`}
                                        aria-pressed={isChecked}
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
                                        <span className="qi-opt-badge__label">
                                          {getOptionLabel(optIdx)}
                                        </span>
                                        {isChecked && (
                                          <span
                                            className="qi-opt-badge__check"
                                            aria-hidden="true"
                                          >
                                            <Icon name="check" size={12} strokeWidth={2.5} />
                                          </span>
                                        )}
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
                                      {draft.options.length > 2 && (
                                        <button
                                          type="button"
                                          data-testid={`draft-remove-opt-${origIndex}-${optIdx}`}
                                          className="qi-btn qi-btn--sm qi-btn--danger qi-opt-remove"
                                          aria-label={`移除选项 ${getOptionLabel(optIdx)}`}
                                          onClick={() =>
                                            updateDraft(draft.tempId, (d) => {
                                              const nextOpts = d.options.filter(
                                                (_, i) => i !== optIdx,
                                              );
                                              if (d.type === 'choice') {
                                                let nextAns =
                                                  typeof d.answer === 'number' ? d.answer : -1;
                                                if (nextAns === optIdx) nextAns = -1;
                                                else if (nextAns > optIdx) nextAns -= 1;
                                                return {
                                                  ...d,
                                                  options: nextOpts,
                                                  answer: nextAns,
                                                  rawAnswer:
                                                    nextAns >= 0
                                                      ? formatDraftRawAnswer('choice', nextAns)
                                                      : '',
                                                };
                                              }
                                              const prevArr = Array.isArray(d.answer)
                                                ? d.answer
                                                : [];
                                              const nextArr = prevArr
                                                .filter((i) => i !== optIdx)
                                                .map((i) => (i > optIdx ? i - 1 : i));
                                              return {
                                                ...d,
                                                options: nextOpts,
                                                answer: nextArr,
                                                rawAnswer: formatDraftRawAnswer('multi', nextArr),
                                              };
                                            })
                                          }
                                        >
                                          删项
                                        </button>
                                      )}
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
                              <textarea
                                data-testid={`draft-edit-explain-${origIndex}`}
                                className="qi-textarea"
                                style={{ minHeight: '64px' }}
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

                            <label className="qi-field">
                              <span className="qi-field__label">知识点标签（逗号分隔，选填）</span>
                              <input
                                type="text"
                                data-testid={`draft-edit-tags-${origIndex}`}
                                className="qi-input"
                                placeholder="例如：网络协议, 传输层"
                                value={draft.tags.join(', ')}
                                onChange={(e) =>
                                  updateDraft(draft.tempId, (d) => ({
                                    ...d,
                                    tags: parseTagsInput(e.target.value),
                                  }))
                                }
                                onKeyDown={stopShortcutBubble}
                              />
                            </label>

                            {isFormulaPreviewOpen && (
                              <div
                                data-testid={`draft-formula-preview-${origIndex}`}
                                className="qi-formula-preview"
                              >
                                <div className="qi-formula-preview__header">
                                  <span>公式与排版实时预览</span>
                                  <span className="qi-formula-preview__hint">
                                    支持 $...$ / $$...$$ 与 Markdown
                                  </span>
                                </div>
                                <div className="qi-formula-preview__section">
                                  <div className="qi-formula-preview__label">题干</div>
                                  <div className="qi-formula-preview__body">
                                    {draft.stem.trim() ? (
                                      <RichContent content={draft.stem} />
                                    ) : (
                                      <span className="qi-formula-preview__empty">
                                        （空题干）
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {(draft.type === 'choice' || draft.type === 'multi') &&
                                  draft.options.length > 0 && (
                                    <div className="qi-formula-preview__section">
                                      <div className="qi-formula-preview__label">选项</div>
                                      <ul className="qi-formula-preview__opts">
                                        {draft.options.map((opt, optIdx) => {
                                          const isChecked =
                                            draft.type === 'choice'
                                              ? draft.answer === optIdx
                                              : Array.isArray(draft.answer) &&
                                                draft.answer.includes(optIdx);
                                          return (
                                            <li
                                              key={optIdx}
                                              className={`qi-formula-preview__opt${isChecked ? ' is-correct' : ''}`}
                                            >
                                              <span className="qi-formula-preview__opt-tag">
                                                {getOptionLabel(optIdx)}
                                              </span>
                                              <div className="qi-formula-preview__opt-text">
                                                {opt.trim() ? (
                                                  <RichContent inline content={opt} />
                                                ) : (
                                                  <span className="qi-formula-preview__empty">
                                                    （空选项）
                                                  </span>
                                                )}
                                              </div>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    </div>
                                  )}
                                {(draft.type === 'short' || draft.type === 'analysis') && (
                                  <div className="qi-formula-preview__section">
                                    <div className="qi-formula-preview__label">参考答案</div>
                                    <div className="qi-formula-preview__body">
                                      {typeof draft.answer === 'string' && draft.answer.trim() ? (
                                        <RichContent content={draft.answer} />
                                      ) : (
                                        <span className="qi-formula-preview__empty">
                                          （未填写参考答案）
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                )}
                                <div className="qi-formula-preview__section">
                                  <div className="qi-formula-preview__label">解析</div>
                                  <div className="qi-formula-preview__body">
                                    {draft.explain.trim() ? (
                                      <RichContent content={draft.explain} />
                                    ) : (
                                      <span className="qi-formula-preview__empty">
                                        （未填写解析）
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
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

                <div className="qi-sticky-confirm">
                  <span className="qi-sticky-confirm__status">
                    {summary.errorIncluded > 0
                      ? `还有 ${summary.errorIncluded} 道已勾选题目存在异常，请点击“修正”或“一键剔除异常项”后再入库。`
                      : summary.validIncluded > 0
                        ? effectiveTargetBankMode === 'existing'
                          ? `准备就绪：将向《${effectiveTargetBank?.name ?? ''}》追加 ${summary.validIncluded} 题。`
                          : `准备就绪：将导入 ${summary.validIncluded} 道有效题目并同步至题库。`
                        : '当前没有可入库的有效题目。'}
                  </span>
                  <button
                    type="button"
                    data-testid="btn-confirm-import-sticky"
                    className="qi-btn qi-btn--primary"
                    disabled={
                      summary.validIncluded === 0 ||
                      summary.errorIncluded > 0 ||
                      committing ||
                      washing
                    }
                    onClick={() => void handleCommit()}
                  >
                    {committing
                      ? '正在入库…'
                      : effectiveTargetBankMode === 'existing'
                        ? `确认追加到题库（共 ${summary.validIncluded} 题）`
                        : `确认导入题库（共 ${summary.validIncluded} 题）`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
