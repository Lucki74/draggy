import { describe, expect, it } from "vitest";
import { announcesAction } from "../agent/announcement";

describe("announcesAction", () => {
  it.each([
    "Now let me check Draggy's source code for llama.cpp optimization flags and settings.",
    "Let me dig into Draggy's wiki and source to find all the optimization knobs.",
    "I found the settings page. I'll read the troubleshooting page next.",
    "OK, I'm going to search for the release notes.",
    "Here is what I will look at:",
    "Je vais consulter la documentation.",
    "Déjame revisar el código fuente.",
    "Lass mich die Einstellungen prüfen.",
    "Fammi controllare la pagina.",
    "Vou verificar o repositório.",
    "Ik ga de wiki bekijken.",
    "Сейчас я проверю документацию.",
    "让我查看一下源代码。",
    "ソースコードを確認します。",
    "소스 코드를 확인해 보겠습니다.",
    "دعني أتحقق من الإعدادات.",
  ])("catches %s", (text) => {
    expect(announcesAction(text)).toBe(true);
  });

  it.each([
    "Set the thread count to 8 and turn on flash attention.",
    "Let me know if you want the numbers for a larger model.",
    "Laat me weten of je meer wilt.",
    "Should I check the source code as well?",
    "Paris.",
    "",
    "Villeneuve is a town in France.",
    "I checked the wiki. ".repeat(20) + "I'll summarise it now.",
  ])("leaves %s alone", (text) => {
    expect(announcesAction(text)).toBe(false);
  });
});
