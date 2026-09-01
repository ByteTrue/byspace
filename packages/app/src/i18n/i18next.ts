import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { observeI18nInit } from "./init";
import { rebrandResource } from "./branding";
import { ar } from "./resources/ar";
import { en } from "./resources/en";
import { es } from "./resources/es";
import { fr } from "./resources/fr";
import { ja } from "./resources/ja";
import { ko } from "./resources/ko";
import { ptBR } from "./resources/pt-BR";
import { ru } from "./resources/ru";
import { zhCN } from "./resources/zh-CN";

const i18n = createInstance();

observeI18nInit(
  i18n.use(initReactI18next).init({
    compatibilityJSON: "v4",
    fallbackLng: "en",
    lng: "en",
    resources: {
      ar: { translation: rebrandResource(ar) },
      en: { translation: rebrandResource(en) },
      es: { translation: rebrandResource(es) },
      fr: { translation: rebrandResource(fr) },
      ja: { translation: rebrandResource(ja) },
      ko: { translation: rebrandResource(ko) },
      "pt-BR": { translation: rebrandResource(ptBR) },
      ru: { translation: rebrandResource(ru) },
      "zh-CN": { translation: rebrandResource(zhCN) },
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  }),
);

export { i18n };
