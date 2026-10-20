import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import HomePageClient from '@/app/[locale]/HomePageClient';
import {
  setStudioDefaultStartup,
} from '@/lib/storage/default-tool';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    prefetch: vi.fn(),
  }),
  usePathname: () => '/en',
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/layout/Header', () => ({
  Header: () => <div data-testid="header-mock" />,
}));

vi.mock('@/components/layout/Footer', () => ({
  Footer: () => <div data-testid="footer-mock" />,
}));

vi.mock('@/components/tools/ToolGrid', () => ({
  ToolGrid: () => <div data-testid="toolgrid-mock" />,
}));

describe('Startup redirection to PDF Studio', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockReplace.mockClear();
  });

  it('does not redirect to studio when isStudioDefaultStartup is false', () => {
    setStudioDefaultStartup(false);
    render(<HomePageClient locale="en" />);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('redirects to studio on fresh application launch when isStudioDefaultStartup is true', () => {
    setStudioDefaultStartup(true);
    render(<HomePageClient locale="en" />);
    expect(mockReplace).toHaveBeenCalledWith('/en/studio');
    expect(sessionStorage.getItem('pdfcraft_session_active')).toBe('true');
  });

  it('allows user to browse tool selection page when returning in the same session', () => {
    setStudioDefaultStartup(true);
    sessionStorage.setItem('pdfcraft_session_active', 'true');

    render(<HomePageClient locale="en" />);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
