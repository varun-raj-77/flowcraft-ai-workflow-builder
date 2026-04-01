'use client';

import type { TransformConfig } from '@/types';
import { transformConfigSchema } from '../schemas';
import { useNodeConfigForm } from '../hooks/useNodeConfigForm';
import { FieldWrapper } from '../components/FieldWrapper';
import { TextInput, TextArea } from '../components/FormInputs';

interface TransformConfigFormProps {
  nodeId: string;
  config: TransformConfig;
}

export function TransformConfigForm({ nodeId, config }: TransformConfigFormProps) {
  const { register, formState: { errors } } = useNodeConfigForm(
    nodeId,
    transformConfigSchema,
    config,
  );

  return (
    <div className="space-y-4">
      <FieldWrapper
        label="Transform Code"
        htmlFor="transformCode"
        error={errors.transformCode?.message}
        hint="JavaScript function body. 'input' is the previous node's output."
      >
        <TextArea
          id="transformCode"
          placeholder="return input.data.map(item => item.name)"
          rows={6}
          hasError={!!errors.transformCode}
          {...register('transformCode')}
        />
      </FieldWrapper>

      <FieldWrapper label="Description" htmlFor="description" hint="Optional note for readability">
        <TextInput
          id="description"
          placeholder="What does this transform do?"
          {...register('description')}
        />
      </FieldWrapper>
    </div>
  );
}
