'use client';

import type { Workflow } from '@/types';
import { WorkflowCard } from './WorkflowCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';

interface WorkflowListProps {
  workflows: Workflow[];
  onDelete: (id: string) => void;
  onCreate: () => void;
}

export function WorkflowList({ workflows, onDelete, onCreate }: WorkflowListProps) {
  if (workflows.length === 0) {
    return (
      <EmptyState
        icon="◇"
        title="No workflows yet"
        description="Create your first workflow manually or generate one with AI."
        action={
          <Button onClick={onCreate} size="md">
            Create Workflow
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {workflows.map((workflow) => (
        <WorkflowCard
          key={workflow._id}
          workflow={workflow}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
