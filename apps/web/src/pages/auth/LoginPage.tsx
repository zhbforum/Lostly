import { Link } from 'react-router';

import { LoginForm } from '@/features/auth/ui/AuthForm/LoginForm';
import { AuthPageLayout } from '@/features/auth/ui/AuthPageLayout/AuthPageLayout';

export function LoginPage() {
  return (
    <AuthPageLayout
      eyebrow="Welcome back"
      title="Sign in to Lostly"
      description="Continue managing your reports and helping lost items find their way home."
      footer={
        <>
          New to Lostly? <Link to="/register">Create an account</Link>
        </>
      }
    >
      <LoginForm />
    </AuthPageLayout>
  );
}
