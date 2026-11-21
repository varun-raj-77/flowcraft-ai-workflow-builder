'use client';

import { useEffect } from 'react';
import { useWorkflowStore } from '@/stores/workflowStore';

/** The browser controls the warning text and may suppress it without user activation. */
export function useWarnOnPageExit() {
  const isDirty = useWorkflowStore((state) => state.isDirty);

  useEffect(() => {
    if (!isDirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!useWorkflowStore.getState().isDirty) return;
      event.preventDefault();
      // Older browsers still rely on returnValue.
      event.returnValue = true;
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);
}
