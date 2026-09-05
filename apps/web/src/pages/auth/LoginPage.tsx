import { Link, useLocation } from 'react-router';
import { useAuth } from '@/features/auth/model/auth-context';

import { LoginForm } from '@/features/auth/ui/AuthForm/LoginForm';
import { AuthPageLayout } from '@/features/auth/ui/AuthPageLayout/AuthPageLayout';

export function LoginPage() {
  const location = useLocation();
  const { sessionExpired } = useAuth();
  return (
    <AuthPageLayout
      eyebrow="Welcome back"
      title="Sign in to Lostly"
      description="Continue managing your reports and helping lost items find their way home."
      footer={
        <>
          New to Lostly?{' '}
          <Link to="/register" state={location.state}>
            Create an account
          </Link>
        </>
      }
    >
      {sessionExpired && (
        <p role="status">
          Your session expired. Sign in again to continue. Unfinished forms are kept in this tab for
          the same account.
        </p>
      )}
      <LoginForm />
    </AuthPageLayout>
  );
}
