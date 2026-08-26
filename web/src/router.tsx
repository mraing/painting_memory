import { createBrowserRouter } from 'react-router-dom';
import { navigateWithViewTransition } from './lib/viewTransition';
import HomePage from './pages/home/HomePage';
import CapturePage from './pages/capture/CapturePage';
import ConvertPage from './pages/convert/ConvertPage';
import StoryPage from './pages/story/StoryPage';
import EntryPage from './pages/entry/EntryPage';
import BookPage from './pages/book/BookPage';
import Lab3DPage from './pages/lab/Lab3DPage';
import SettingsPage from './pages/settings/SettingsPage';

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/capture', element: <CapturePage /> },
  { path: '/convert', element: <ConvertPage /> },
  { path: '/story', element: <StoryPage /> },
  { path: '/entry', element: <EntryPage /> },
  { path: '/book', element: <BookPage /> },
  { path: '/settings', element: <SettingsPage /> },
  { path: '/lab/3d', element: <Lab3DPage /> },
]);

// View Transitions 接入点：需要过渡的导航统一走这里，
// 浏览器不支持时静默退化为普通导航。
export function navigateTo(path: string) {
  navigateWithViewTransition(() => router.navigate(path));
}
