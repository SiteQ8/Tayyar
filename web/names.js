// Display helpers shared by the viewer page and the command line, so both
// show the same short names.

// "Let's Encrypt 'Sycamore2026h2'" reads better as "Sycamore2026h2". The
// opening quote must follow a space, or the apostrophe in "Let's" would count.
export function shortLogName(name) {
  const quoted = / '([^']+)'/.exec(name);
  return (quoted ? quoted[1] : name.replace(/\s+log$/i, '')).trim();
}

// "Let's Encrypt" and "YE2" become "Let's Encrypt YE2", but "Amazon" and
// "Amazon RSA 2048 M04" stay "Amazon RSA 2048 M04" rather than repeat the name.
export function issuerName(issuer) {
  if (!issuer) return '';
  const { O: org, CN: cn } = issuer;
  if (org && cn) {
    const firstWord = org.split(/[\s,.]+/)[0].toLowerCase();
    if (firstWord && cn.toLowerCase().includes(firstWord)) return cn;
  }
  return [org, cn].filter(Boolean).join(' ');
}
