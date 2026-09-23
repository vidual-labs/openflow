// Browser autofill (the HTML `autocomplete` attribute).
//
// Browsers only offer to prefill a field from the visitor's saved profile
// (Chrome's address/contact autofill, Safari's AutoFill, password managers)
// when they can tell what the field holds. Typed contact fields (email, phone,
// website, address) get their token automatically in FormRenderer. A Short Text
// field can hold anything, so the operator picks its meaning in the editor —
// and the editor suggests one when the label/question looks like a name,
// company, etc. (suggestAutofill below).

// Tokens a Short Text field may carry. The renderer only emits tokens from this
// list, so a hand-edited form can't inject an arbitrary attribute value.
export const TEXT_AUTOFILL_OPTIONS = [
  { value: 'name', label: 'Full name' },
  { value: 'given-name', label: 'First name' },
  { value: 'family-name', label: 'Last name' },
  { value: 'organization', label: 'Company / organization' },
  { value: 'organization-title', label: 'Job title' },
  { value: 'address-level2', label: 'City' },
  { value: 'postal-code', label: 'Postal code' },
  { value: 'country-name', label: 'Country' },
];

const TEXT_AUTOFILL_TOKENS = new Set(TEXT_AUTOFILL_OPTIONS.map(o => o.value));

export function textAutofillLabel(token) {
  return TEXT_AUTOFILL_OPTIONS.find(o => o.value === token)?.label || token;
}

// The `autocomplete` token to render for a field, or undefined for none.
export function autofillToken(field) {
  switch (field?.type) {
    case 'email': return 'email';
    case 'phone': return 'tel';
    case 'website': return 'url';
    case 'text': return TEXT_AUTOFILL_TOKENS.has(field.autocomplete) ? field.autocomplete : undefined;
    default: return undefined;
  }
}

// Ordered: the first match wins, so the more specific patterns come first
// ("Vorname" and "Firmenname" both contain "name"). English + German, since
// those are the built-in form languages.
const TYPE_RULES = [
  { type: 'email', label: 'Email Address', re: /e-?mail/ },
  { type: 'phone', label: 'Phone Number', re: /phone|telefon|handy|mobil|\btel\b|rufnummer/ },
  { type: 'website', label: 'Website URL', re: /website|webseite|homepage|\burl\b/ },
];

const TOKEN_RULES = [
  { token: 'name', re: /full\s*name|first\s*(and|&)\s*last\s*name|vor-?\s*(und|&)\s*nachname|vollst(ä|ae)ndiger name/ },
  { token: 'given-name', re: /first\s*name|given\s*name|forename|vorname/ },
  { token: 'family-name', re: /last\s*name|surname|family\s*name|nachname|familienname|zuname/ },
  { token: 'organization', re: /compan|organi[sz]ation|business\s*name|employer|firma|firmen|unternehmen|arbeitgeber|betrieb/ },
  { token: 'organization-title', re: /job\s*title|jobtitel|berufsbezeichnung|\bposition\b/ },
  { token: 'postal-code', re: /\bzip\b|post\s*code|postal|\bplz\b|postleitzahl/ },
  { token: 'address-level2', re: /\bcity\b|\btown\b|\bstadt\b|\bort\b|wohnort/ },
  { token: 'country-name', re: /\bcountry\b|\bland\b/ },
  { token: 'name', re: /\bnamen?\b|wie hei(ß|ss)(t|en)|who are you/ },
];

// Suggest a better setup for a Short Text field whose wording reveals what it
// collects. Returns
//   { kind: 'type', type, label }   — should be a typed field (email/phone/url)
//   { kind: 'autofill', token }     — should carry this autocomplete token
// or null. An operator's explicit choice (any `autocomplete` value, including
// '' for "none" / a dismissed hint) silences every suggestion.
export function suggestAutofill(field) {
  if (!field || field.type !== 'text') return null;
  if (field.autocomplete !== undefined) return null;
  const text = `${field.label || ''} ${field.question || ''}`.toLowerCase();
  if (!text.trim()) return null;
  for (const rule of TYPE_RULES) {
    if (rule.re.test(text)) return { kind: 'type', type: rule.type, label: rule.label };
  }
  for (const rule of TOKEN_RULES) {
    if (rule.re.test(text)) return { kind: 'autofill', token: rule.token };
  }
  return null;
}
