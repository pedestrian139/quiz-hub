import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BankLibraryProvider,
  useBankLibraryContext,
  useOptionalBankLibraryContext,
  type BankLibraryContextValue,
} from '../../src/utils/BankLibraryContext';
import { BUILTIN_GUIDE_BANK_ID } from '../../src/utils/quizImportTypes';
import { LEGACY_GUEST_SCOPE } from '../../src/core/practiceScope';
import { closeQuizHubDb, getBankDb, resetFallbackMemoryDb } from '../../src/utils/bankDb';

describe('BankLibraryContext & concurrent saveQuestionAiAnalysis', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    closeQuizHubDb();
    resetFallbackMemoryDb();
    vi.stubGlobal('indexedDB', new IDBFactory());
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    closeQuizHubDb();
    resetFallbackMemoryDb();
    vi.unstubAllGlobals();
  });

  it('returns null from useOptionalBankLibraryContext outside provider and manages import modal + AI analysis persistence', async () => {
    let outsideCtx: BankLibraryContextValue | null = { ready: false } as unknown as BankLibraryContextValue;
    function OutsideProbe() {
      outsideCtx = useOptionalBankLibraryContext();
      return null;
    }

    let capturedCtx: BankLibraryContextValue | null = null;
    const getCtx = (): BankLibraryContextValue | null => capturedCtx;
    function InsideProbe() {
      capturedCtx = useBankLibraryContext();
      return null;
    }

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <>
          <OutsideProbe />
          <BankLibraryProvider>
            <InsideProbe />
          </BankLibraryProvider>
        </>,
      );
    });

    // Flush async initBankDb microtasks/IDB callbacks cleanly inside act
    for (let i = 0; i < 20 && !getCtx()?.ready; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    const resolvedCtx = getCtx();
    expect(resolvedCtx?.ready).toBe(true);

    expect(outsideCtx).toBeNull();
    expect(capturedCtx!.loading).toBe(false);
    expect(capturedCtx!.activeBankId).toBe(BUILTIN_GUIDE_BANK_ID);

    act(() => {
      capturedCtx!.openImportModal('banks');
    });
    expect(capturedCtx!.importModalOpen).toBe(true);
    expect(capturedCtx!.importInitialTab).toBe('banks');

    // Save AI analysis on built-in bank -> stored in progress aiExplanations, NOT custom bank
    await act(async () => {
      await capturedCtx!.saveQuestionAiAnalysis(
        BUILTIN_GUIDE_BANK_ID,
        'qh-guide-choice-01',
        '### 【核心考点】\n内置题库解析',
        'deepseek-chat',
      );
    });
    const builtinStore = capturedCtx!.getProgressFor(BUILTIN_GUIDE_BANK_ID);
    expect(builtinStore.aiExplanations?.['qh-guide-choice-01']?.content).toBe(
      '### 【核心考点】\n内置题库解析',
    );

    // Create a custom bank with 2 questions and save AI analysis concurrently for both
    let createdId = '';
    await act(async () => {
      const created = await capturedCtx!.importNewBank(
        {
          name: '并发测试题库',
          chapters: [{ id: 1, short: '第1章', title: '第 1 章' }],
          questions: [
            {
              id: 'cq-1',
              type: 'tf',
              chapter: 1,
              stem: '题 1',
              answer: true,
              explain: '',
              source: { origin: 'comprehensive_bank', file: 'test', ref: '#1' },
            },
            {
              id: 'cq-2',
              type: 'tf',
              chapter: 1,
              stem: '题 2',
              answer: false,
              explain: '',
              source: { origin: 'comprehensive_bank', file: 'test', ref: '#2' },
            },
          ],
        },
        true,
      );
      createdId = created.id;
    });

    await act(async () => {
      await Promise.all([
        capturedCtx!.saveQuestionAiAnalysis(createdId, 'cq-1', 'Q1 并发 AI 解析'),
        capturedCtx!.saveQuestionAiAnalysis(createdId, 'cq-2', 'Q2 并发 AI 解析'),
      ]);
    });

    const updatedCustom = capturedCtx!.banks.find((b) => b.id === createdId);
    expect(updatedCustom?.data.questions.find((q) => q.id === 'cq-1')?.aiAnalysis).toBe(
      'Q1 并发 AI 解析',
    );
    expect(updatedCustom?.data.questions.find((q) => q.id === 'cq-2')?.aiAnalysis).toBe(
      'Q2 并发 AI 解析',
    );
  });

  it('preserves aiAnalysis and bank name under concurrent renameBank + saveQuestionAiAnalysis and avoids resurrecting deleted banks', async () => {
    let capturedCtx: BankLibraryContextValue | null = null;
    const getCtx = (): BankLibraryContextValue | null => capturedCtx;
    function Probe() {
      capturedCtx = useBankLibraryContext();
      return null;
    }

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <BankLibraryProvider>
          <Probe />
        </BankLibraryProvider>,
      );
    });

    for (let i = 0; i < 20 && !getCtx()?.ready; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    expect(getCtx()?.ready).toBe(true);

    let customId = '';
    await act(async () => {
      const created = await capturedCtx!.importNewBank(
        {
          name: '原始名称',
          chapters: [{ id: 1, short: '第1章', title: '第 1 章' }],
          questions: [
            {
              id: 'q1',
              type: 'tf',
              chapter: 1,
              stem: '题 1',
              answer: true,
              explain: '',
              source: { origin: 'comprehensive_bank', file: 'test', ref: '#1' },
            },
            {
              id: 'q2',
              type: 'tf',
              chapter: 1,
              stem: '题 2',
              answer: false,
              explain: '',
              source: { origin: 'comprehensive_bank', file: 'test', ref: '#2' },
            },
          ],
        },
        true,
      );
      customId = created.id;
    });

    // Order 1: renameBank first, saveQuestionAiAnalysis second
    await act(async () => {
      await Promise.all([
        capturedCtx!.renameBank(customId, '改名一'),
        capturedCtx!.saveQuestionAiAnalysis(customId, 'q1', 'Preserved Analysis 1'),
      ]);
    });

    const stateAfterOrder1 = capturedCtx!.banks.find((b) => b.id === customId);
    expect(stateAfterOrder1?.name).toBe('改名一');
    expect(stateAfterOrder1?.data.questions.find((q) => q.id === 'q1')?.aiAnalysis).toBe(
      'Preserved Analysis 1',
    );
    const idbAfterOrder1 = (await getBankDb(LEGACY_GUEST_SCOPE).listCustomBanks()).find(
      (b) => b.id === customId,
    );
    expect(idbAfterOrder1?.name).toBe('改名一');
    expect(idbAfterOrder1?.data.questions.find((q) => q.id === 'q1')?.aiAnalysis).toBe(
      'Preserved Analysis 1',
    );

    // Order 2: saveQuestionAiAnalysis first, renameBank second
    await act(async () => {
      await Promise.all([
        capturedCtx!.saveQuestionAiAnalysis(customId, 'q2', 'Preserved Analysis 2'),
        capturedCtx!.renameBank(customId, '改名二'),
      ]);
    });

    const stateAfterOrder2 = capturedCtx!.banks.find((b) => b.id === customId);
    expect(stateAfterOrder2?.name).toBe('改名二');
    expect(stateAfterOrder2?.data.questions.find((q) => q.id === 'q1')?.aiAnalysis).toBe(
      'Preserved Analysis 1',
    );
    expect(stateAfterOrder2?.data.questions.find((q) => q.id === 'q2')?.aiAnalysis).toBe(
      'Preserved Analysis 2',
    );
    const idbAfterOrder2 = (await getBankDb(LEGACY_GUEST_SCOPE).listCustomBanks()).find(
      (b) => b.id === customId,
    );
    expect(idbAfterOrder2?.name).toBe('改名二');
    expect(idbAfterOrder2?.data.questions.find((q) => q.id === 'q2')?.aiAnalysis).toBe(
      'Preserved Analysis 2',
    );

    // Concurrent deleteBank + saveQuestionAiAnalysis must NOT resurrect deleted bank
    await act(async () => {
      const deletion = capturedCtx!.deleteBank(customId);
      await expect(capturedCtx!.saveQuestionAiAnalysis(customId, 'q1', 'Should Not Resurrect'))
        .rejects.toThrow('题库已不存在');
      await expect(deletion).resolves.toBe(true);
    });

    expect(capturedCtx!.banks.find((b) => b.id === customId)).toBeUndefined();
    const idbAfterDelete = (await getBankDb(LEGACY_GUEST_SCOPE).listCustomBanks()).find(
      (b) => b.id === customId,
    );
    expect(idbAfterDelete).toBeUndefined();
  });
});
