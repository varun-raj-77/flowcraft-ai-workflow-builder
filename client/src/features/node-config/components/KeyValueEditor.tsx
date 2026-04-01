'use client';

import { useState, useEffect, useCallback } from 'react';
import { TextInput } from './FormInputs';

interface KeyValuePair {
  key: string;
  value: string;
}

interface KeyValueEditorProps {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

/**
 * Converts Record<string,string> → array of pairs for editing,
 * and converts back on every change.
 */
export function KeyValueEditor({ value, onChange }: KeyValueEditorProps) {
  const [pairs, setPairs] = useState<KeyValuePair[]>(() => {
    const entries = Object.entries(value || {});
    return entries.length > 0
      ? entries.map(([key, val]) => ({ key, value: val }))
      : [{ key: '', value: '' }];
  });

  // Sync outward — convert pairs back to Record on change
  const syncToParent = useCallback(
    (updated: KeyValuePair[]) => {
      const record: Record<string, string> = {};
      for (const pair of updated) {
        if (pair.key.trim()) {
          record[pair.key.trim()] = pair.value;
        }
      }
      onChange(record);
    },
    [onChange],
  );

  // Sync inward — if parent value changes (e.g. form reset), update local state
  useEffect(() => {
    const entries = Object.entries(value || {});
    if (entries.length === 0 && pairs.length === 1 && !pairs[0].key && !pairs[0].value) {
      return; // Already showing an empty row
    }
    const incoming = entries.map(([k, v]) => ({ key: k, value: v }));
    if (JSON.stringify(incoming) !== JSON.stringify(pairs.filter((p) => p.key.trim()))) {
      setPairs(incoming.length > 0 ? incoming : [{ key: '', value: '' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function updatePair(index: number, field: 'key' | 'value', newValue: string) {
    const updated = pairs.map((pair, i) =>
      i === index ? { ...pair, [field]: newValue } : pair,
    );
    setPairs(updated);
    syncToParent(updated);
  }

  function addPair() {
    const updated = [...pairs, { key: '', value: '' }];
    setPairs(updated);
  }

  function removePair(index: number) {
    if (pairs.length <= 1) {
      // Keep at least one empty row
      const updated = [{ key: '', value: '' }];
      setPairs(updated);
      syncToParent(updated);
      return;
    }
    const updated = pairs.filter((_, i) => i !== index);
    setPairs(updated);
    syncToParent(updated);
  }

  return (
    <div className="space-y-1.5">
      {pairs.map((pair, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <TextInput
            value={pair.key}
            onChange={(e) => updatePair(index, 'key', e.target.value)}
            placeholder="Key"
            className="flex-1"
          />
          <TextInput
            value={pair.value}
            onChange={(e) => updatePair(index, 'value', e.target.value)}
            placeholder="Value"
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => removePair(index)}
            className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Remove header"
          >
            <span className="text-xs">✕</span>
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addPair}
        className="mt-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        + Add header
      </button>
    </div>
  );
}
