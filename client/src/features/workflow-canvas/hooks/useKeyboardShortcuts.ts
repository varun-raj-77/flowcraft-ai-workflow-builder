import { useEffect, useCallback } from 'react';

interface ShortcutHandlers {
  onSave?: () => void;
}

/**
 * Registers global keyboard shortcuts for the editor.
 * Ctrl+S / Cmd+S → save
 */
export function useKeyboardShortcuts({ onSave }: ShortcutHandlers) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const isModifier = event.metaKey || event.ctrlKey;

      // Ctrl+S / Cmd+S → Save
      if (isModifier && event.key === 's') {
        event.preventDefault();
        onSave?.();
      }
    },
    [onSave],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
