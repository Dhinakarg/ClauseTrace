/**
 * DocumentDropzone.
 *
 * Upload UX is part of trust: the accepted types, size limits and what happens
 * to the file are stated before the user picks anything, and a rejected file is
 * explained with the reason the pipeline gave rather than a generic error.
 */

import { useRef, useState } from 'react';
import { FileUp, Loader2, UploadCloud } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { describeUploadRules } from '../../documents/upload.js';

export function DocumentDropzone({ onFile = null, busy = false, busyLabel = 'Working…', disabled = false }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const rules = describeUploadRules();

  const handleDragOver = (event) => {
    if (disabled) return;
    event.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => setDragging(false);

  const handleDrop = (event) => {
    if (disabled) return;
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile?.(file);
  };

  const handleChange = (event) => {
    const file = event.target.files?.[0];
    if (file) onFile?.(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  const active = dragging && !disabled;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={[
        'rounded border-2 border-dashed px-4 py-6 text-center transition-colors',
        active ? 'border-accent-400 bg-accent-50' : 'border-ink-200 bg-ink-50/40',
      ].join(' ')}
    >
      <UploadCloud aria-hidden="true" className="mx-auto h-6 w-6 text-ink-400" />
      <p className="mt-2 text-sm font-semibold text-ink-900">
        Drop a document here, or choose a file
      </p>
      <p className="mt-1 text-xs text-ink-600">
        {rules.accepted.map((type) => type.toUpperCase()).join(', ')} · up to {rules.maxMegabytes} MB ·{' '}
        {rules.maxPages} pages. The file stays in this browser session.
      </p>

      <input
        ref={inputRef}
        id="document-upload"
        type="file"
        accept={rules.acceptAttribute}
        className="sr-only"
        onChange={handleChange}
        disabled={disabled || busy}
      />
      <label
        htmlFor="document-upload"
        className={[
          'mt-3 inline-flex items-center gap-2 rounded border px-3 py-2 text-sm font-medium',
          disabled || busy
            ? 'cursor-not-allowed border-ink-200 bg-ink-100 text-ink-400'
            : 'cursor-pointer border-ink-200 bg-surface text-ink-800 hover:bg-ink-50',
        ].join(' ')}
      >
        {busy ? (
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-accent-500" />
        ) : (
          <FileUp aria-hidden="true" className="h-4 w-4" />
        )}
        {busy ? busyLabel : 'Choose a file'}
      </label>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
        {rules.accepted.map((type) => (
          <Badge key={type} tone="muted">
            {type}
          </Badge>
        ))}
      </div>

      <p className="mt-3 text-2xs text-ink-500">
        Supported by file extension and declared type; the parser re-checks both before reading.
      </p>
    </div>
  );
}

export default DocumentDropzone;
