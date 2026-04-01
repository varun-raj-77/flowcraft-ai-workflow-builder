'use client';

import { Controller } from 'react-hook-form';
import type { ApiCallConfig } from '@/types';
import { apiCallConfigSchema } from '../schemas';
import { useNodeConfigForm } from '../hooks/useNodeConfigForm';
import { FieldWrapper } from '../components/FieldWrapper';
import { TextInput, NumberInput, SelectInput, TextArea } from '../components/FormInputs';
import { KeyValueEditor } from '../components/KeyValueEditor';

const METHOD_OPTIONS = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
  { value: 'PUT', label: 'PUT' },
  { value: 'DELETE', label: 'DELETE' },
];

interface ApiCallConfigFormProps {
  nodeId: string;
  config: ApiCallConfig;
}

export function ApiCallConfigForm({ nodeId, config }: ApiCallConfigFormProps) {
  const { register, control, formState: { errors } } = useNodeConfigForm(
    nodeId,
    apiCallConfigSchema,
    config,
  );

  return (
    <div className="space-y-4">
      <FieldWrapper label="URL" htmlFor="url" error={errors.url?.message}>
        <TextInput
          id="url"
          placeholder="https://api.example.com/data"
          hasError={!!errors.url}
          {...register('url')}
        />
      </FieldWrapper>

      <FieldWrapper label="Method" htmlFor="method" error={errors.method?.message}>
        <SelectInput
          id="method"
          options={METHOD_OPTIONS}
          hasError={!!errors.method}
          {...register('method')}
        />
      </FieldWrapper>

      <FieldWrapper label="Headers" hint="Key-value pairs sent with the request">
        <Controller
          name="headers"
          control={control}
          render={({ field }) => (
            <KeyValueEditor
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </FieldWrapper>

      <FieldWrapper label="Body" htmlFor="body" hint="JSON payload for POST/PUT requests">
        <TextArea
          id="body"
          placeholder='{"key": "value"}'
          rows={4}
          {...register('body')}
        />
      </FieldWrapper>

      <FieldWrapper
        label="Timeout (ms)"
        htmlFor="timeout"
        error={errors.timeout?.message}
        hint="100–30000ms"
      >
        <NumberInput
          id="timeout"
          placeholder="5000"
          hasError={!!errors.timeout}
          {...register('timeout', { valueAsNumber: true })}
        />
      </FieldWrapper>
    </div>
  );
}
