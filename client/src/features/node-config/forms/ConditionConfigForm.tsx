'use client';

import type { ConditionConfig } from '@/types';
import { conditionConfigSchema } from '../schemas';
import { useNodeConfigForm } from '../hooks/useNodeConfigForm';
import { FieldWrapper } from '../components/FieldWrapper';
import { TextArea } from '../components/FormInputs';

interface ConditionConfigFormProps {
  nodeId: string;
  config: ConditionConfig;
}

export function ConditionConfigForm({ nodeId, config }: ConditionConfigFormProps) {
  const { register, formState: { errors } } = useNodeConfigForm(
    nodeId,
    conditionConfigSchema,
    config,
  );

  return (
    <div className="space-y-4">
      <FieldWrapper
        label="Expression"
        htmlFor="expression"
        error={errors.expression?.message}
        hint="Use {{nodeId.field}} to reference prior node outputs"
      >
        <TextArea
          id="expression"
          placeholder="{{node_1.status}} === 200"
          rows={3}
          hasError={!!errors.expression}
          {...register('expression')}
        />
      </FieldWrapper>

      <div className="rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
        <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
          Expression guide
        </p>
        <ul className="mt-1.5 space-y-1 text-[10px] text-zinc-400 dark:text-zinc-500">
          <li>• Evaluates to true or false</li>
          <li>• True → top output handle</li>
          <li>• False → bottom output handle</li>
          <li>• Example: {'{{prev.data.length}}'} {'>'} 0</li>
        </ul>
      </div>
    </div>
  );
}
