const QUAKE_CONCHARS_COLUMNS = 16;
const QUAKE_BITMAP_TEXT_SIZES = {
  copy: 16,
  label: 16,
  key: 14,
  title: 40,
} as const;

type QuakeBitmapTextSize = keyof typeof QUAKE_BITMAP_TEXT_SIZES;

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

  const bitmap = createQuakeBitmapText(text, {
    alt: element.dataset.bmAlt === "true",
    size: parseBitmapTextSize(element.dataset.bmSize),
    wrap: parseBitmapTextWrap(element.dataset.bmWrap),
  });

  element.textContent = "";
  element.classList.add("quake-bitmap-host");
  element.append(source, bitmap);
}

function createQuakeBitmapText(
  text: string,
  options: { alt: boolean; size: QuakeBitmapTextSize; wrap: "word" | "anywhere" | "email" },
): HTMLElement {
  const glyphSize = QUAKE_BITMAP_TEXT_SIZES[options.size];
  const container = document.createElement("span");
  container.className = `quake-bitmap-text quake-bitmap-text--${options.size} quake-bitmap-text--${options.wrap}`;
  container.setAttribute("aria-hidden", "true");
  container.style.setProperty("--quake-bitmap-glyph-size", `${glyphSize}px`);
  container.style.setProperty("--quake-bitmap-sheet-size", `${glyphSize * QUAKE_CONCHARS_COLUMNS}px`);
  container.style.setProperty("--quake-bitmap-space-size", `${Math.round(glyphSize * 0.7)}px`);

  if (options.wrap === "anywhere") {
    for (const char of text) container.append(createQuakeBitmapGlyph(char, options.alt, glyphSize));
    return container;
  }

  if (options.wrap === "email") {
    for (const segment of splitEmailBitmapText(text)) {
      container.append(createQuakeBitmapWord(segment, options.alt, glyphSize));
    }
    return container;
  }

  for (const word of text.split(" ")) {
    if (!word) continue;
    container.append(createQuakeBitmapWord(word, options.alt, glyphSize));
  }

  return container;
}

function createQuakeBitmapWord(text: string, alt: boolean, glyphSize: number): HTMLElement {
  const wordElement = document.createElement("span");
  wordElement.className = "quake-bitmap-word";
  for (const char of text) wordElement.append(createQuakeBitmapGlyph(char, alt, glyphSize));
  return wordElement;
}

function createQuakeBitmapGlyph(char: string, alt: boolean, glyphSize: number): HTMLElement {
  const glyph = (char.charCodeAt(0) & 127) + (alt ? 128 : 0);
  const col = glyph & 15;
  const row = glyph >> 4;
  const element = document.createElement("span");
  element.className = "quake-bitmap-glyph";
  element.style.backgroundPosition = `${-col * glyphSize}px ${-row * glyphSize}px`;
  return element;
}

function parseBitmapTextSize(value: string | undefined): QuakeBitmapTextSize {
  return value === "label" || value === "key" || value === "title" ? value : "copy";
}

function parseBitmapTextWrap(value: string | undefined): "word" | "anywhere" | "email" {
  if (value === "anywhere" || value === "email") return value;
  return "word";
}

function splitEmailBitmapText(text: string): string[] {
  const at = text.indexOf("@");
  if (at < 0) return [text];
  return [text.slice(0, at + 1), text.slice(at + 1)].filter(Boolean);
}

function normalizeBitmapText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
