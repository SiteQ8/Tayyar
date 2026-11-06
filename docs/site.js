// Shows the page in Arabic or English, runs Tayyar's own name check for the
// "Try a name" panel, and plays the page's few motions. It is loaded in the
// head, so the language is set before anything is drawn and the wrong one
// never flashes.
(function (global) {
  'use strict';
  var doc = global.document;
  var root = doc.documentElement;
  root.classList.add('js');

  // ---------- Language: remembered, and Arabic unless the browser says otherwise ----------
  var TITLES = { ar: 'تيّار | كل اسم يقلّد علامتك', en: 'Tayyar | Every name that imitates your brand' };
  var langListeners = [];
  function setLang(lang) {
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    doc.title = TITLES[lang];
    try {
      global.localStorage.setItem('tayyar-site-lang', lang);
    } catch (e) {
      // Not remembered, still switched.
    }
    langListeners.forEach(function (fn) { fn(lang); });
  }
  var saved = null;
  try {
    saved = global.localStorage.getItem('tayyar-site-lang');
  } catch (e) {
    saved = null;
  }
  var browser = ((global.navigator && global.navigator.language) || '').toLowerCase();
  setLang(saved === 'ar' || saved === 'en' ? saved : (browser.indexOf('ar') === 0 ? 'ar' : 'en'));

  // ---------- The name check: the same rules as src/detect.js, line for line ----------
  // A test in test/repo.test.js runs this copy against the real one, so they cannot drift apart.
  var LOOKALIKES = {
    // Cyrillic
    'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c',
    'т': 't', 'у': 'y', 'х': 'x', 'ѕ': 's', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w',
    'һ': 'h', 'ӏ': 'l',
    // Armenian
    'ո': 'n', 'ս': 'u', 'օ': 'o',
    // Greek
    'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't',
    'υ': 'u', 'χ': 'x', 'ω': 'w',
    // Latin letters without a decomposition
    'ı': 'i', 'ł': 'l', 'ø': 'o', 'đ': 'd', 'ħ': 'h', 'ŀ': 'l', 'ɡ': 'g', 'ɑ': 'a', 'ɩ': 'i', 'ʀ': 'r',
    // Arabic letters that read alike
    'ى': 'ي', 'ی': 'ي', 'ک': 'ك', 'ة': 'ه', 'ە': 'ه', 'ہ': 'ه', 'ھ': 'ه', 'ٱ': 'ا'
  };
  var MARKS = /[̀-ًͯ-ٰٟـ]/g;
  var DIGIT_SWAPS = [
    { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' },
    { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' }
  ];
  var LURE_WORDS = [
    'login', 'signin', 'secure', 'verify', 'verification', 'update', 'account', 'auth', 'otp', 'pay',
    'payment', 'billing', 'invoice', 'refund', 'wallet', 'bank', 'card', 'reward', 'gift', 'prize',
    'claim', 'confirm', 'unlock', 'support', 'service', 'kyc', 'fines', 'parcel', 'delivery',
    'tracking', 'customs',
    'دخول', 'تسجيل', 'تحقق', 'تأكيد', 'تحديث', 'حساب', 'دفع', 'سداد', 'بطاقة', 'بنك', 'مكافأة',
    'جائزة', 'استرداد', 'مخالفات', 'شحنة', 'طرد', 'بريد'
  ];
  var SECOND_LEVEL = new Set(['com', 'net', 'org', 'gov', 'edu', 'co', 'ac', 'mil', 'biz', 'info', 'nic', 'sch', 'ltd', 'plc', 'or', 'ne', 'go', 'gob', 'gouv']);
  var PATTERN_SCORES = { low: 45, medium: 65, high: 85 };

  function severityOf(score) {
    if (score >= 80) return 'high';
    if (score >= 60) return 'medium';
    return 'low';
  }

  function fold(text) {
    var s = String(text).normalize('NFKC').toLowerCase().normalize('NFD').replace(MARKS, '');
    s = s.replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x6f0); });
    var out = '';
    for (var ch of s) out += LOOKALIKES[ch] !== undefined ? LOOKALIKES[ch] : ch;
    return out;
  }

  function foldMap(text) {
    var chars = [];
    var from = [];
    var i = 0;
    for (var ch of String(text)) {
      for (var c of fold(ch)) {
        chars.push(c);
        from.push(i);
      }
      i += 1;
    }
    return { text: chars.join(''), chars: chars, from: from };
  }

  function unswapMap(chars, from) {
    return DIGIT_SWAPS.map(function (digits) {
      var out = [];
      var start = [];
      var stop = [];
      var swaps = [];
      for (var i = 0; i < chars.length; i++) {
        var a = chars[i];
        var b = chars[i + 1];
        if ((a === 'r' && b === 'n') || (a === 'v' && b === 'v')) {
          var to = a === 'r' ? 'm' : 'w';
          out.push(to);
          start.push(from[i]);
          stop.push(from[i + 1] + 1);
          swaps.push({ at: from[i], from: a + b, to: to });
          i += 1;
        } else if (digits[a] !== undefined) {
          out.push(digits[a]);
          start.push(from[i]);
          stop.push(from[i] + 1);
          swaps.push({ at: from[i], from: a, to: digits[a] });
        } else {
          out.push(a);
          start.push(from[i]);
          stop.push(from[i] + 1);
        }
      }
      return { text: out.join(''), start: start, stop: stop, swaps: swaps };
    });
  }

  function editDistance(a, b, max) {
    if (max === undefined) max = 2;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var before = null;
    var prev = [];
    for (var j0 = 0; j0 <= b.length; j0++) prev.push(j0);
    for (var i = 1; i <= a.length; i++) {
      var cur = new Array(b.length + 1);
      cur[0] = i;
      var rowMin = i;
      for (var j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      before = prev;
      prev = cur;
    }
    return prev[b.length];
  }

  function splitDomain(domain) {
    var labels = domain.split('.');
    var n = labels.length;
    if (n === 2 && labels[1].length === 2 && SECOND_LEVEL.has(labels[0])) return { name: '', suffix: domain, sub: [] };
    if (n >= 3 && labels[n - 1].length === 2 && SECOND_LEVEL.has(labels[n - 2])) {
      return { name: labels[n - 3], suffix: labels.slice(-2).join('.'), sub: labels.slice(0, -3) };
    }
    if (n >= 2) return { name: labels[n - 2], suffix: labels[n - 1], sub: labels.slice(0, -2) };
    return { name: labels[0] || '', suffix: '', sub: [] };
  }

  function cp(text, index) {
    return index < 0 ? -1 : Array.from(text.slice(0, index)).length;
  }

  function keywordFinder(k) {
    if (Array.from(k).length >= 5) return function (text) { return cp(text, text.indexOf(k)); };
    var re = new RegExp('(?:^|[^\\p{L}\\p{N}])(' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'u');
    return function (text) {
      var m = re.exec(text);
      return m ? cp(text, m.index + m[0].length - m[1].length) : -1;
    };
  }

  var LURES = LURE_WORDS.map(function (w) { return { w: w, length: Array.from(fold(w)).length, find: keywordFinder(fold(w)) }; });

  var SCRIPTS = [
    [0x0400, 0x052f, 'cyrillic'], [0x0370, 0x03ff, 'greek'], [0x1f00, 0x1fff, 'greek'], [0x0530, 0x058f, 'armenian'],
    [0x0600, 0x06ff, 'arabic_variant'], [0x0750, 0x077f, 'arabic_variant'], [0xfb50, 0xfdff, 'arabic_variant'],
    [0xfe70, 0xfeff, 'arabic_variant'], [0xff00, 0xffef, 'fullwidth'], [0x00c0, 0x024f, 'latin'], [0x0250, 0x02af, 'latin'],
    [0x1e00, 0x1eff, 'latin']
  ];

  function scriptOf(ch) {
    var code = ch.codePointAt(0);
    var hit = SCRIPTS.find(function (s) { return code >= s[0] && code <= s[1]; });
    if (!hit) return 'other';
    if (hit[2] !== 'latin') return hit[2];
    return ch.normalize('NFD').length > ch.length ? 'latin_marked' : 'latin_variant';
  }

  function oddChars(text, range) {
    var out = [];
    Array.from(text).forEach(function (ch, i) {
      if (i < range[0] || i >= range[1]) return;
      var as = fold(ch);
      if (as !== ch.toLowerCase()) out.push({ at: i, char: ch, as: as, code: 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'), script: scriptOf(ch) });
    });
    return out;
  }

  function spanOf(folded, at, length) {
    return [folded.from[at], folded.from[at + length - 1] + 1];
  }

  // Punycode decoding (RFC 3492), as in web/punycode.js, for names that arrive as xn-- labels.
  function decodeLabel(input) {
    var output = [];
    var basic = Math.max(0, input.lastIndexOf('-'));
    for (var j = 0; j < basic; j++) {
      if (input.charCodeAt(j) >= 0x80) throw new Error('non-basic code point before delimiter');
      output.push(input.charCodeAt(j));
    }
    var i = 0;
    var n = 128;
    var bias = 72;
    for (var index = basic > 0 ? basic + 1 : 0; index < input.length;) {
      var oldi = i;
      for (var w = 1, k = 36; ; k += 36) {
        if (index >= input.length) throw new Error('truncated input');
        var c = input.charCodeAt(index++);
        var digit = c >= 0x30 && c <= 0x39 ? c - 22 : c >= 0x41 && c <= 0x5a ? c - 0x41 : c >= 0x61 && c <= 0x7a ? c - 0x61 : 36;
        if (digit >= 36) throw new Error('invalid digit');
        if (digit > Math.floor((0x7fffffff - i) / w)) throw new Error('overflow');
        i += digit * w;
        var t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
        if (digit < t) break;
        if (w > Math.floor(0x7fffffff / (36 - t))) throw new Error('overflow');
        w *= 36 - t;
      }
      var out = output.length + 1;
      var delta = oldi === 0 ? Math.floor((i - oldi) / 700) : (i - oldi) >> 1;
      delta += Math.floor(delta / out);
      var kk = 0;
      while (delta > ((36 - 1) * 26) >> 1) {
        delta = Math.floor(delta / 35);
        kk += 36;
      }
      bias = kk + Math.floor((36 * delta) / (delta + 38));
      if (Math.floor(i / out) > 0x7fffffff - n) throw new Error('overflow');
      n += Math.floor(i / out);
      i %= out;
      output.splice(i++, 0, n);
    }
    return String.fromCodePoint.apply(String, output);
  }

  function unicodeDomain(domain) {
    if (domain.indexOf('xn--') < 0) return domain;
    var wildcard = domain.indexOf('*.') === 0;
    var bare = wildcard ? domain.slice(2) : domain;
    var decoded;
    try {
      decoded = bare.split('.').map(function (label) { return /^xn--/i.test(label) ? decodeLabel(label.slice(4).toLowerCase()) : label; }).join('.');
    } catch (e) {
      return domain;
    }
    return wildcard ? '*.' + decoded : decoded;
  }

  // What the interface's name tester does with what you paste: the host of a
  // link, or the name itself, in the ASCII form a certificate carries.
  function hostFrom(input) {
    var s = String(input || '').trim();
    if (s.indexOf('://') >= 0) {
      try {
        s = new URL(s).hostname;
      } catch (e) {
        return '';
      }
    }
    s = s.replace(/[/?#].*$/, '').replace(/\.$/, '').toLowerCase().replace(/^\*\./, '');
    if (!s || /[@:\s]/.test(s)) return '';
    try {
      return new URL('http://' + s).hostname;
    } catch (e) {
      return '';
    }
  }

  function compileWatchlist(items) {
    var brands = [];
    var patterns = [];
    (items || []).forEach(function (item) {
      if (item.enabled === false) return;
      var ref = { id: item.id, name: item.name, kind: item.kind };
      if (item.kind === 'pattern') {
        try {
          patterns.push({ ref: ref, re: new RegExp(item.pattern, 'iu'), score: PATTERN_SCORES[item.severity] !== undefined ? PATTERN_SCORES[item.severity] : PATTERN_SCORES.medium });
        } catch (e) {
          // An invalid pattern is refused when it is saved.
        }
        return;
      }
      var domains = (item.domains || []).map(function (d) { return fold(unicodeDomain(d.toLowerCase().replace(/^\*\./, '').replace(/\.$/, ''))); });
      var endings = new Map();
      domains.forEach(function (d) {
        var p = splitDomain(d);
        if (Array.from(p.name).length >= 3) endings.set(p.name, (endings.get(p.name) || []).concat([p.suffix]));
      });
      var names = new Set(endings.keys());
      var words = new Set((item.keywords || []).map(function (k) { return fold(k.trim()); }).filter(function (k) { return Array.from(k).length >= 3; }));
      names.forEach(function (n) { if (Array.from(n).length >= 4) words.add(n); });
      brands.push({ ref: ref, domains: domains, names: names, endings: endings, keywords: Array.from(words).map(function (k) { return { k: k, find: keywordFinder(k) }; }) });
    });
    return { brands: brands, patterns: patterns, size: brands.length + patterns.length };
  }

  function detectDomain(domain, compiled) {
    var raw = String(domain).toLowerCase().replace(/^\*\./, '');
    var unicode = unicodeDomain(raw);
    var shown = unicode !== raw ? unicode : null;
    var findings = [];
    if (!compiled.size) return findings;
    var folded = foldMap(unicode);
    var plain = folded.text;
    var direct = unicode.toLowerCase();
    var parts = splitDomain(plain);
    var pieces = parts.sub.concat([parts.name]).reduce(function (all, l) { return all.concat([l], l.split('-')); }, []).filter(function (p) { return Array.from(p).length >= 3; });
    var lures = LURES.map(function (l) { return { w: l.w, length: l.length, at: l.find(plain) }; }).filter(function (l) { return l.at >= 0; });
    var lureEvidence = lures.length ? { reason: 'lure-word', words: lures.map(function (l) { return l.w; }), at: lures.map(function (l) { return spanOf(folded, l.at, l.length); }) } : null;
    var variants = null;

    compiled.brands.forEach(function (b) {
      if (b.domains.some(function (d) { return plain === d || plain.endsWith('.' + d); })) return;
      var evidence = new Map();
      var score = 0;
      function bump(reason, value, detail) {
        if (!evidence.has(reason)) evidence.set(reason, Object.assign({ reason: reason }, detail));
        score = Math.max(score, value);
      }
      b.domains.forEach(function (d) {
        if (d.indexOf('.') < 0) return;
        var at = cp(plain, plain.indexOf(d));
        if (at >= 0) {
          bump('embedded-domain', 90, { domain: d, form: 'dots', at: spanOf(folded, at, Array.from(d).length) });
          return;
        }
        var written = d.replace(/\./g, '-');
        var dashed = cp(plain, plain.indexOf(written));
        if (dashed >= 0) bump('embedded-domain', 85, { domain: d, form: 'hyphens', written: written, at: spanOf(folded, dashed, Array.from(written).length) });
      });
      if (b.names.has(parts.name)) bump('tld-swap', 75, { name: parts.name, ending: parts.suffix, real: b.endings.get(parts.name) });
      b.keywords.forEach(function (kw) {
        var k = kw.k;
        var find = kw.find;
        var length = Array.from(k).length;
        var at = find(plain);
        if (at >= 0) {
          var span = spanOf(folded, at, length);
          if (find(direct) < 0) {
            bump('homoglyph', 85, { word: k, at: span, chars: oddChars(unicode, span) });
          } else {
            var s = 55;
            var label = find(parts.name) < 0 ? parts.sub.find(function (l) { return find(l) >= 0; }) : undefined;
            if (label !== undefined) {
              if (!evidence.has('subdomain')) evidence.set('subdomain', { reason: 'subdomain', label: label });
              s += 10;
            }
            bump('keyword', s, { word: k, at: span });
          }
          return;
        }
        if (!variants) variants = unswapMap(folded.chars, folded.from);
        var swapped = null;
        for (var vi = 0; vi < variants.length; vi++) {
          var v = variants[vi];
          var i = find(v.text);
          if (i >= 0) {
            swapped = { v: v, span: [v.start[i], v.stop[i + length - 1]] };
            break;
          }
        }
        if (swapped) {
          var sp = swapped.span;
          bump('swap', 75, { word: k, at: sp, swaps: swapped.v.swaps.filter(function (w) { return w.at >= sp[0] && w.at < sp[1]; }) });
          return;
        }
        if (length >= 5 || (length === 4 && lures.length)) {
          var max = length >= 8 ? 2 : 1;
          for (var pi = 0; pi < pieces.length; pi++) {
            var piece = pieces[pi];
            var size = Array.from(piece).length;
            if (size < Math.max(4, length - 1)) continue;
            if (length === 4 && piece[0] !== k[0]) continue;
            var distance = editDistance(piece, k, max);
            if (distance > 0 && distance <= max) {
              var where = cp(plain, plain.indexOf(piece));
              bump('typo', distance === 1 ? (length >= 5 ? 70 : 60) : 55, { word: k, piece: piece, distance: distance, at: where >= 0 ? spanOf(folded, where, size) : null });
              break;
            }
          }
        }
      });
      if (!evidence.size) return;
      if (lureEvidence) {
        evidence.set('lure-word', lureEvidence);
        score += 15;
      }
      if (raw.indexOf('xn--') >= 0) {
        evidence.set('idn', { reason: 'idn', ascii: raw });
        score += 5;
      }
      score = Math.min(100, score);
      var list = Array.from(evidence.values());
      findings.push({ watch: b.ref, domain: domain, unicode: shown, score: score, severity: severityOf(score), reasons: list.map(function (e) { return e.reason; }), evidence: list });
    });
    compiled.patterns.forEach(function (p) {
      var on = 'ascii';
      var m = p.re.exec(raw);
      if (!m && shown) {
        on = 'unicode';
        m = p.re.exec(shown);
      }
      if (!m) return;
      var text = on === 'ascii' ? raw : shown;
      findings.push({
        watch: p.ref, domain: domain, unicode: shown, score: p.score, severity: severityOf(p.score), reasons: ['pattern'],
        evidence: [{ reason: 'pattern', pattern: p.re.source, on: on, at: [cp(text, m.index), cp(text, m.index + m[0].length)] }]
      });
    });
    return findings;
  }

  // The sample watchlist the page checks against: names reserved for examples only.
  var SAMPLE = [
    { id: 'example', kind: 'brand', name: 'Example', domains: ['example.com', 'example.net'], keywords: ['example'] },
    { id: 'mithal', kind: 'brand', name: 'مثال', domains: [], keywords: ['مثال'] }
  ];
  var compiledSample = compileWatchlist(SAMPLE);

  function check(input, items) {
    var host = hostFrom(input);
    if (!host) return { domain: '', findings: [] };
    return { domain: host, findings: detectDomain(host, items ? compileWatchlist(items) : compiledSample) };
  }
  global.tayyarCheck = { check: check, hostFrom: hostFrom, sample: SAMPLE };

  // ---------- The "Try a name" panel, in the interface's own words ----------
  var WORDS = {
    ar: {
      sev: { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' },
      like: 'يشبه {name}',
      none: 'لا يطابق أي إدخال في القائمة هذا الاسم.',
      invalid: 'هذا ليس اسم نطاق صالحاً.',
      reason: {
        keyword: 'كلمة العلامة', subdomain: 'العلامة نطاق فرعي', 'lure-word': 'كلمة استدراج', 'embedded-domain': 'النطاق الحقيقي بداخله',
        homoglyph: 'حروف متشابهة', swap: 'محارف مستبدلة', typo: 'خطأ إملائي', 'tld-swap': 'امتداد آخر', idn: 'حروف دولية', pattern: 'نمطك'
      },
      ev: {
        embedded: 'كُتب النطاق الحقيقي {domain} داخل هذا الاسم.',
        embeddedHyphens: 'كُتب النطاق الحقيقي {domain} بواصلات مكان النقاط، أي {written}.',
        tldSwap: 'الاسم {name} بالامتداد {ending}، بينما تستعمل العلامة {real}.',
        keyword: 'يحتوي على {word}.',
        subdomain: 'تقع الكلمة في النطاق الفرعي {label}.',
        char: '{char} برمز {code} {script}، ويُقرأ {as}.',
        charDropped: '{char} برمز {code} {script}، ويُحذف قبل المقارنة.',
        swap: 'يحل {from} محل {to}.',
        typo1: 'يبعد {piece} عن {word} حرفاً واحداً.',
        typo2: 'يبعد {piece} عن {word} حرفين.',
        lure: 'كلمات الاستدراج: {words}.',
        idn: 'تكتبه الشهادة هكذا {ascii}.',
        pattern: 'يطابق التعبير {pattern}.'
      },
      script: {
        cyrillic: 'حرف كيريلي', greek: 'حرف يوناني', armenian: 'حرف أرمني', arabic_variant: 'صورة أخرى لحرف عربي',
        latin_marked: 'حرف لاتيني بعلامة', latin_variant: 'صورة أخرى لحرف لاتيني', fullwidth: 'حرف عريض', other: 'حرف من خط آخر'
      },
      legend: { brand: 'العلامة', odd: 'محرف مشابه', lure: 'كلمة استدراج' },
      comma: '، ',
      copied: 'نُسخ الأمر.'
    },
    en: {
      sev: { high: 'High', medium: 'Medium', low: 'Low' },
      like: 'looks like {name}',
      none: 'No entry on the watchlist matches this name.',
      invalid: 'That is not a valid domain name.',
      reason: {
        keyword: 'Brand word', subdomain: 'Brand as a subdomain', 'lure-word': 'Lure word', 'embedded-domain': 'Real domain inside',
        homoglyph: 'Look-alike letters', swap: 'Swapped characters', typo: 'Misspelling', 'tld-swap': 'Other ending', idn: 'International letters', pattern: 'Your pattern'
      },
      ev: {
        embedded: 'The real domain {domain} is written inside this name.',
        embeddedHyphens: 'The real domain {domain} is written with hyphens for dots, as {written}.',
        tldSwap: '{name} under {ending}, while the brand uses {real}.',
        keyword: 'It contains {word}.',
        subdomain: 'The word sits in the subdomain {label}.',
        char: '{char} ({code}) is {script}, and reads as {as}.',
        charDropped: '{char} ({code}) is {script}, and is dropped before comparing.',
        swap: '{from} stands in for {to}.',
        typo1: '{piece} is one letter away from {word}.',
        typo2: '{piece} is 2 letters away from {word}.',
        lure: 'Lure words: {words}.',
        idn: 'The certificate writes it as {ascii}.',
        pattern: 'It matches {pattern}.'
      },
      script: {
        cyrillic: 'a Cyrillic letter', greek: 'a Greek letter', armenian: 'an Armenian letter', arabic_variant: 'another form of an Arabic letter',
        latin_marked: 'a Latin letter with a mark', latin_variant: 'another form of a Latin letter', fullwidth: 'a full width letter', other: 'a letter from another script'
      },
      legend: { brand: 'The brand', odd: 'Look-alike', lure: 'Lure word' },
      comma: ', ',
      copied: 'Command copied.'
    }
  };
  var DEFAULT_NAME = { ar: 'مثأل-دفع.test', en: 'еxample-pay.test' };
  var MARKED = new Set(['keyword', 'embedded-domain', 'typo', 'swap', 'homoglyph']);

  function el(tag, attrs, kids) {
    var node = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (kid) { if (kid !== null && kid !== undefined) node.append(kid); });
    return node;
  }

  // Fills a sentence, keeping each name or code in its own isolated run so it reads in either direction.
  function sentence(template, vars) {
    var out = [];
    template.split(/(\{\w+\})/).forEach(function (part) {
      var m = /^\{(\w+)\}$/.exec(part);
      if (!m) {
        if (part) out.push(doc.createTextNode(part));
      } else {
        var v = vars[m[1]];
        out.push(v && v.nodeType ? v : el('bdi', { class: 'ev-val', dir: m[1] === 'script' ? 'auto' : 'ltr' }, [String(v)]));
      }
    });
    return out;
  }

  function ribbon(name, evidence) {
    var chars = Array.from(name);
    var marks = chars.map(function () { return new Set(); });
    function mark(range, c) {
      if (!range) return;
      for (var i = range[0]; i < range[1] && i < chars.length; i++) marks[i].add(c);
    }
    evidence.forEach(function (e) {
      if (MARKED.has(e.reason)) mark(e.at, 'ev-brand');
      if (e.reason === 'homoglyph') (e.chars || []).forEach(function (c) { mark([c.at, c.at + 1], 'ev-odd'); });
      if (e.reason === 'swap') (e.swaps || []).forEach(function (s) { mark([s.at, s.at + Array.from(s.from).length], 'ev-odd'); });
      if (e.reason === 'lure-word') (e.at || []).forEach(function (r) { mark(r, 'ev-lure'); });
      if (e.reason === 'pattern' && e.on === 'ascii') mark(e.at, 'ev-brand');
    });
    for (var i = 1; i < chars.length; i++) if (/\p{M}/u.test(chars[i])) marks[i] = marks[i - 1];
    var out = el('bdi', { dir: 'ltr' });
    var run = '';
    var key = '';
    function flush() {
      if (run) out.append(key ? el('span', { class: key }, [run]) : doc.createTextNode(run));
      run = '';
    }
    chars.forEach(function (ch, idx) {
      var k = Array.from(marks[idx]).sort().join(' ');
      if (k !== key) {
        flush();
        key = k;
      }
      run += ch;
    });
    flush();
    return out;
  }

  function evidenceLines(e, W) {
    switch (e.reason) {
      case 'embedded-domain':
        return [e.form === 'hyphens' ? sentence(W.ev.embeddedHyphens, { domain: e.domain, written: e.written }) : sentence(W.ev.embedded, { domain: e.domain })];
      case 'tld-swap':
        return [sentence(W.ev.tldSwap, { name: e.name, ending: '.' + e.ending, real: (e.real || []).map(function (r) { return '.' + r; }).join(' ') })];
      case 'keyword':
        return [sentence(W.ev.keyword, { word: e.word })];
      case 'subdomain':
        return [sentence(W.ev.subdomain, { label: e.label })];
      case 'homoglyph':
        return (e.chars || []).map(function (c) { return sentence(c.as ? W.ev.char : W.ev.charDropped, { char: c.char, code: c.code, script: doc.createTextNode(W.script[c.script]), as: c.as }); });
      case 'swap':
        return (e.swaps || []).map(function (s) { return sentence(W.ev.swap, { from: s.from, to: s.to }); });
      case 'typo':
        return [sentence(e.distance === 1 ? W.ev.typo1 : W.ev.typo2, { piece: e.piece, word: e.word })];
      case 'lure-word': {
        var words = doc.createDocumentFragment();
        (e.words || []).forEach(function (w, i) {
          if (i) words.append(W.comma);
          words.append(el('bdi', { class: 'ev-val', dir: 'auto' }, [w]));
        });
        return [sentence(W.ev.lure, { words: words })];
      }
      case 'idn':
        return [sentence(W.ev.idn, { ascii: e.ascii })];
      case 'pattern':
        return [sentence(W.ev.pattern, { pattern: e.pattern })];
      default:
        return [];
    }
  }

  function renderTry(out, value) {
    var W = WORDS[root.lang === 'ar' ? 'ar' : 'en'];
    var result = check(value);
    var kids = [];
    if (!result.domain) {
      if (String(value || '').trim()) kids.push(el('p', { class: 'slip-none' }, [W.invalid]));
      out.replaceChildren.apply(out, kids);
      return;
    }
    var shownName = unicodeDomain(result.domain).toLowerCase();
    if (!result.findings.length) {
      kids.push(el('p', { class: 'slip-name' }, [el('bdi', { dir: 'ltr' }, [shownName])]));
      kids.push(el('p', { class: 'slip-none' }, [W.none]));
      out.replaceChildren.apply(out, kids);
      return;
    }
    result.findings.forEach(function (f, n) {
      var name = (f.unicode || String(f.domain).replace(/^\*\./, '')).toLowerCase();
      var drawn = ribbon(name, f.evidence || []);
      if (n === 0) kids.push(el('p', { class: 'slip-name' }, [drawn]));
      var like = sentence(W.like, { name: el('bdi', { dir: 'auto' }, [f.watch.name]) });
      kids.push(el('p', { class: 'slip-verdict sev-' + f.severity }, [el('b', { class: 'score' }, [String(f.score)]), el('span', { class: 'sev' }, [W.sev[f.severity]]), el('span', { class: 'like' }, like)]));
      kids.push(el('ul', { class: 'slip-why' }, (f.evidence || []).map(function (e) {
        return el('li', {}, [el('b', {}, [W.reason[e.reason]])].concat(evidenceLines(e, W).map(function (line) { return el('span', { class: 'why' }, line); })));
      })));
      if (n === 0) {
        var used = ['brand', 'odd', 'lure'].filter(function (c) { return drawn.querySelector('.ev-' + c); });
        if (used.length) kids.push(el('p', { class: 'slip-legend' }, used.map(function (c) { return el('span', { class: 'l-' + c }, [W.legend[c]]); })));
      }
    });
    out.replaceChildren.apply(out, kids);
  }

  // ---------- Wiring, once the page is there ----------
  function ms(name, fallback) {
    var v = global.getComputedStyle(root).getPropertyValue(name).trim();
    var n = parseFloat(v);
    return isNaN(n) ? fallback : (/ms$/.test(v) ? n : n * 1000);
  }

  function copyText(text) {
    if (global.navigator && global.navigator.clipboard && global.isSecureContext) return global.navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = el('textarea', { readonly: '', 'aria-hidden': 'true' }, [text]);
      area.style.position = 'fixed';
      area.style.opacity = '0';
      doc.body.append(area);
      area.select();
      var ok = false;
      try {
        ok = doc.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      area.remove();
      if (ok) resolve();
      else reject(new Error('copy failed'));
    });
  }

  doc.addEventListener('DOMContentLoaded', function () {
    var calm = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var announce = doc.getElementById('announce');

    doc.getElementById('lang').addEventListener('click', function () {
      setLang(root.lang === 'ar' ? 'en' : 'ar');
    });

    // Copy buttons: the hero's and the band's.
    Array.prototype.forEach.call(doc.querySelectorAll('[data-copy]'), function (button) {
      var timer = 0;
      button.addEventListener('click', function () {
        copyText(button.getAttribute('data-copy')).then(function () {
          button.classList.add('is-copied');
          if (announce) announce.textContent = WORDS[root.lang === 'ar' ? 'ar' : 'en'].copied;
          global.clearTimeout(timer);
          timer = global.setTimeout(function () {
            button.classList.remove('is-copied');
            if (announce) announce.textContent = '';
          }, 2000);
        }, function () {
          // The command stays on the page to copy by hand.
        });
      });
    });

    // Try a name.
    var input = doc.getElementById('try-name');
    var out = doc.getElementById('try-out');
    var chips = Array.prototype.slice.call(doc.querySelectorAll('.chip'));
    var touched = false;
    function press() {
      chips.forEach(function (chip) { chip.setAttribute('aria-pressed', String(chip.getAttribute('data-name') === input.value.trim())); });
    }
    function draw(animate) {
      out.style.setProperty('--mark-delay', '0ms');
      out.classList.toggle('is-drawing', animate && !calm);
      renderTry(out, input.value);
      press();
    }
    if (input && out) {
      if (input.value === DEFAULT_NAME.ar && root.lang === 'en') input.value = DEFAULT_NAME.en;
      // The evidence appears on the name once the slip has opened.
      out.style.setProperty('--mark-delay', Math.round(ms('--t-open', 1000) * 0.6) + 'ms');
      renderTry(out, input.value);
      press();
      input.addEventListener('input', function () {
        touched = true;
        draw(false);
      });
      chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
          touched = true;
          input.value = chip.getAttribute('data-name');
          draw(true);
        });
      });
      langListeners.push(function (lang) {
        if (!touched) input.value = DEFAULT_NAME[lang];
        draw(false);
      });
    }

    // Each section's parts play their entrance as they come on screen. Nothing is hidden
    // before that, so a jump down the page, a link to a section or a print shows everything.
    if ('IntersectionObserver' in global && !calm) {
      var seen = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            seen.unobserve(entry.target);
          }
        });
      });
      Array.prototype.forEach.call(doc.querySelectorAll('[data-reveal], .pair-odd'), function (node) {
        // What is already on the first screen is not replayed.
        if (node.getBoundingClientRect().top < global.innerHeight) return;
        seen.observe(node);
      });
    }

    // The current moves only while it is on screen.
    var flow = doc.getElementById('flow');
    if (flow && 'IntersectionObserver' in global && !calm) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { flow.classList.toggle('is-moving', entry.isIntersecting); });
      }, { threshold: 0.2 }).observe(flow);
    }
  });
})(this);
