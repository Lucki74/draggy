// Spots a reply that only says what the model will do next. Qwen3.6 ends passes this way, and the loop
// used to save the promise as the answer.

const MAX_ANNOUNCEMENT_CHARS = 300;

const QUESTION = /[?？؟]/;

// Latin stops need a space after them, so "llama.cpp" stays one sentence; CJK stops need none.
const SENTENCE_BREAK = /(?<=[.!])\s+|(?<=[。！])/;

const CONNECTIVE =
  /^(?:(?:now|next|first|then|ok|okay|alright|great|sure|maintenant|ensuite|ahora|primero|jetzt|zuerst|ora|adesso|agora|nu|eerst|сейчас|теперь|الآن)[,،]?\s+)+/iu;

const LEADING_INTENT = new RegExp(
  "^(?:" +
    [
      "let me", "let's", "let’s", "i'll", "i’ll", "i will", "i'm going to", "i’m going to", "i am going to",
      "je vais", "laisse-moi", "laissez-moi", "voyons",
      "voy a", "déjame", "dejame", "vamos", "permíteme",
      "ich werde", "lass mich", "lassen sie mich", "ich schaue", "ich prüfe",
      "lasciami", "fammi", "vado a", "vediamo",
      "vou", "deixe-me", "deixa-me",
      "ik ga", "laat me", "laat mij", "ik zal",
      "давай", "давайте", "позвольте", "я проверю", "я посмотрю", "я поищу", "я изучу",
    ].join("|") +
    ")(?![\\p{L}'’-])",
  "iu",
);

// Chinese and Arabic run the intent straight into the verb, so these match as prefixes.
const PREFIX_INTENT = /^(?:让我|我来|我将|我会|我先|现在让我|现在我|接下来|دعني|دعنا|سأ)/u;

// Japanese and Korean put the intent at the end of the sentence, not the start.
const TRAILING_INTENT = /(?:てみます|確認します|調べます|ましょう|보겠습니다|확인하겠습니다|검색하겠습니다)[。.!！]?$/u;

const ASKS_FOR_REPLY = /(?<!\p{L})(?:know|savoir|saber|wissen|sapere|weten|знать)(?!\p{L})/iu;

const TRAILING_LEAD_IN = /(?::|…|\.\.\.)$/;

/** True when short prose promises an action without taking it: one nudge is cheaper than a dead turn. */
export function announcesAction(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_ANNOUNCEMENT_CHARS || QUESTION.test(trimmed)) return false;
  if (TRAILING_LEAD_IN.test(trimmed)) return true;

  const sentences = trimmed.split(SENTENCE_BREAK).filter((part) => part.trim());
  const last = (sentences.at(-1) ?? "").trim().replace(CONNECTIVE, "");
  if (ASKS_FOR_REPLY.test(last)) return false;

  return LEADING_INTENT.test(last) || PREFIX_INTENT.test(last) || TRAILING_INTENT.test(last);
}
