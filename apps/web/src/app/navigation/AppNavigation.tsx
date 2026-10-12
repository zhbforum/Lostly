import { Link, NavLink, useLocation } from 'react-router';
import { AccountMenu } from '@/features/auth/ui/AccountMenu/AccountMenu';
import { useConversationUnread } from '@/features/conversations/model/use-conversation-unread';
import { Brand } from '@/shared/ui/Brand/Brand';
import styles from './AppNavigation.module.css';

export function AppNavigation() {
  const { unreadConversationCount: unread } = useConversationUnread();
  const location = useLocation();
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brand} aria-label="Lostly home">
          <Brand variant="header" />
        </Link>
        <nav className={styles.links} aria-label="Main navigation">
          <NavLink to="/listings">Browse</NavLink>
          <NavLink to="/activity">Activity</NavLink>
          <NavLink
            to="/messages"
            aria-label={
              unread > 0
                ? `Messages, ${unread} unread ${unread === 1 ? 'conversation' : 'conversations'}`
                : 'Messages'
            }
          >
            Messages
            {unread > 0 && (
              <span className={styles.badge} aria-hidden="true">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </NavLink>
        </nav>
        <div className={styles.account}>
          <AccountMenu key={location.pathname + location.search} />
        </div>
      </div>
    </header>
  );
}
