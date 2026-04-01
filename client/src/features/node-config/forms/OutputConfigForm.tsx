'use client';

import type { OutputConfig } from '@/types';
import { outputConfigSchema } from '../schemas';
import { useNodeConfigForm } from '../hooks/useNodeConfigForm';
import { FieldWrapper } from '../components/FieldWrapper';
import { SelectInput, TextArea } from '../components/FormInputs';

const LOG_LEVEL_OPTIONS = [
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

interface OutputConfigFormProps {
  nodeId: string;
  config: OutputConfig;
}

export function OutputConfigForm({ nodeId, config }: OutputConfigFormProps) {
  const { register, formState: { errors } } = useNodeConfigForm(
    nodeId,
    outputConfigSchema,
    config,
  );

  return (
    <div className="space-y-4">
      <FieldWrapper label="Log Level" htmlFor="logLevel" error={errors.logLevel?.message}>
        <SelectInput
          id="logLevel"
          options={LOG_LEVEL_OPTIONS}
          hasError={!!errors.logLevel}
          {...register('logLevel')}
        />
      </FieldWrapper>

      <FieldWrapper
        label="Message"
        htmlFor="message"
        error={errors.message?.message}
        hint="Use {{nodeId.field}} for template interpolation"
      >
        <TextArea
          id="message"
          placeholder="Result: {{node_1.data}}"
          rows={3}
          hasError={!!errors.message}
          {...register('message')}
        />
      </FieldWrapper>
    </div>
  );
}
