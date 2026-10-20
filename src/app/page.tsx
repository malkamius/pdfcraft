'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { locales, defaultLocale } from '@/lib/i18n/config';
import { isStudioDefaultStartup } from '@/lib/storage/default-tool';

// Root page handles client-side redirection based on browser language
export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    try {
      // Get browser language
      const browserLang = navigator.language;
      const primaryLang = browserLang.split('-')[0];
      const targetLang = (locales as readonly string[]).includes(primaryLang) ? primaryLang : defaultLocale;

      if (isStudioDefaultStartup()) {
        router.replace(`/${targetLang}/studio`);
        return;
      }

      router.replace(`/${targetLang}`);
    } catch (error) {
      // Fallback to default locale if anything goes wrong
      router.replace(`/${defaultLocale}`);
    }
  }, [router]);

  // Render nothing while redirecting
  return null;
}
