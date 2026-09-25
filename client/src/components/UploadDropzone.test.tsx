import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UploadDropzone from './UploadDropzone';

describe('UploadDropzone', () => {
  it('renders title, hint and browse button, and forwards selected files', async () => {
    const onFiles = vi.fn();
    render(<UploadDropzone accept={['pdf']} multiple onFiles={onFiles} title="Drop your PDF files here" />);
    expect(screen.getByRole('button', { name: 'Drop your PDF files here' })).toBeInTheDocument();
    expect(screen.getByText(/PDF supported/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse Files' })).toBeInTheDocument();

    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onFiles).toHaveBeenCalled());
    expect(onFiles.mock.calls[0][0][0].name).toBe('a.pdf');
  });

  it('is keyboard accessible and can be disabled', () => {
    const onFiles = vi.fn();
    const { rerender } = render(<UploadDropzone accept={['image']} onFiles={onFiles} />);
    const zone = screen.getByRole('button', { name: 'Upload files' });
    expect(zone).toHaveAttribute('tabindex', '0');
    rerender(<UploadDropzone accept={['image']} onFiles={onFiles} disabled />);
    expect(screen.getByRole('button', { name: 'Upload files' })).toHaveAttribute('aria-disabled', 'true');
  });
});
