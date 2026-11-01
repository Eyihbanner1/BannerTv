import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import calendar from './calendar.en.json';
import en from './en.json';

/** English only at launch. Every user-facing string goes through here so more languages can follow. */
export function initI18n(): void {
  void i18next.use(initReactI18next).init({
    // The calendar's words sit in their own file, under `calendar.`.
    resources: { en: { translation: { ...en, calendar } } },
    lng: 'en',
    fallbackLng: 'en',
    initAsync: false,
    interpolation: { escapeValue: false },
  });
}
