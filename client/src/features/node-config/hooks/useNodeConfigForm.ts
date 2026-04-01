import { useEffect, useRef, useCallback } from 'react';
import { useForm, type UseFormReturn, type DefaultValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodSchema } from 'zod';
import { useWorkflowStore } from '@/stores/workflowStore';

/**
 * Bridges React Hook Form ↔ workflowStore for a node config form.
 *
 * How it works:
 * 1. Initializes RHF with the node's current config as defaultValues
 * 2. On form change (via watch), debounce-writes valid data to the store
 * 3. On node switch (nodeId changes), resets the form with new config
 *
 * Why debounce instead of onChange per field:
 *   - Typing "https://api.example.com" fires 24 onChange events
 *   - Writing to Zustand on each one causes 24 React Flow re-renders
 *   - A 300ms debounce batches rapid typing into a single store update
 *
 * @param nodeId   - The selected node's ID
 * @param schema   - Zod schema for this config type
 * @param defaults - Current config values from the node
 */
export function useNodeConfigForm<T extends Record<string, unknown>>(
  nodeId: string,
  schema: ZodSchema<T>,
  defaults: T,
): UseFormReturn<T> {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const form = useForm<T>({
    resolver: zodResolver(schema),
    defaultValues: defaults as DefaultValues<T>,
    mode: 'onChange', // Validate on every change for instant feedback
  });

  // Reset form when switching to a different node
  useEffect(() => {
    form.reset(defaults as DefaultValues<T>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]); // Intentionally only depend on nodeId, not defaults

  // Watch all form values and debounce-write to store
  const writeToStore = useCallback(
    (data: T) => {
      updateNodeData(nodeId, { config: data });
    },
    [nodeId, updateNodeData],
  );

  useEffect(() => {
    const subscription = form.watch((values) => {
      // Clear previous debounce
      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(() => {
        // Only write if the form is currently valid
        if (form.formState.isValid) {
          writeToStore(values as T);
        }
      }, 300);
    });

    return () => {
      subscription.unsubscribe();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [form, writeToStore]);

  return form;
}
