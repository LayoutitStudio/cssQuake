const QUAKE_BITMAP_TEXT_SIZES = {
  copy: 16,
  label: 16,
  key: 14,
  title: 40,
} as const;

type QuakeBitmapTextSize = keyof typeof QUAKE_BITMAP_TEXT_SIZES;
type QuakeBitmapTextWrap = "word" | "anywhere" | "email";

export function mountQuakeBitmapText(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-bm]")) {
    renderQuakeBitmapTextElement(element);
  }
}

function renderQuakeBitmapTextElement(element: HTMLElement): void {
  const text = normalizeBitmapText(element.textContent ?? "");
  if (!text) return;

  const source = document.createElement("span");
  source.className = "quake-bitmap-source";
  source.textContent = text;

  const bitmap = createQuakeBitmapText(text, parseBitmapTextOptions(element));

  element.textContent = "";
  element.classList.add("quake-bitmap-host");
  element.append(source, bitmap);
}

function createQuakeBitmapText(
  text: string,
  options: { alt: boolean; size: QuakeBitmapTextSize; wrap: QuakeBitmapTextWrap },
): HTMLElement {
  const container = document.createElement("span");
  container.className = `quake-bitmap-text quake-bitmap-text--${options.size} quake-bitmap-text--${options.wrap}`;
  container.setAttribute("aria-hidden", "true");

  if (options.wrap === "anywhere") {
    for (const char of text) container.append(createQuakeBitmapGlyph(char, options.alt));
    return container;
  }

  if (options.wrap === "email") {
    for (const segment of splitEmailBitmapText(text)) {
      container.append(createQuakeBitmapWord(segment, options.alt));
    }
    return container;
  }

  for (const word of text.split(" ")) {
    if (!word) continue;
    container.append(createQuakeBitmapWord(word, options.alt));
  }

  return container;
}

function createQuakeBitmapWord(text: string, alt: boolean): HTMLElement {
  const wordElement = document.createElement("span");
  wordElement.className = "quake-bitmap-word";
  for (const char of text) wordElement.append(createQuakeBitmapGlyph(char, alt));
  return wordElement;
}

function createQuakeBitmapGlyph(char: string, alt: boolean): HTMLElement {
  const glyph = (char.charCodeAt(0) & 127) + (alt ? 128 : 0);
  const col = glyph & 15;
  const row = glyph >> 4;
  const element = document.createElement("span");
  element.className = `quake-bitmap-glyph quake-bitmap-col-${col} quake-bitmap-row-${row}`;
  return element;
}

function parseBitmapTextSize(value: string | undefined): QuakeBitmapTextSize {
  return value === "label" || value === "key" || value === "title" ? value : "copy";
}

function parseBitmapTextWrap(value: string | undefined): QuakeBitmapTextWrap {
  if (value === "anywhere" || value === "email") return value;
  return "word";
}

function parseBitmapTextOptions(element: HTMLElement): { alt: boolean; size: QuakeBitmapTextSize; wrap: QuakeBitmapTextWrap } {
  const tokens = (element.dataset.bm ?? "").split(/\s+/).filter(Boolean);
  return {
    alt: tokens.includes("alt") || element.dataset.bmAlt === "true",
    size: parseBitmapTextSize(tokens.find(isBitmapTextSize) ?? element.dataset.bmSize),
    wrap: parseBitmapTextWrap(tokens.find(isBitmapTextWrap) ?? element.dataset.bmWrap),
  };
}

function isBitmapTextSize(value: string): value is QuakeBitmapTextSize {
  return value === "copy" || value === "label" || value === "key" || value === "title";
}

function isBitmapTextWrap(value: string): value is QuakeBitmapTextWrap {
  return value === "word" || value === "anywhere" || value === "email";
}

function splitEmailBitmapText(text: string): string[] {
  const at = text.indexOf("@");
  if (at < 0) return [text];
  return [text.slice(0, at + 1), text.slice(at + 1)].filter(Boolean);
}

function normalizeBitmapText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
