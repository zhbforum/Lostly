import { type MouseEvent, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import type { ConversationDetail } from '../../model/types';
import styles from './ConversationHeader.module.css';

export function ConversationHeader({
  context,
  unavailable,
  onReturn,
}: {
  context: ConversationDetail | null;
  unavailable: boolean;
  onReturn: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (window.matchMedia?.('(max-width: 760px)').matches) heading.current?.focus();
  }, []);
  const back = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    onReturn();
  };
  return (
    <header className={styles.header}>
      <Link to="/messages" replace onClick={back} className={styles.back}>
        <span aria-hidden="true">←</span> Messages
      </Link>
      <h2 tabIndex={-1} ref={heading}>
        {unavailable
          ? 'Conversation unavailable'
          : (context?.otherParticipant.displayName ?? 'Conversation')}
      </h2>
      {context && !unavailable && (
        <p>{context.participantRole === 'owner' ? 'Claimant' : 'Finder'}</p>
      )}
    </header>
  );
}
