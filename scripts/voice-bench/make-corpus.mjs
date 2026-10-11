// Writes corpus.<lang>.json. Each reply has a category so the report can break results down.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
import { extra } from "./corpus-extra.mjs";
const long = (s) => s;

const corpus = {
  en: [
    ["oneliner", "Sure, give me a second."],
    ["oneliner", "That sounds like a great plan."],
    ["oneliner", "Not quite. Try the other one."],
    ["two", "I checked the calendar. You are free on Thursday afternoon."],
    ["two", "Good question. It depends on how much memory the machine has."],
    ["two", "Yes, it works offline. The first run just needs the download."],
    ["long", long("Honestly, the simplest way to think about it is that the model reads everything you said so far, works out what you probably want next, and then writes the answer one small piece at a time, which is why it can start speaking before it has finished thinking.")],
    ["long", long("When you run it for the first time it downloads the voice, which takes a couple of minutes on a normal connection, and after that everything stays on your computer so you can talk to it on a plane or in a tunnel without any trouble at all.")],
    ["number", "The trip is 340 kilometers and takes about 4 hours."],
    ["number", "It costs $12.50 a month, or $120 for the year."],
    ["number", "Your meeting is at 14:30 on the 3rd, and it runs for 45 minutes."],
    ["number", "Battery is at 82%, and the file is 1.5 GB."],
    ["acronym", "The CPU is fine, but the GPU is running hot. Check the API logs."],
    ["acronym", "NASA announced it, and the BBC covered it."],
    ["question", "Do you want me to read the whole thing, or just the summary?"],
    ["question", "Wait, which one did you mean, the first or the second?"],
    ["cue", "Ha <laugh> that is a good one. Anyway, back to the plan."],
    ["cue", "Hmm <hmm> let me think. Okay, here is what I would do."],
    ["cue", "<sigh> Long day. Let us keep this short."],
    ["path", "Open C:\\Users\\me\\notes.txt and check the first line, or visit https://example.com/help for more."],
  ],
  fr: [
    ["oneliner", "Bien sûr, donnez-moi une seconde."],
    ["oneliner", "Ça me paraît un très bon plan."],
    ["oneliner", "Pas tout à fait. Essayez plutôt l'autre."],
    ["two", "J'ai regardé l'agenda. Vous êtes libre jeudi après-midi."],
    ["two", "Bonne question. Tout dépend de la mémoire de la machine."],
    ["two", "Oui, ça marche hors ligne. Seul le premier lancement demande un téléchargement."],
    ["long", long("Honnêtement, le plus simple est de se dire que le modèle lit tout ce que vous avez dit jusque-là, devine ce que vous voulez probablement ensuite, puis écrit la réponse petit morceau par petit morceau, ce qui explique qu'il puisse commencer à parler avant d'avoir fini de réfléchir.")],
    ["long", long("Au premier lancement, il télécharge la voix, ce qui prend quelques minutes avec une connexion normale, et ensuite tout reste sur votre ordinateur, si bien que vous pouvez lui parler dans un avion ou dans un tunnel sans aucun souci.")],
    ["number", "Le trajet fait 340 kilomètres et dure environ 4 heures."],
    ["number", "Ça coûte 12,50 € par mois, ou 120 € pour l'année."],
    ["number", "Votre réunion est à 14:30 le 3, et elle dure 45 minutes."],
    ["number", "La batterie est à 82 %, et le fichier fait 1,5 GB."],
    ["acronym", "Le CPU va bien, mais le GPU chauffe. Regardez les journaux de l'API."],
    ["acronym", "La NASA l'a annoncé, et la BBC en a parlé."],
    ["question", "Voulez-vous que je lise tout, ou seulement le résumé ?"],
    ["question", "Attendez, lequel vouliez-vous dire, le premier ou le second ?"],
    ["cue", "Ha <laugh> elle est bonne. Bref, revenons au plan."],
    ["cue", "Hmm <hmm> laissez-moi réfléchir. Voilà ce que je ferais."],
    ["cue", "<sigh> Longue journée. Faisons court."],
    ["path", "Ouvrez C:\\Users\\moi\\notes.txt et lisez la première ligne, ou allez sur https://example.com/aide."],
  ],
  es: [
    ["oneliner", "Claro, dame un segundo."],
    ["oneliner", "Me parece un gran plan."],
    ["oneliner", "No exactamente. Prueba con la otra."],
    ["two", "He mirado el calendario. Estás libre el jueves por la tarde."],
    ["two", "Buena pregunta. Depende de cuánta memoria tenga el equipo."],
    ["two", "Sí, funciona sin conexión. Solo la primera vez hace falta descargarlo."],
    ["long", long("Sinceramente, lo más sencillo es pensar que el modelo lee todo lo que has dicho hasta ahora, calcula lo que probablemente quieres después, y escribe la respuesta poco a poco, y por eso puede empezar a hablar antes de haber terminado de pensar.")],
    ["long", long("La primera vez descarga la voz, lo que tarda un par de minutos con una conexión normal, y después todo se queda en tu ordenador, así que puedes hablarle en un avión o en un túnel sin ningún problema.")],
    ["number", "El viaje son 340 kilómetros y dura unas 4 horas."],
    ["number", "Cuesta 12,50 € al mes, o 120 € al año."],
    ["number", "Tu reunión es a las 14:30 del día 3, y dura 45 minutos."],
    ["number", "La batería está al 82 %, y el archivo pesa 1,5 GB."],
    ["acronym", "La CPU va bien, pero la GPU está caliente. Revisa los registros de la API."],
    ["acronym", "La NASA lo anunció, y la BBC lo cubrió."],
    ["question", "¿Quieres que lea todo, o solo el resumen?"],
    ["question", "Espera, ¿cuál querías decir, el primero o el segundo?"],
    ["cue", "Ja <laugh> esa está buena. En fin, volvamos al plan."],
    ["cue", "Hmm <hmm> déjame pensar. Esto es lo que haría."],
    ["cue", "<sigh> Qué día más largo. Seamos breves."],
    ["path", "Abre C:\\Users\\yo\\notes.txt y mira la primera línea, o visita https://example.com/ayuda."],
  ],
  zh: [
    ["oneliner", "好的，请稍等一下。"],
    ["oneliner", "听起来是个很棒的计划。"],
    ["oneliner", "不完全是，试试另一个。"],
    ["two", "我看了日历。你周四下午有空。"],
    ["two", "好问题。这取决于机器有多少内存。"],
    ["two", "可以，离线也能用。只有第一次需要下载。"],
    ["long", long("说实话，最简单的理解方式是，模型会读完你到目前为止说的所有内容，推测你接下来大概想要什么，然后一小段一小段地写出回答，所以它可以在还没想完之前就开始说话，这也是为什么你几乎感觉不到等待。")],
    ["long", long("第一次运行时它会下载语音，普通网速下大约需要几分钟，之后所有内容都留在你的电脑上，所以你在飞机上或者隧道里也可以和它聊天，完全没有问题。")],
    ["number", "路程是340公里，大约需要4个小时。"],
    ["number", "每月12.50元，或者全年120元。"],
    ["number", "你的会议在3号14:30，持续45分钟。"],
    ["number", "电量还有82%，文件大小是1.5 GB。"],
    ["acronym", "CPU没问题，但是GPU很烫。看看API日志。"],
    ["acronym", "NASA宣布了这件事，BBC也报道了。"],
    ["question", "你想让我读全文，还是只读摘要？"],
    ["question", "等一下，你说的是第一个还是第二个？"],
    ["cue", "哈 <laugh> 这个不错。好了，回到计划上。"],
    ["cue", "嗯 <hmm> 让我想想。我会这样做。"],
    ["cue", "<sigh> 今天真漫长。我们长话短说。"],
    ["path", "打开 C:\\Users\\me\\notes.txt 看第一行，或者访问 https://example.com/help 了解更多。"],
  ],
};

for (const [lang, base] of Object.entries(corpus)) {
  const rows = [...base, ...extra[lang]].slice(0, 60);
  const items = rows.map(([category, text], i) => ({ id: `${lang}-${String(i + 1).padStart(2, "0")}`, category, text }));
  fs.writeFileSync(path.join(here, `corpus.${lang}.json`), JSON.stringify(items, null, 2) + "\n");
}
console.log("wrote", Object.keys(corpus).join(", "));
