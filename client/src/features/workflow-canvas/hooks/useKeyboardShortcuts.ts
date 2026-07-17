import { useEffect, useCallback } from 'react';

interface ShortcutHandlers {
  onSave?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

/**
 * Registers global keyboard shortcuts for the editor.
 * Ctrl+S / Cmd+S → save
 */
export function useKeyboardShortcuts({ onSave, onUndo, onRedo }: ShortcutHandlers) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const isModifier = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement;
      const isTextEditing = !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');

      if (isModifier && event.key.toLowerCase() === 'z' && !isTextEditing) {
        event.preventDefault();
        if (event.shiftKey) onRedo?.(); else onUndo?.();
        return;
      }

      // Ctrl+S / Cmd+S → Save
      if (isModifier && event.key === 's') {
        event.preventDefault();
        onSave?.();
      }
    },
    [onSave, onUndo, onRedo],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
