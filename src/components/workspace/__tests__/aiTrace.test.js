import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { AITracePanel } from '../AITracePanel.jsx';

describe('AITracePanel', () => {
  const mockSummary = {
    ready: true,
    coverage: { verified: 27, total: 32 },
    counts: { parties: 3, obligations: 9, clauses: 15 },
    timeline: { counts: { dated: 7, undated: 2 } },
    model: {
      documents: [{ title: 'Master Services Agreement' }],
      parties: [{}, {}, {}],
      obligations: [{}, {}, {}, {}, {}, {}, {}, {}, {}],
      deadlines: [{}, {}, {}, {}, {}, {}, {}],
      rights: [{}, {}, {}, {}, {}],
    },
    entry: {
      extractionReport: {
        provider: { name: 'gemini' },
        draftItemCount: 32,
      },
    },
  };

  const mockTrust = {
    provider: { name: 'gemini' },
    counts: { draftItemCount: 32 },
    evidence: { checkedEntities: 32, rejectedEntities: 5 },
  };

  it('renders processing checklist and accurate verified/rejected metrics', () => {
    const html = renderToString(createElement(AITracePanel, { summary: mockSummary, trust: mockTrust }));

    expect(html).toContain('AI Document Analysis &amp; Verification Trace');
    expect(html).toContain('Document parsed');
    expect(html).toContain('AI extraction completed');
    expect(html).toContain('Evidence verification completed');
    expect(html).toContain('27');
    expect(html).toContain('facts verified');
    expect(html).toContain('5');
    expect(html).toContain('proposals rejected');
  });

  it('displays truthful provider label for Gemini and Mock Provider', () => {
    const htmlGemini = renderToString(createElement(AITracePanel, { summary: mockSummary, trust: mockTrust }));
    expect(htmlGemini).toContain('Gemini');

    const mockTrustOffline = {
      ...mockTrust,
      provider: { name: 'mock' },
    };
    const htmlMock = renderToString(createElement(AITracePanel, { summary: mockSummary, trust: mockTrustOffline }));
    expect(htmlMock).toContain('Demo / Mock Provider');
  });

  it('displays explicit layer distinction badges', () => {
    const html = renderToString(createElement(AITracePanel, { summary: mockSummary, trust: mockTrust }));
    expect(html).toContain('AI extraction');
    expect(html).toContain('Evidence verification');
    expect(html).toContain('Deterministic analysis');
  });

  it('renders graceful error state when extraction fails', () => {
    const html = renderToString(
      createElement(AITracePanel, { summary: mockSummary, trust: mockTrust, error: 'Provider API key rejected' }),
    );
    expect(html).toContain('AI extraction could not be completed');
    expect(html).toContain('Provider API key rejected');
  });
});
