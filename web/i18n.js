// Every word the viewer page shows, in Arabic and English.
//
// Counted phrases go through Intl.PluralRules, because Arabic agreement
// depends on the number: 3 to 10 take the plural (5 شهادات), 11 to 99 take
// the accusative singular (15 شهادةً), and 100 and above the genitive
// singular (100 شهادة), with 1 and 2 said in words. The tests check that
// every phrase has every form.

export const LANGS = ['ar', 'en'];

export const STRINGS = {
  en: {
    title: 'Tayyar',
    tagline: 'TLS certificates the moment they are written to public Certificate Transparency logs',
    status_connecting: 'Connecting',
    status_live: 'Live',
    status_retry: 'Connection lost, trying again',
    meter_label: 'Stream figures',
    filter_label: 'Filter names',
    filter_placeholder: 'A word or a regular expression, such as bank or \\.kw$',
    filter_literal: 'This is not a valid regular expression, so it is matched as plain text.',
    only_matches: 'Matches only',
    pause: 'Pause',
    resume: 'Resume',
    clear: 'Clear',
    switch_language: 'العربية',
    switch_language_label: 'Show this page in Arabic',
    empty: 'Certificates appear here as they are logged, and the first ones arrive within seconds.',
    empty_filtered: 'Nothing has matched yet, and every certificate is checked as it arrives.',
    sampling: 'The stream is faster than a page can show, so this is a sample, and every match is shown.',
    type_pre: 'Precertificate',
    type_crt: 'Issued certificate',
    col_time: 'Time',
    col_name: 'Name',
    col_issuer: 'Issuer',
    col_log: 'Log',
    endpoints: 'Connect your own tools over WebSocket at {lite}, {full} or {domains}.',
    source: 'Source code on GitHub',
  },
  ar: {
    title: 'تيّار',
    tagline: 'شهادات TLS لحظة كتابتها في سجلات شفافية الشهادات العامة',
    status_connecting: 'يجري الاتصال',
    status_live: 'بث مباشر',
    status_retry: 'انقطع الاتصال ويُعاد الآن',
    meter_label: 'أرقام البث',
    filter_label: 'رشّح الأسماء',
    filter_placeholder: 'كلمة أو تعبير نمطي، مثل \u2066bank\u2069 أو \u2066\\.kw$\u2069',
    filter_literal: 'هذا التعبير النمطي غير صالح، لذا يُطابَق بوصفه نصاً عادياً.',
    only_matches: 'المطابِق فقط',
    pause: 'إيقاف مؤقت',
    resume: 'استئناف',
    clear: 'مسح',
    switch_language: 'English',
    switch_language_label: 'اعرض الصفحة بالإنجليزية',
    empty: 'تظهر الشهادات هنا فور تسجيلها، وتصل أولاها خلال ثوانٍ.',
    empty_filtered: 'لم يطابق شيء بعد، وتُفحص كل شهادة لحظة وصولها.',
    sampling: 'البث أسرع من أن تعرضه الصفحة كاملاً، لذا تعرض عينة منه بينما تظهر كل المطابقات.',
    type_pre: 'شهادة مسبقة',
    type_crt: 'شهادة صادرة',
    col_time: 'الوقت',
    col_name: 'الاسم',
    col_issuer: 'الجهة المُصدِرة',
    col_log: 'السجل',
    endpoints: 'اربط أدواتك عبر WebSocket على {lite} أو {full} أو {domains}.',
    source: 'الشيفرة المصدرية على GitHub',
  },
};

// Forms follow the CLDR plural categories: English uses one and other,
// Arabic uses zero, one, two, few, many and other.
export const PLURALS = {
  rate: {
    en: { one: 'certificate per second', other: 'certificates per second' },
    ar: {
      zero: 'شهادة في الثانية',
      one: 'شهادة في الثانية',
      two: 'شهادتان في الثانية',
      few: 'شهادات في الثانية',
      many: 'شهادةً في الثانية',
      other: 'شهادة في الثانية',
    },
  },
  seen: {
    en: { one: 'certificate since you opened this page', other: 'certificates since you opened this page' },
    ar: {
      zero: 'شهادة منذ فتحت الصفحة',
      one: 'شهادة منذ فتحت الصفحة',
      two: 'شهادتان منذ فتحت الصفحة',
      few: 'شهادات منذ فتحت الصفحة',
      many: 'شهادةً منذ فتحت الصفحة',
      other: 'شهادة منذ فتحت الصفحة',
    },
  },
  hits: {
    en: { one: 'match for your filter', other: 'matches for your filter' },
    ar: {
      zero: 'مطابقة للمرشّح',
      one: 'مطابقة للمرشّح',
      two: 'مطابقتان للمرشّح',
      few: 'مطابقات للمرشّح',
      many: 'مطابقةً للمرشّح',
      other: 'مطابقة للمرشّح',
    },
  },
  pre: {
    en: { one: '{n} precertificate', other: '{n} precertificates' },
    ar: {
      zero: 'لا شهادات مسبقة',
      one: 'شهادة مسبقة واحدة',
      two: 'شهادتان مسبقتان',
      few: '{n} شهادات مسبقة',
      many: '{n} شهادةً مسبقة',
      other: '{n} شهادة مسبقة',
    },
  },
  crt: {
    en: { one: '{n} issued certificate', other: '{n} issued certificates' },
    ar: {
      zero: 'لا شهادات صادرة',
      one: 'شهادة صادرة واحدة',
      two: 'شهادتان صادرتان',
      few: '{n} شهادات صادرة',
      many: '{n} شهادةً صادرة',
      other: '{n} شهادة صادرة',
    },
  },
  logs: {
    en: { one: 'Reading {n} log', other: 'Reading {n} logs' },
    ar: {
      zero: 'لا يقرأ أي سجل',
      one: 'يقرأ سجلاً واحداً',
      two: 'يقرأ سجلين',
      few: 'يقرأ {n} سجلات',
      many: 'يقرأ {n} سجلاً',
      other: 'يقرأ {n} سجل',
    },
  },
  more: {
    en: { one: '{n} more name on this certificate', other: '{n} more names on this certificate' },
    ar: {
      zero: 'لا أسماء أخرى في الشهادة نفسها',
      one: 'اسم آخر في الشهادة نفسها',
      two: 'اسمان آخران في الشهادة نفسها',
      few: '{n} أسماء أخرى في الشهادة نفسها',
      many: '{n} اسماً آخر في الشهادة نفسها',
      other: '{n} اسم آخر في الشهادة نفسها',
    },
  },
};

const numberFormat = new Intl.NumberFormat('en-US');

export function formatNumber(n) {
  return numberFormat.format(n);
}

const rules = new Map();

export function plural(lang, key, n) {
  if (!rules.has(lang)) rules.set(lang, new Intl.PluralRules(lang));
  const forms = PLURALS[key][lang];
  const form = forms[rules.get(lang).select(n)] ?? forms.other;
  return form.replace('{n}', formatNumber(n));
}

export function text(lang, key) {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
}
