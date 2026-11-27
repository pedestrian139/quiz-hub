import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createQuestionSearchIndex, type HighlightRange } from '../../core/fuzzySearch';
import { TYPE_NAME } from '../../data/catalog';
import type { ChapterMeta, Question } from '../../types/quiz';
import { Icon } from '../ui/Icons';
import './SpotlightSearchModal.css';

interface SpotlightSearchModalProps {
  questions: readonly Question[];
  chapterById: ReadonlyMap<number, ChapterMeta>;
  bankName: string;
  onClose: () => void;
  onStart: (ids: string[]) => void;
}

function HighlightedStem({ stem, ranges }: { stem: string; ranges: readonly HighlightRange[] }) {
  return <>
    {ranges.map(({ start, end }, index) => (
      <Fragment key={start}>
        {stem.slice(ranges[index - 1]?.end ?? 0, start)}
        <mark>{stem.slice(start, end)}</mark>
      </Fragment>
    ))}
    {stem.slice(ranges.at(-1)?.end ?? 0)}
  </>;
}

export function SpotlightSearchModal({ questions, chapterById, bankName, onClose, onStart }: SpotlightSearchModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const index = useMemo(() => createQuestionSearchIndex(questions, { chapters: chapterById }), [questions, chapterById]);
  const results = useMemo(() => index.search(query), [index, query]);
  const availableIds = useMemo(() => new Set(questions.map(({ id }) => id)), [questions]);
  const selected = [...checked].filter((id) => availableIds.has(id));
  const allResultsSelected = results.length > 0 && results.every(({ question }) => checked.has(question.id));
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previouslyFocused = document.activeElement;
    dialog.showModal();
    inputRef.current?.focus();
    return () => {
      dialog.close();
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  function toggleQuestion(id: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <dialog
      ref={dialogRef}
      id="spotlight-search"
      className="spotlight"
      role="dialog"
      aria-labelledby="spotlight-title"
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="spotlight__panel">
        <h2 id="spotlight-title" className="spotlight__visually-hidden">搜索题目</h2>
        <div className="spotlight__search">
          <Icon name="search" size={22} />
          <input
            ref={inputRef}
            type="search"
            aria-label="搜索当前题库"
            placeholder="搜索题目…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="spotlight__close" aria-label="关闭搜题" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="spotlight__toolbar">
          <div className="spotlight__summary">
            <span className="spotlight__bank" title={bankName}>{bankName}</span>
            {hasQuery && <span role="status" data-testid="spotlight-results-count">匹配 {results.length} 题</span>}
          </div>
          {(results.length > 0 || selected.length > 0) && (
            <div className="spotlight__selection">
              {results.length > 0 && (
                <button
                  type="button"
                  disabled={allResultsSelected}
                  onClick={() => setChecked((current) => new Set([...current, ...results.map(({ question }) => question.id)]))}
                >
                  全选当前结果
                </button>
              )}
              <button type="button" disabled={!selected.length} onClick={() => setChecked(new Set())}>清空已选</button>
            </div>
          )}
        </div>
        {results.length > 0 ? (
          <ul className="spotlight__results" aria-label="匹配题目">
            {results.map(({ question, matchedFields, stemHighlights }) => {
              const { id, stem, type, chapter } = question;
              const hideFieldText = !matchedFields.includes('stem');
              return (
                <li key={id} className="spotlight__result" data-testid={`spotlight-result-${id}`}>
                  <label className="spotlight__question">
                    <input type="checkbox" checked={checked.has(id)} onChange={() => toggleQuestion(id)} />
                    <span className="spotlight__question-copy">
                      <span className="spotlight__meta">
                        <span className="spotlight__tag">{TYPE_NAME[type]}</span>
                        <span>{chapterById.get(chapter)?.short || `第 ${chapter} 章`}</span>
                        {hideFieldText && matchedFields.includes('options') && <span className="spotlight__tag">命中选项</span>}
                        {hideFieldText && matchedFields.includes('explanation') && <span className="spotlight__tag">命中解析</span>}
                      </span>
                      <span className="spotlight__stem"><HighlightedStem stem={stem} ranges={stemHighlights} /></span>
                    </span>
                  </label>
                  <button type="button" className="spotlight__practice" onClick={() => onStart([id])}>刷这题</button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="spotlight__empty">
            {hasQuery ? '没有找到匹配的题目' : '支持多词乱序、跳字和错别字检索'}
          </p>
        )}
        {selected.length > 0 && (
          <div className="spotlight__footer">
            <button type="button" data-testid="spotlight-start" onClick={() => onStart(selected)}>
              <Icon name="arrowRight" size={17} />开始专项刷题（已选 {selected.length} 题）
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
