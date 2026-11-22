'use client';

import { useMemo, useRef, useState } from 'react';
import type { WorkflowSummary } from '@/types';
import { WorkflowCard } from './WorkflowCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { filterWorkflows, WORKFLOW_RUN_FILTERS, type WorkflowRunFilter } from './workflowDiscovery';

const filterControlClass = 'fc-focus w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] px-3 py-2 text-sm text-[var(--text-primary)]';

interface WorkflowListProps {
  workflows: WorkflowSummary[];
  onDelete: (id: string) => void;
  onCreate: () => void;
  createDisabled: boolean;
  createPending: boolean;
}

export function WorkflowList({ workflows, onDelete, onCreate, createDisabled, createPending }: WorkflowListProps) {
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [runFilter, setRunFilter] = useState<WorkflowRunFilter>('all');
  const visible = useMemo(() => filterWorkflows(workflows, search, runFilter), [workflows, search, runFilter]);
  const hasFilters = Boolean(search) || runFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setRunFilter('all');
    searchInput.current?.focus();
  }

  if (workflows.length === 0) {
    return (
      <EmptyState
        icon="◇"
        title="No workflows yet"
        description="Create your first workflow manually or generate one with AI."
        action={
          <Button onClick={onCreate} size="md" disabled={createDisabled} isLoading={createPending}>
            Create Workflow
          </Button>
        }
      />
    );
  }

  return (
    <section aria-label="Saved workflows">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          Search workflows
          <input
            ref={searchInput}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or description"
            className={filterControlClass}
          />
        </label>
        <label className="flex min-w-40 flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          Last run status
          <select
            value={runFilter}
            onChange={(event) => {
              const selected = WORKFLOW_RUN_FILTERS.find((filter) => filter.value === event.target.value);
              if (selected) setRunFilter(selected.value);
            }}
            className={filterControlClass}
          >
            {WORKFLOW_RUN_FILTERS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasFilters}>
          Clear filters
        </Button>
      </div>
      <p role="status" className="mb-4 text-xs text-[var(--text-muted)]">
        Showing {visible.length} of {workflows.length} {workflows.length === 1 ? 'workflow' : 'workflows'}
      </p>
      {visible.length === 0 ? (
        <EmptyState
          icon="◇"
          title="No matching workflows"
          description="Try another search or choose a different last-run status."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((workflow) => (
            <WorkflowCard key={workflow._id} workflow={workflow} onDelete={onDelete} />
          ))}
        </div>
      )}
    </section>
  );
}
