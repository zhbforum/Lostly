import { useContext, useId, useState, type FormEvent } from 'react';
import {
  CASE_CATEGORIES,
  type CaseCategory,
  type ModerationTarget,
} from '@lostly/contracts/moderation';
import { AuthContext } from '@/features/auth/model/auth-context';
import { ApiError } from '@/shared/api/client';
import { submitReport } from './api';
import styles from './moderation.module.css';

interface Props {
  targetType: ModerationTarget;
  targetId: string;
  label?: string;
}

export function ReportButton(props: Props) {
  const user = useContext(AuthContext)?.user;
  return user && !user.restriction ? (
    <ReportForm key={`${user.id}:${props.targetType}:${props.targetId}`} {...props} />
  ) : null;
}

function ReportForm({ targetType, targetId, label = 'Report a problem' }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<CaseCategory>('other');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || description.trim().length < 10) return;
    setBusy(true);
    setError('');
    try {
      await submitReport({ targetType, targetId, category, description: description.trim() });
      setSent(true);
      setOpen(false);
      setDescription('');
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.code === 'REPORT_EXISTS'
          ? 'You already have an open report for this item. Check Moderation notices in your account menu.'
          : failure instanceof ApiError && failure.status === 429
            ? 'Too many reports. Please wait ten minutes and try again.'
            : 'Could not send your report. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.report}>
      {sent ? (
        <p role="status">Report sent. You can follow its status in Moderation notices.</p>
      ) : (
        <button
          type="button"
          className={styles.secondary}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {label}
        </button>
      )}
      {open && (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <label htmlFor={id + '-category'}>Reason</label>
          <select
            id={id + '-category'}
            value={category}
            onChange={(event) => setCategory(event.target.value as CaseCategory)}
            disabled={busy}
          >
            {CASE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <label htmlFor={id + '-details'}>What happened?</label>
          <textarea
            id={id + '-details'}
            required
            minLength={10}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
            rows={3}
          />
          <p>
            Moderators can review the reported content. For a message or claim, only the evidence
            linked to this report is shared.
          </p>
          {error && <p role="alert">{error}</p>}
          <button disabled={busy || description.trim().length < 10}>
            {busy ? 'Sending…' : 'Send report'}
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
