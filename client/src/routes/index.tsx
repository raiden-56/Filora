import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import AppLayout from '@/layouts/AppLayout';

const HomePage = lazy(() => import('@/pages/HomePage'));
const ToolsPage = lazy(() => import('@/pages/ToolsPage'));
const CategoryPage = lazy(() => import('@/pages/CategoryPage'));
const ToolPage = lazy(() => import('@/pages/ToolPage'));
const MyFilesPage = lazy(() => import('@/pages/MyFilesPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

/** The app may be served from a sub-path (e.g. GitHub Pages: "/Filora/"); Vite exposes it as BASE_URL. */
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      children: [
        { index: true, element: <HomePage /> },
        { path: 'tools', element: <ToolsPage /> },
        { path: 'tools/:slug', element: <ToolPage /> },
        { path: 'organize', element: <CategoryPage categoryId="organize" /> },
        { path: 'optimize', element: <CategoryPage categoryId="optimize" /> },
        { path: 'convert-to-pdf', element: <CategoryPage categoryId="convert-to" /> },
        { path: 'convert-from-pdf', element: <CategoryPage categoryId="convert-from" /> },
        { path: 'edit', element: <CategoryPage categoryId="edit" /> },
        { path: 'image-tools', element: <CategoryPage categoryId="image" /> },
        { path: 'my-files', element: <MyFilesPage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename },
);
