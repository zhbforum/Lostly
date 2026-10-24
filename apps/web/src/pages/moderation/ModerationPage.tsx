import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type {
  ModerationCase,
  ModerationNotification,
  ModerationPage as Page,
} from '@lostly/contracts/moderation';
import { AppNavigation } from '@/app/navigation/AppNavigation';
import { useAuth } from '@/features/auth/model/auth-context';
import {
  appeal,
  getModerationNotifications,
  getMyCases,
  markRead,
} from '@/features/moderation/api';
import { ApiError } from '@/shared/api/client';
import styles from '@/features/moderation/moderation.module.css';

export function ModerationPage() {
  const { user, logout } = useAuth();
  const [notifications, setNotifications] = useState<Page<ModerationNotification> | null>(null);
  const [cases, setCases] = useState<Page<ModerationCase> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const revision = generation;
    const controller = new AbortController();
    const current = ++generation.current;
    void Promise.all([
      getModerationNotifications(undefined, controller.signal),
      getMyCases(undefined, controller.signal),
    ])
      .then(([notices, loadedCases]) => {
        if (!controller.signal.aborted && current === generation.current) {
          setNotifications(notices.notifications);
          setCases(loadedCases);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Could not load moderation notices. Please refresh to try again.');
      });
    return () => {
      revision.current++;
      controller.abort();
    };
  }, [user?.id]);
  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError('');
    const current = ++generation.current;
    try {
      const [notices, loadedCases] = await Promise.all([
        getModerationNotifications(),
        getMyCases(),
      ]);
      if (current === generation.current) {
        setNotifications(notices.notifications);
        setCases(loadedCases);
      }
    } catch {
      if (current === generation.current) setError('Could not refresh moderation notices.');
    } finally {
      setBusy(false);
    }
  }
  async function older(kind: 'notifications' | 'cases') {
    if (busy) return;
    setBusy(true);
    const current = generation.current;
    setError('');
    try {
      if (kind === 'notifications' && notifications?.pageInfo.endCursor) {
        const next = await getModerationNotifications(notifications.pageInfo.endCursor);
        if (current === generation.current)
          setNotifications({
            ...next.notifications,
            items: [...notifications.items, ...next.notifications.items],
          });
      }
      if (kind === 'cases' && cases?.pageInfo.endCursor) {
        const next = await getMyCases(cases.pageInfo.endCursor);
        if (current === generation.current)
          setCases({ ...next, items: [...cases.items, ...next.items] });
      }
    } catch {
      setError('Could not load older records. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function read(id: string) {
    try {
      await markRead(id);
      setNotifications((page) =>
        page
          ? {
              ...page,
              items: page.items.map((item) =>
                item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
              ),
            }
          : page,
      );
    } catch {
      setError('Could not mark this notice as read.');
    }
  }
  return (
    <>
      <AppNavigation />
      <main className={styles.page}>
        <h1>Moderation notices</h1>
        {user?.restriction && (
          <section className={styles.card} aria-label="Account restriction">
            <h2>Your account is restricted</h2>
            <p>{user.restriction.reason}</p>
            <p>
              {user.restriction.until
                ? `Until ${new Date(user.restriction.until).toLocaleString()}`
                : 'This restriction has no expiry.'}
            </p>
            <p>
              You can read decisions and submit an appeal here. Existing reports and claims are
              preserved.
            </p>
            <button
              type="button"
              onClick={() => void logout().catch(() => setError('Could not sign out.'))}
            >
              Sign out
            </button>
          </section>
        )}
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
        {user?.restriction && (
          <button type="button" onClick={() => window.location.reload()}>
            Check account access
          </button>
        )}
        {!user?.restriction && (
          <p>
            <Link to="/activity">Your reports and claims</Link>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {!notifications && !error && <p role="status">Loading decisions…</p>}
        <h2>Decisions</h2>
        {notifications?.items.length === 0 && <p>No moderation decisions.</p>}
        {notifications?.items.map((notice) => (
          <article className={styles.card} key={notice.id}>
            <h2>{notice.title}</h2>
            <time dateTime={notice.createdAt}>{new Date(notice.createdAt).toLocaleString()}</time>
            <p>{notice.message}</p>
            {!notice.readAt && (
              <button type="button" onClick={() => void read(notice.id)}>
                Mark as read
              </button>
            )}
            {notice.canAppeal &&
              !cases?.items.some((item) => item.parentEventId === notice.eventId) && (
                <AppealForm
                  eventId={notice.eventId}
                  onCreated={(item) =>
                    setCases((page) =>
                      page
                        ? { ...page, items: [item, ...page.items] }
                        : { items: [item], pageInfo: { endCursor: null, hasNextPage: false } },
                    )
                  }
                />
              )}
          </article>
        ))}
        {notifications?.pageInfo.hasNextPage && (
          <button disabled={busy} onClick={() => void older('notifications')}>
            Older decisions
          </button>
        )}
        <h2>Your reports and appeals</h2>
        {cases?.items.length === 0 && <p>No reports or appeals.</p>}
        {cases?.items.map((item) => (
          <article className={styles.card} key={item.id}>
            <h2>
              {item.kind === 'appeal' ? 'Appeal' : 'Report'} · {item.status.replaceAll('_', ' ')}
            </h2>
            <p>{item.description}</p>
            {item.publicResolution && (
              <p>
                <strong>Decision: </strong>
                {item.publicResolution}
              </p>
            )}
            <small>Reference: {item.id}</small>
          </article>
        ))}
        {cases?.pageInfo.hasNextPage && (
          <button disabled={busy} onClick={() => void older('cases')}>
            Older reports and appeals
          </button>
        )}
      </main>
    </>
  );
}

function AppealForm({
  eventId,
  onCreated,
}: {
  eventId: string;
  onCreated: (item: ModerationCase) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || text.trim().length < 10) return;
    setBusy(true);
    setError('');
    try {
      const result = await appeal(eventId, text.trim());
      onCreated(result.case);
      setOpen(false);
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.code === 'APPEAL_EXISTS'
          ? 'You already submitted an appeal for this decision. Refresh to see its status.'
          : failure instanceof ApiError && failure.status === 429
            ? 'Please wait ten minutes before submitting another appeal.'
            : 'Could not submit your appeal. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}>
          Appeal decision
        </button>
      ) : (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <label htmlFor={'appeal-' + eventId}>Why should this decision be reviewed?</label>
          <textarea
            id={'appeal-' + eventId}
            rows={4}
            required
            minLength={10}
            maxLength={2000}
            disabled={busy}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {error && <p role="alert">{error}</p>}
          <button disabled={busy || text.trim().length < 10}>
            {busy ? 'Submitting…' : 'Submit appeal'}
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
