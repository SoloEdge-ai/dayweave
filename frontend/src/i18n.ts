import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from './locales/zh-CN.json'
import en from './locales/en.json'
import ja from './locales/ja.json'

export const languageChoices = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'ja', name: '日本語' },
  { code: 'en', name: 'English' },
] as const
export type AppLanguage = (typeof languageChoices)[number]['code']
type Catalog = Record<keyof typeof zh, string>
const resources = {
  'zh-CN': { translation: zh }, en: { translation: en satisfies Catalog },
  ja: { translation: ja satisfies Catalog },
}
const storageKey = 'dayweave.language'
export function languageOf(value?: string | null): AppLanguage {
  const base = value?.toLowerCase().split('-')[0]
  return base === 'ja' || base === 'en' ? base : 'zh-CN'
}
export const i18n = i18next.createInstance()
void i18n.use(initReactI18next).init({
  resources, lng: languageOf(localStorage.getItem(storageKey)), fallbackLng: 'zh-CN',
  initImmediate: false, keySeparator: false, nsSeparator: false,
  interpolation: { escapeValue: false },
})
document.documentElement.lang = i18n.language
export function setLanguage(value: string) {
  const language = languageOf(value)
  localStorage.setItem(storageKey, language)
  document.documentElement.lang = language
  if (i18n.language !== language) void i18n.changeLanguage(language)
}
export function message(key: keyof typeof zh) { return i18n.t(key) }
