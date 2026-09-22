// Font picker entries (card-editor.html/js) -- the built-in font choices
// shown in the Text toolbar's font dropdown before "Load system fonts"
// (Chrome/Edge only) replaces them with whatever's actually installed.
// Same plain-data-in-a-script-tag approach as card-types/card-types-data.js
// and templates/templates-data.js, for the same reason (fetch() is
// blocked on a page opened straight from disk).
//
// `name` is the exact value stored on a text object's own fontFamily —
// keep it a single real font name, not a fallback stack, since it's
// compared against by-name elsewhere (pickBestFontData's system-font
// lookup, thumbSignatureFor's cache key, a saved .plm file's own
// fontFamily field). `preview` is a full CSS font-family stack (name
// plus a same-genre fallback) used ONLY to render that option's own row
// in the dropdown in its own font — never assigned to an actual object —
// so a visitor whose OS lacks one of these still sees a reasonable
// stand-in instead of the dropdown's own default font.
//
// A font loaded via "Load system fonts" instead builds its own list of
// these objects on the fly (see card-editor.js) — its `name` is already
// a real installed font, so `preview` there is just that same name with
// no separate fallback needed.
window.EDITOR_FONTS = [
  { name: 'Arial', preview: 'Arial, Helvetica, sans-serif' },
  { name: 'Helvetica', preview: 'Helvetica, Arial, sans-serif' },
  { name: 'Georgia', preview: 'Georgia, "Times New Roman", serif' },
  { name: 'Times New Roman', preview: '"Times New Roman", Times, serif' },
  { name: 'Courier New', preview: '"Courier New", Courier, monospace' },
  { name: 'Verdana', preview: 'Verdana, Geneva, sans-serif' },
];
