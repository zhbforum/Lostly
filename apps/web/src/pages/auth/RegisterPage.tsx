import { Link, useLocation } from 'react-router';

import { RegisterForm } from '@/features/auth/ui/AuthForm/RegisterForm';
import { GoogleAuth } from '@/features/auth/ui/GoogleAuth/GoogleAuth';
import { safeReturnTo } from '@/shared/navigation/return-to';
import { AuthPageLayout } from '@/features/auth/ui/AuthPageLayout/AuthPageLayout';

export function RegisterPage() {
  const location = useLocation();
  return (
    <AuthPageLayout
      eyebrow="Get started"
      title="Create your account"
      description="Report lost or found items and verify ownership through a secure account."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" state={location.state}>
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
      <GoogleAuth returnTo={safeReturnTo(location.state?.returnTo)} />
    </AuthPageLayout>
  );
}
