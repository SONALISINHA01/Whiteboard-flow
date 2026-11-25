import { Suspense, lazy, useEffect, useState } from 'react';
import { LandingPage } from './components/LandingPage';
import { parseHashRoute, type AppRoute } from './router';

// Lazy-load the editor so the landing page never downloads React Flow, ONNX, or OCR code.
const LazyEditorApp = lazy(() => import('./App'));

export function RootApp() {
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window !== 'undefined' ? parseHashRoute(window.location.hash) : 'landing',
  );

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHashRoute(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (route === 'editor') {
    return (
      <Suspense
        fallback={
          <div
            style={{
              height: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#F3F5FB',
              color: '#5D6680',
              fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
              fontSize: 14,
            }}
          >
            Loading editor…
          </div>
        }
      >
        <LazyEditorApp />
      </Suspense>
    );
  }

  return <LandingPage />;
}

export default RootApp;
