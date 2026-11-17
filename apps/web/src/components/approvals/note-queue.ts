/**
 * The note prompt's requests, one dialog at a time: a write that asks while
 * another prompt is open waits its turn instead of cancelling it.
 */
export interface NoteRequest {
  /** Distinct per request, so each opens a fresh dialog. */
  id: number;
  resolve: (note: string | null) => void;
}

export function createNoteQueue() {
  const waiting: NoteRequest[] = [];
  let next = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    /** Resolves with the note, or null when cancelled. */
    ask(): Promise<string | null> {
      return new Promise((resolve) => {
        const request: NoteRequest = {
          id: next++,
          resolve: (note) => {
            const i = waiting.indexOf(request);
            if (i >= 0) waiting.splice(i, 1);
            resolve(note);
            emit();
          },
        };
        waiting.push(request);
        if (waiting.length === 1) emit();
      });
    },
    /** The request whose dialog is open, if any. */
    current(): NoteRequest | null {
      return waiting[0] ?? null;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
