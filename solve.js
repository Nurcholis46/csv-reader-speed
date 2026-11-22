// Fast drop-in for csv-reader 1.0.0 (make.fun's reference program).
// Returns exactly csv-reader's answer {columns, rows, errors} for every input,
// but reads the text with indexOf-driven jumps instead of one character at a
// time: each field is one slice in the common case, and quoted fields are
// resolved by scanning for the next quote instead of walking every character.
//
// Semantics (identical to the reference, vendor/csv-reader/index.js):
// - a U+FEFF at the very start is dropped;
// - a record ends at LF or CRLF, and a line left with no characters is no record;
// - outside quotes a CR not followed by LF is dropped (error stray_cr);
// - a field opening with a quote runs to the next quote that is not doubled,
//   "" inside it is one quote, each CRLF or lone CR inside it reads as LF;
//   what follows its closing quote, up to the next comma or line break, is
//   appended as it stands (quote_junk, when the field ends); a quote that
//   never closes is a literal character, and the text after it is read again
//   as unquoted (unterminated_quote);
// - a quote inside an unquoted field is a literal character;
// - fields stay strings, never trimmed or converted;
// - columns is the first record when header is true, else null; rows holds the
//   records after it, each padded with "" (short_row, with fields: its field
//   count) or cut (long_row, with extra: the cut fields) to the first
//   record's width;
// - each error is {code, line, row}, in the order met; line is the 1-based
//   line its record starts on, row its record's index in rows (null for the
//   header).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  let recordLine = 1; // the line the record being read starts on
  let recordRow = null; // the index in rows the record being read takes (null: header)
  let ended = END; // how the last field read ended
  let added = 0; // characters readUnquoted kept onto its starting value

  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Returns the field; `ended`
  // says how it ended and `added` counts the characters kept onto `value`.
  const FIELD = /[^,\r\n]*/y;
  function readUnquoted(value) {
    added = 0;
    let parts = null;
    for (;;) {
      FIELD.lastIndex = pos;
      const m = FIELD.exec(text);
      const flen = m[0].length;
      const endPos = pos + flen;
      if (endPos >= n) {
        pos = n;
        ended = END;
        added += flen;
        if (parts === null) return value === '' ? m[0] : value + m[0];
        parts.push(m[0]);
        return value + parts.join('');
      }
      const ch = text.charCodeAt(endPos);
      if (ch === 44) {
        pos = endPos + 1;
        ended = COMMA;
        added += flen;
        if (parts === null) return value === '' ? m[0] : value + m[0];
        parts.push(m[0]);
        return value + parts.join('');
      }
      if (ch === 10) {
        pos = endPos + 1;
        line += 1;
        ended = LINE_BREAK;
        added += flen;
        if (parts === null) return value === '' ? m[0] : value + m[0];
        parts.push(m[0]);
        return value + parts.join('');
      }
      if (ch === 13) {
        if (text.charCodeAt(endPos + 1) === 10) {
          pos = endPos + 2;
          line += 1;
          ended = LINE_BREAK;
          added += flen;
          if (parts === null) return value === '' ? m[0] : value + m[0];
          parts.push(m[0]);
          return value + parts.join('');
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (parts === null) parts = [];
        parts.push(m[0]);
        added += flen;
        pos = endPos + 1;
        continue;
      }
      // unreachable: FIELD stops only at , \r \n or end
      throw new Error('unreachable');
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let hasDoubled = false;
    let close = -1;
    let scan = pos;
    for (;;) {
      const q = text.indexOf('"', scan);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) { hasDoubled = true; scan = q + 2; continue; }
      close = q;
      break;
    }
    if (close === -1) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    const seg = text.slice(open + 1, close);
    let value = seg;
    const hasCR = seg.indexOf('\r') !== -1;
    const hasLF = seg.indexOf('\n') !== -1;
    if (hasCR || hasLF) {
      // Line breaks inside: every LF, and every CR that is not part of a CRLF.
      let breaks = 0;
      let p = seg.indexOf('\n');
      while (p !== -1) { breaks += 1; p = seg.indexOf('\n', p + 1); }
      p = seg.indexOf('\r');
      while (p !== -1) { breaks += 1; p = seg.indexOf('\r', p + 1); }
      p = seg.indexOf('\r\n');
      while (p !== -1) { breaks -= 1; p = seg.indexOf('\r\n', p + 2); }
      line += breaks;
      if (hasCR) value = seg.replace(/\r\n?/g, '\n');
      if (hasDoubled) value = value.replace(/""/g, '"');
    } else if (hasDoubled) {
      value = seg.replace(/""/g, '"');
    }
    pos = close + 1;
    if (pos >= n) { ended = END; return value; }
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; ended = COMMA; return value; }
    if (c === 10) { pos += 1; line += 1; ended = LINE_BREAK; return value; }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; ended = LINE_BREAK; return value; }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    const junk = readUnquoted(value);
    if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
