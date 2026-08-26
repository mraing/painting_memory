import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { Toast } from './components/Toast';
import { OfflineBanner } from './components/OfflineBanner';

export function AppProviders() {
  return (
    <>
      <RouterProvider router={router} />
      <Toast />
      <OfflineBanner />
    </>
  );
}
