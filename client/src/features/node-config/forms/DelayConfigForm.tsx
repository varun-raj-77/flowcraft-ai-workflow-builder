'use client';

import type { DelayConfig } from '@/types';
import { delayConfigSchema } from '../schemas';
import { useNodeConfigForm } from '../hooks/useNodeConfigForm';
import { FieldWrapper } from '../components/FieldWrapper';
import { NumberInput } from '../components/FormInputs';

interface DelayConfigFormProps {
  nodeId: string;
  config: DelayConfig;
}

export function DelayConfigForm({ nodeId, config }: DelayConfigFormProps) {
  const { register, watch, formState: { errors } } = useNodeConfigForm(
    nodeId,
    delayConfigSchema,
    config,
  );

  const currentMs = watch('delayMs') ?? 0;
  const displayTime = currentMs >= 1000
    ? `${(currentMs / 1000).toFixed(1)} seconds`
    : `${currentMs} milliseconds`;

  return (
    <div className="space-y-4">
      <FieldWrapper
        label="Delay (milliseconds)"
        htmlFor="delayMs"
        error={errors.delayMs?.message}
      >
        <NumberInput
          id="delayMs"
          placeholder="1000"
          min={0}
          max={300000}
          step={100}
          hasError={!!errors.delayMs}
          {...register('delayMs', { valueAsNumber: true })}
        />
      </FieldWrapper>

      <div className="rounded-md bg-zinc-50 px-3 py-2 text-center dark:bg-zinc-800/50">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {displayTime}
        </p>
      </div>
    </div>
  );
}
