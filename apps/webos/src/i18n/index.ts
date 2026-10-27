import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';

/** English only at launch. Every user-facing string goes through here so more languages can follow. */
export function initI18n(): void {
  void i18next.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: 'en',
    fallbackLng: 'en',
    initAsync: false,
    interpolation: { escapeValue: false },
  });
}
