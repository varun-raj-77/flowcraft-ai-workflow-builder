'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { redactInspectionValue } from './executionInspector';

const ARRAY_PREVIEW_LIMIT = 100;

function countSearchMatches(value: unknown, query: string, limit = 100, visitLimit = 5_000): number {
  if (!query) return 0;
  const needle = query.toLowerCase();
  let matches = 0;
  let visited = 0;
  const visit = (item: unknown, key = '') => {
    if (matches >= limit || visited >= visitLimit) return;
    visited += 1;
    if (`${key} ${typeof item === 'string' ? item : ''}`.toLowerCase().includes(needle)) matches += 1;
    if (Array.isArray(item)) item.forEach((child, index) => visit(child, String(index)));
    else if (item && typeof item === 'object') Object.entries(item as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(value);
  return matches;
}

function JsonValue({ value, depth, expandAll, collapseToken, wrap }: { value: unknown; depth: number; expandAll: boolean | null; collapseToken: number; wrap: boolean }) {
  const isCollection = Array.isArray(value) || Boolean(value && typeof value === 'object');
  const [expanded, setExpanded] = useState(depth === 0);
  const [visibleArrayItems, setVisibleArrayItems] = useState(ARRAY_PREVIEW_LIMIT);
  useEffect(() => { if (expandAll !== null) setExpanded(expandAll); }, [expandAll]);
  useEffect(() => { setVisibleArrayItems(ARRAY_PREVIEW_LIMIT); }, [collapseToken]);

  if (!isCollection) {
    return <span className={typeof value === 'string' ? 'text-emerald-700 dark:text-emerald-400' : 'text-violet-700 dark:text-violet-400'}>{JSON.stringify(value)}</span>;
  }

  const entries = Array.isArray(value) ? value.map((child, index) => [String(index), child] as const) : Object.entries(value as Record<string, unknown>);
  const isArray = Array.isArray(value);
  const visibleEntries = isArray ? entries.slice(0, visibleArrayItems) : entries;
  const suffix = isArray ? `${entries.length} items` : `${entries.length} keys`;

  return <span className="inline-block min-w-0 align-top">
    <button type="button" onClick={() => setExpanded((current) => !current)} className="mr-1 rounded px-1 text-zinc-500 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-700" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${suffix}`}>{expanded ? '−' : '+'}</button>
    {!expanded ? <span className="text-zinc-500">{isArray ? '[' : '{'} {suffix} {isArray ? ']' : '}'}</span> : <span>
      <span className="text-zinc-500">{isArray ? '[' : '{'}</span>
      <span className="ml-4 block border-l border-zinc-200 pl-2 dark:border-zinc-700">
        {visibleEntries.map(([key, child]) => <span key={key} data-json-array-entry={isArray || undefined} className={wrap ? 'block whitespace-pre-wrap break-words' : 'block whitespace-nowrap'}><span className="text-sky-700 dark:text-sky-400">{isArray ? '' : `${JSON.stringify(key)}: `}</span><JsonValue value={child} depth={depth + 1} expandAll={expandAll} collapseToken={collapseToken} wrap={wrap} /></span>)}
        {isArray && entries.length > visibleEntries.length && <button type="button" onClick={() => setVisibleArrayItems((count) => Math.min(entries.length, count + ARRAY_PREVIEW_LIMIT))} className="mt-1 rounded px-1 text-sky-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-sky-400 dark:hover:bg-zinc-800" aria-label={`Show ${Math.min(ARRAY_PREVIEW_LIMIT, entries.length - visibleEntries.length)} more array items`}>Show {Math.min(ARRAY_PREVIEW_LIMIT, entries.length - visibleEntries.length)} more ({visibleEntries.length} of {entries.length})</button>}
      </span>
      <span className="text-zinc-500">{isArray ? ']' : '}'}</span>
    </span>}
  </span>;
}

export function JsonViewer({ value }: { value: unknown }) {
  const [expandAll, setExpandAll] = useState<boolean | null>(null);
  const [collapseToken, setCollapseToken] = useState(0);
  const [wrap, setWrap] = useState(true);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const safeValue = useMemo(() => redactInspectionValue(value), [value]);
  const serialized = useMemo(() => JSON.stringify(safeValue, null, 2) ?? 'null', [safeValue]);
  const matches = useMemo(() => countSearchMatches(safeValue, query), [safeValue, query]);
  const itemCount = Array.isArray(safeValue) ? safeValue.length : safeValue && typeof safeValue === 'object' ? Object.keys(safeValue as Record<string, unknown>).length : null;

  const copy = async () => {
    if (!navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(serialized);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return <div className="mt-1 rounded-md border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
    <div className="flex flex-wrap items-center gap-1 border-b border-zinc-100 px-2 py-1.5 text-[10px] dark:border-zinc-800">
      <span className="mr-auto text-zinc-500">{itemCount === null ? 'Value' : `${itemCount} ${Array.isArray(safeValue) ? 'items' : 'keys'} · ~${new TextEncoder().encode(serialized).byteLength.toLocaleString()} bytes`}</span>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Count matching keys/values" aria-label="Count matching JSON keys and values" className="w-36 rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-[10px] outline-none focus:border-blue-500 dark:border-zinc-700" />
      {query && <span className="text-zinc-500">{matches}{matches >= 100 ? '+' : ''} matches</span>}
      <button type="button" onClick={() => { setExpandAll(false); setCollapseToken((token) => token + 1); }} aria-label="Collapse all JSON" className="rounded px-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">Collapse all</button>
      <button type="button" onClick={() => setExpandAll(true)} aria-label="Expand JSON branches" className="rounded px-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">Expand branches</button>
      <button type="button" onClick={() => setWrap((current) => !current)} aria-label="Toggle JSON line wrapping" className="rounded px-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">Wrap</button>
      <button type="button" onClick={() => void copy()} aria-label="Copy redacted JSON" className="rounded px-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">{copied ? 'Copied' : 'Copy JSON'}</button>
    </div>
    <pre className="max-h-none overflow-x-auto p-2 font-mono text-[10px] leading-relaxed text-zinc-700 dark:text-zinc-300"><JsonValue value={safeValue} depth={0} expandAll={expandAll} collapseToken={collapseToken} wrap={wrap} /></pre>
  </div>;
}
