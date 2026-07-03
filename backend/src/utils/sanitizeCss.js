// Strips constructs from user-supplied CSS that can be used to exfiltrate
// data or load external resources: @import, url(...) (attribute/CSS
// exfiltration and remote stylesheet loading), old IE expression()/behavior,
// and any raw "javascript:" reference. This is a blunt allow-most/strip-a-few
// filter, not a full CSS parser — it favors keeping the feature usable
// (colors, fonts, spacing) over completeness.
function sanitizeCss(css) {
  if (typeof css !== 'string') return '';
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/behavior\s*:[^;]*;?/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/<\/?script[^>]*>/gi, '');
}

module.exports = { sanitizeCss };
