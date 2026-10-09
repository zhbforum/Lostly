import { useEffect, useRef, useState } from 'react';
import styles from './MessageComposer.module.css';

interface PreviewEntry {
  id: number;
  file: File;
}
interface Selection {
  files: readonly File[];
  entries: PreviewEntry[];
  nextId: number;
}

function reconcile(previous: Selection, files: readonly File[]): Selection {
  const remaining = [...previous.entries];
  let nextId = previous.nextId;
  const entries = files.map((file) => {
    const index = remaining.findIndex((entry) => entry.file === file);
    return index >= 0 ? remaining.splice(index, 1)[0]! : { id: nextId++, file };
  });
  return { files, entries, nextId };
}

export function SelectedImagePreviews({
  files,
  disabled,
  onRemove,
}: {
  files: readonly File[];
  disabled: boolean;
  onRemove: (index: number) => boolean;
}) {
  // UI-only occurrence identities: duplicate File objects still have independent lifetimes.
  const [selection, setSelection] = useState(() =>
    reconcile({ files: [], entries: [], nextId: 0 }, files),
  );
  if (selection.files !== files) setSelection(reconcile(selection, files));
  return (
    <ul className={styles.previews} aria-label="Selected images">
      {selection.entries.map((entry, index) => (
        <li key={entry.id} className={styles.preview}>
          <ImagePreview file={entry.file} index={index} />
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove image ${index + 1}`}
            onClick={() => {
              if (!onRemove(index)) return;
              // Remove this occurrence before matching the next files array, even for [A, A].
              setSelection((previous) => ({
                ...previous,
                entries: previous.entries.filter((item) => item.id !== entry.id),
              }));
            }}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

function ImagePreview({ file, index }: { file: File; index: number }) {
  const image = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = image.current;
    const url = URL.createObjectURL(file);
    if (element) element.src = url;
    return () => {
      element?.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [file]);
  // An occurrence keeps the same File; replacement gets a new key and preview component.
  return !failed ? (
    <img ref={image} alt={`Selected image ${index + 1}`} onError={() => setFailed(true)} />
  ) : (
    <span role="img" aria-label={`Selected image ${index + 1}`}>
      Preview unavailable
    </span>
  );
}
