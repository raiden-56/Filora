import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createAppStore } from '@/store';
import { setSearchOpen } from '@/store/slices/uiSlice';
import GlobalSearch from './GlobalSearch';

function setup() {
  const store = createAppStore();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/']}>
        <GlobalSearch />
        <Routes>
          <Route path="/" element={<div>home</div>} />
          <Route path="/tools/:slug" element={<div data-testid="tool-route">tool page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

describe('GlobalSearch', () => {
  it('opens with Ctrl+K, filters tools and navigates with Enter', async () => {
    const store = setup();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(store.getState().ui.searchOpen).toBe(true));
    const box = await screen.findByRole('combobox', { name: 'Search tools' });
    fireEvent.change(box, { target: { value: 'compress' } });
    await waitFor(() => expect(screen.queryByRole('option', { name: /Merge PDF/ })).not.toBeInTheDocument());
    expect(screen.getByRole('option', { name: /Compress PDF/ })).toBeInTheDocument();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('tool-route')).toBeInTheDocument());
    expect(store.getState().ui.searchOpen).toBe(false);
  });

  it('shows both jpg tools for "jpg" and an empty state for nonsense', async () => {
    const store = setup();
    store.dispatch(setSearchOpen(true));
    const box = await screen.findByRole('combobox', { name: 'Search tools' });
    fireEvent.change(box, { target: { value: 'jpg' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /PDF to JPG/ })).toBeInTheDocument());
    expect(screen.getByRole('option', { name: /JPG to PDF/ })).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'qqqq' } });
    await waitFor(() => expect(screen.getByText(/No tools match/)).toBeInTheDocument());
  });
});
