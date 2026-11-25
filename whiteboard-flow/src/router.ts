export type AppRoute = 'landing' | 'editor';

export function parseHashRoute(hash: string): AppRoute {
  const normalized = hash.replace(/^#/, '').toLowerCase();
  if (normalized === '/editor' || normalized === 'editor') {
    return 'editor';
  }
  return 'landing';
}

export function navigateToRoute(route: AppRoute): void {
  const targetHash = route === 'editor' ? '#/editor' : '#/';
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }
}
