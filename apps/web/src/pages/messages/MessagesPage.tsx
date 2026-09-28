import { MessagesWorkspace } from '@/features/conversations/ui/MessagesWorkspace/MessagesWorkspace';
import { AppNavigation } from '@/app/navigation/AppNavigation';
import styles from './MessagesPage.module.css';

export function MessagesPage() {
  return (
    <main className={styles.page}>
      <AppNavigation />
      <MessagesWorkspace />
    </main>
  );
}
