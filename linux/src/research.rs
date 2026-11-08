//! Research on Linux: the run the core reports as a `research_run` step, citation chips.
//! Everything here is plain data and text, so it is checked without a display.

use draggy_core::StepRecord;
use serde::Deserialize;

use crate::markdown::escape;
use crate::services::locale_detector::detect_system_locale;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSource {
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub title: String,
    pub site: Option<String>,
    pub published: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunNote {
    pub id: String,
    pub source_id: String,
    #[serde(default)]
    pub quote: String,
    pub verified: Option<bool>,
    /// 1-based; absent in chats saved before notes carried it.
    pub sub_question: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct RunQuestion {
    pub text: String,
    pub notes: usize,
}

/// The part of a run the screen needs, as the core writes it into the step.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunView {
    pub id: String,
    #[serde(default)]
    pub question: String,
    pub depth: String,
    pub ended_at: Option<u64>,
    #[serde(default)]
    pub questions: Vec<RunQuestion>,
    #[serde(default)]
    pub sources: Vec<RunSource>,
    #[serde(default)]
    pub notes: Vec<RunNote>,
    #[serde(default)]
    pub hosts: Vec<String>,
}

/// The run held by a `research_run` step, or `None` for any other step.
pub fn parse_step(step: &StepRecord) -> Option<RunView> {
    if step.kind != "research_run" {
        return None;
    }
    serde_json::from_str(step.content.as_deref()?).ok()
}

/// What a chip stands for: the number shown, the source, the supporting quote and whether the quote was found.
#[derive(Debug, Clone, PartialEq)]
pub struct Cite<'a> {
    pub n: usize,
    pub source: &'a RunSource,
    pub quote: &'a str,
    pub verified: bool,
}

impl RunView {
    /// Sources that have at least one note, in the order they were read: the report's source list.
    pub fn cited_sources(&self) -> Vec<&RunSource> {
        self.sources
            .iter()
            .filter(|source| self.notes.iter().any(|note| note.source_id == source.id))
            .collect()
    }

    /// A note id such as `n3` as a chip. Anything else, or an id the run lacks, gives `None`.
    pub fn resolve(&self, reference: &str) -> Option<Cite<'_>> {
        let digits = reference.strip_prefix('n')?;
        if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let note = self.notes.iter().find(|note| note.id == reference)?;
        let cited = self.cited_sources();
        let index = cited
            .iter()
            .position(|source| source.id == note.source_id)?;
        Some(Cite {
            n: index + 1,
            source: cited[index],
            quote: &note.quote,
            verified: note.verified == Some(true),
        })
    }
}

fn web_link(url: &str) -> Option<String> {
    (url.starts_with("https://") || url.starts_with("http://")).then(|| escape(url))
}

/// Pango markup with every `[n1]` note id turned into a small linked number. Bare `[1]` is left as written.
pub fn link_citations(markup: &str, run: &RunView) -> String {
    let mut out = String::with_capacity(markup.len());
    let mut rest = markup;
    while let Some(start) = rest.find("[n") {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        let chip = tail.find(']').and_then(|end| {
            let cite = run.resolve(&tail[1..end])?;
            Some((end + 1, chip_markup(&cite)))
        });
        match chip {
            Some((len, markup)) => {
                out.push_str(&markup);
                rest = &tail[len..];
            }
            None => {
                out.push_str("[n");
                rest = &tail[2..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn chip_markup(cite: &Cite<'_>) -> String {
    let source = cite.source;
    let name = if source.title.is_empty() {
        &source.url
    } else {
        &source.title
    };
    let site = source.site.as_deref().unwrap_or_default();
    let day = source
        .published
        .as_deref()
        .map(|date| date.chars().take(10).collect::<String>());
    let meta = [Some(site.to_owned()), day]
        .into_iter()
        .flatten()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    let check = t(if cite.verified {
        "citeVerified"
    } else {
        "citeNotVerified"
    });
    let tip = escape(&format!("{name}\n{meta}\n\"{}\"\n{check}", cite.quote));
    let number = format!(
        "<span bgcolor=\"#8888883c\" size=\"smaller\" rise=\"3000\"> {} </span>",
        cite.n
    );
    match web_link(&source.url) {
        Some(url) => format!("<a href=\"{url}\" title=\"{tip}\">{number}</a>"),
        None => number,
    }
}

/// The source list under a report, one Pango line per cited source. Empty when nothing was cited.
pub fn source_list_markup(run: &RunView) -> Vec<String> {
    run.cited_sources()
        .iter()
        .enumerate()
        .map(|(index, source)| {
            let name = escape(if source.title.is_empty() {
                &source.url
            } else {
                &source.title
            });
            let title = match web_link(&source.url) {
                Some(url) => format!("<a href=\"{url}\">{name}</a>"),
                None => name,
            };
            let site = source.site.as_deref().unwrap_or_default();
            let day = source
                .published
                .as_deref()
                .map(|date| date.chars().take(10).collect::<String>());
            let meta = [Some(site.to_owned()), day]
                .into_iter()
                .flatten()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            if meta.is_empty() {
                format!("{}. {title}", index + 1)
            } else {
                format!(
                    "{}. {title} <span alpha=\"60%\">{}</span>",
                    index + 1,
                    escape(&meta)
                )
            }
        })
        .collect()
}

/// The run's rail line: what it is doing, then depth or questions, sources read and failures.
pub fn card_header(run: &RunView) -> String {
    let read = run
        .sources
        .iter()
        .filter(|source| source.status == "read")
        .count();
    let failed = run.sources.iter().filter(|source| is_bad(source)).count();
    let (verb, scope) = if run.ended_at.is_some() {
        (
            t("researchRunDone"),
            count(
                run.questions.len(),
                "researchRunQuestionsOne",
                "researchRunQuestions",
            ),
        )
    } else {
        let depth = match run.depth.as_str() {
            "quick" => "researchDepthQuick",
            "deep" => "researchDepthDeep",
            _ => "researchDepthStandard",
        };
        (t("researchRunLive"), t(depth))
    };
    let mut parts = vec![
        scope,
        count(read, "researchRunSourcesOne", "researchRunSources"),
    ];
    if failed > 0 {
        parts.push(t("researchRunFailed").replace("{n}", &failed.to_string()));
    }
    format!("{verb}  {}", parts.join(" · "))
}

fn is_bad(source: &RunSource) -> bool {
    source.status == "failed" || source.status == "blocked"
}

/// Each source once, under the first question a note of it answers; the rest come last.
pub fn group_sources(run: &RunView) -> (Vec<Vec<&RunSource>>, Vec<&RunSource>) {
    let mut groups: Vec<Vec<&RunSource>> = run.questions.iter().map(|_| Vec::new()).collect();
    let mut placed = Vec::new();
    for note in &run.notes {
        let index = note.sub_question.unwrap_or(0).wrapping_sub(1);
        let source = run
            .sources
            .iter()
            .find(|source| source.id == note.source_id);
        let (Some(group), Some(source)) = (groups.get_mut(index), source) else {
            continue;
        };
        if !placed.contains(&source.id) {
            group.push(source);
            placed.push(source.id.clone());
        }
    }
    let other = run
        .sources
        .iter()
        .filter(|source| !placed.contains(&source.id))
        .collect();
    (groups, other)
}

/// One line for a sub-question: a filled dot once it has a note, then its note count.
pub fn question_line(question: &RunQuestion) -> String {
    let mark = if question.notes > 0 { "●" } else { "○" };
    let notes = count(question.notes, "researchRunNotesOne", "researchRunNotes");
    format!("{mark}  {}  {notes}", question.text)
}

/// One source under its question: title and site, a quiet × when it could not be read.
pub fn source_line(source: &RunSource) -> String {
    let name = if source.title.is_empty() {
        source.url.as_str()
    } else {
        source.title.as_str()
    };
    let mut line = match source.site.as_deref().filter(|site| !site.is_empty()) {
        Some(site) => format!("{name} · {site}"),
        None => name.to_owned(),
    };
    match source.status.as_str() {
        "reading" => line = format!("{line}  {}", t("researchStatusReading")),
        "skipped" => line = format!("{line}  {}", t("researchStatusSkipped")),
        _ if is_bad(source) => line.push_str("  ×"),
        _ => {}
    }
    line
}

/// A source's site badge as Pango markup: the site's first letter on a colour taken from its name.
/// Windows draws the same badge when no icon loads; no icon is fetched, so no site learns what was read.
pub fn site_badge(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let host = rest
        .split(['/', '?', '#', ':'])
        .next()
        .unwrap_or("")
        .to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    let parts: Vec<&str> = host.split('.').filter(|part| !part.is_empty()).collect();
    let name = match parts.len() {
        0 => "?",
        1 => parts[0],
        n if n > 2 && ["co", "com", "org", "net", "gov", "ac", "edu"].contains(&parts[n - 2]) => {
            parts[n - 3]
        }
        n => parts[n - 2],
    };
    let hue = name
        .encode_utf16()
        .fold(0u32, |hash, unit| (hash * 31 + u32::from(unit)) % 360_000)
        % 360;
    let letter = name
        .chars()
        .next()
        .map_or_else(|| "?".to_owned(), |c| c.to_string());
    format!(
        "<span background=\"{}\" foreground=\"white\" font_weight=\"bold\"> {} </span>",
        hsl_hex(hue),
        escape(&letter)
    )
}

/// The hue at 62% saturation and 46% lightness, as #rrggbb.
fn hsl_hex(hue: u32) -> String {
    let (s, l) = (0.62_f64, 0.46_f64);
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((f64::from(hue) / 60.0) % 2.0 - 1.0).abs());
    let (r, g, b) = match hue / 60 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let byte = |n: f64| ((n + l - c / 2.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", byte(r), byte(g), byte(b))
}

/// The services line under the card, or `None` before anything was contacted.
pub fn services_line(run: &RunView) -> Option<String> {
    (!run.hosts.is_empty())
        .then(|| t("researchRunServices").replace("{hosts}", &run.hosts.join(", ")))
}

/// The warning for a finished run that kept no sourced note, so its answer stands on nothing.
pub fn no_notes_line(run: &RunView) -> Option<String> {
    let backed = run.notes.iter().any(|note| note.verified != Some(false));
    (run.ended_at.is_some() && !backed).then(|| t("researchRunNoNotes"))
}

/// The research settings, held in memory like the others. Kept apart from `Settings` so a change does not end the session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResearchSettings {
    /// Whether the model may start a run on its own.
    pub model_start: bool,
    /// One of `DEPTHS`.
    pub max_depth: String,
    /// One of `KEEPS`.
    pub keep: String,
}

impl Default for ResearchSettings {
    fn default() -> Self {
        Self {
            model_start: true,
            max_depth: "deep".to_owned(),
            keep: "forever".to_owned(),
        }
    }
}

/// The depths the settings offer, quickest first.
pub const DEPTHS: [&str; 3] = ["quick", "standard", "deep"];
/// How long finished research is kept.
pub const KEEPS: [&str; 3] = ["forever", "90", "30"];

const TEXTS: &[(&str, [&str; 4])] = &[
    ("gitGraph", ["Graph", "Graphe", "Gráfico", "Граф"]),
    (
        "gitChangedFiles",
        [
            "{count} changed",
            "{count} modifiés",
            "{count} cambiados",
            "Изменено: {count}",
        ],
    ),
    (
        "gitClean",
        [
            "No changes",
            "Aucune modification",
            "Sin cambios",
            "Нет изменений",
        ],
    ),
    (
        "gitDetached",
        [
            "Detached HEAD",
            "HEAD détachée",
            "HEAD separado",
            "Отсоединённый HEAD",
        ],
    ),
    (
        "gitNoBranches",
        ["No branches", "Aucune branche", "Sin ramas", "Веток нет"],
    ),
    (
        "gitNoCommits",
        [
            "No commits yet",
            "Aucun commit",
            "Aún no hay commits",
            "Коммитов пока нет",
        ],
    ),
    (
        "gitNoDiff",
        [
            "No changes to show",
            "Aucune modification à afficher",
            "No hay cambios que mostrar",
            "Нет изменений для показа",
        ],
    ),
    (
        "gitSwitchBranch",
        [
            "Switch branch",
            "Changer de branche",
            "Cambiar de rama",
            "Сменить ветку",
        ],
    ),
    (
        "reviewSplit",
        [
            "View split diff",
            "Afficher côte à côte",
            "Ver lado a lado",
            "Показать рядом",
        ],
    ),
    (
        "reviewHideWhitespace",
        [
            "Hide whitespace changes",
            "Masquer les changements d’espaces",
            "Ocultar cambios de espacios",
            "Скрыть изменения пробелов",
        ],
    ),
    (
        "reviewExpandAll",
        [
            "Expand all",
            "Tout déplier",
            "Expandir todo",
            "Развернуть все",
        ],
    ),
    (
        "reviewCollapseAll",
        [
            "Collapse all",
            "Tout replier",
            "Contraer todo",
            "Свернуть все",
        ],
    ),
    (
        "reviewBack",
        [
            "Back to changes",
            "Retour aux modifications",
            "Volver a los cambios",
            "Назад к изменениям",
        ],
    ),
    (
        "reviewFilter",
        [
            "Filter files",
            "Filtrer les fichiers",
            "Filtrar archivos",
            "Фильтр файлов",
        ],
    ),
    (
        "reviewRefresh",
        ["Refresh", "Actualiser", "Actualizar", "Обновить"],
    ),
    ("reviewMore", ["More", "Plus", "Más", "Ещё"]),
    (
        "researchRunSourcesOne",
        [
            "{n} source read",
            "{n} source lue",
            "{n} fuente leída",
            "Прочитано источников: {n}",
        ],
    ),
    (
        "researchRunNotesOne",
        ["{n} note", "{n} note", "{n} nota", "Заметок: {n}"],
    ),
    (
        "researchRunQuestionsOne",
        [
            "{n} question",
            "{n} question",
            "{n} pregunta",
            "Вопросов: {n}",
        ],
    ),
    (
        "researchRunTitle",
        ["Research", "Recherche", "Investigación", "Исследование"],
    ),
    (
        "researchSourceList",
        ["Sources", "Sources", "Fuentes", "Источники"],
    ),
    (
        "researchRunSources",
        [
            "{n} sources read",
            "{n} sources lues",
            "{n} fuentes leídas",
            "Прочитано источников: {n}",
        ],
    ),
    (
        "researchRunNotes",
        ["{n} notes", "{n} notes", "{n} notas", "Заметок: {n}"],
    ),
    (
        "researchRunLive",
        [
            "Researching",
            "Recherche en cours",
            "Investigando",
            "Исследование",
        ],
    ),
    (
        "researchRunDone",
        [
            "Researched",
            "Recherche terminée",
            "Investigado",
            "Исследовано",
        ],
    ),
    (
        "researchRunQuestions",
        [
            "{n} questions",
            "{n} questions",
            "{n} preguntas",
            "Вопросов: {n}",
        ],
    ),
    (
        "researchRunFailed",
        ["{n} failed", "{n} en échec", "{n} fallidas", "Ошибок: {n}"],
    ),
    (
        "researchRunOtherSources",
        [
            "Other sources",
            "Autres sources",
            "Otras fuentes",
            "Другие источники",
        ],
    ),
    (
        "researchRunServices",
        [
            "Contacted: {hosts}",
            "Services contactés : {hosts}",
            "Servicios contactados: {hosts}",
            "Обращения к сервисам: {hosts}",
        ],
    ),
    (
        "researchRunNoNotes",
        [
            "No sourced notes were kept. The answer below is not backed by any source.",
            "Aucune note sourcée n'a été retenue. La réponse ci-dessous ne s'appuie sur aucune source.",
            "No se conservó ninguna nota con fuente. La respuesta de abajo no se apoya en ninguna fuente.",
            "Не сохранено ни одной заметки с источником. Ответ ниже не опирается на источники.",
        ],
    ),
    (
        "researchStatusReading",
        ["Reading", "Lecture", "Leyendo", "Чтение"],
    ),
    ("researchStatusRead", ["Read", "Lue", "Leída", "Прочитан"]),
    (
        "researchStatusSkipped",
        ["Skipped", "Ignorée", "Omitida", "Пропущен"],
    ),
    (
        "researchStatusBlocked",
        ["Blocked", "Bloquée", "Bloqueada", "Заблокирован"],
    ),
    (
        "researchStatusFailed",
        ["Failed", "Échec", "Fallida", "Не удалось"],
    ),
    (
        "citeVerified",
        [
            "Quote found on the page",
            "Citation retrouvée dans la page",
            "Cita encontrada en la página",
            "Цитата найдена на странице",
        ],
    ),
    (
        "citeNotVerified",
        [
            "Quote not checked",
            "Citation non vérifiée",
            "Cita sin comprobar",
            "Цитата не проверена",
        ],
    ),
    (
        "researchDepthQuick",
        ["Quick", "Rapide", "Rápida", "Быстро"],
    ),
    (
        "researchDepthStandard",
        ["Standard", "Standard", "Estándar", "Стандартно"],
    ),
    (
        "researchDepthDeep",
        ["Deep", "Approfondie", "A fondo", "Глубоко"],
    ),
    (
        "researchPage",
        ["Research", "Recherches", "Investigaciones", "Исследования"],
    ),
    (
        "researchModelStart",
        [
            "Let the model start research",
            "Laisser le modèle lancer une recherche",
            "Dejar que el modelo inicie investigaciones",
            "Разрешить модели начинать исследование",
        ],
    ),
    (
        "researchModelStartHint",
        [
            "When off, the model does not start research runs.",
            "Désactivé, le modèle ne lance pas de recherches.",
            "Si está desactivado, el modelo no inicia investigaciones.",
            "Если выключено, модель не запускает исследования.",
        ],
    ),
    (
        "researchMaxDepth",
        [
            "Highest depth allowed",
            "Profondeur maximale autorisée",
            "Profundidad máxima permitida",
            "Максимальная глубина",
        ],
    ),
    (
        "researchKeep",
        [
            "Keep research for",
            "Conserver les recherches",
            "Conservar las investigaciones",
            "Хранить исследования",
        ],
    ),
    ("keepForever", ["Forever", "Toujours", "Siempre", "Всегда"]),
    ("keep90", ["90 days", "90 jours", "90 días", "90 дней"]),
    ("keep30", ["30 days", "30 jours", "30 días", "30 дней"]),
    (
        "researchEmpty",
        [
            "No research yet. Ask a question that needs sources and the model starts one.",
            "Aucune recherche pour l'instant. Posez une question qui demande des sources et le modèle en lance une.",
            "Aún no hay investigaciones. Haz una pregunta que necesite fuentes y el modelo inicia una.",
            "Исследований пока нет. Задайте вопрос, которому нужны источники, и модель начнёт его.",
        ],
    ),
];

/// The text for a key in the system language (English, French, Spanish or Russian). An unknown key reads as itself.
pub fn t(key: &str) -> String {
    text_in(&detect_system_locale(), key)
}

/// A count in its label, singular when it is one.
fn count(n: usize, one: &str, other: &str) -> String {
    t(if n == 1 { one } else { other }).replace("{n}", &n.to_string())
}

fn text_in(locale: &str, key: &str) -> String {
    let column = match locale {
        "fr" => 1,
        "es" => 2,
        "ru" => 3,
        _ => 0,
    };
    TEXTS
        .iter()
        .find(|(name, _)| *name == key)
        .map_or_else(|| key.to_owned(), |(_, texts)| texts[column].to_owned())
}

/// The detail line of a past run in the settings list: depth, sources read and the day it started.
pub fn past_run_line(depth: &str, sources: i64, started_ms: i64) -> String {
    let days = started_ms / 86_400_000;
    let (year, month, day) = civil(days);
    format!(
        "{} · {} · {year:04}-{month:02}-{day:02}",
        t(depth_key(depth)),
        count(
            sources.max(0) as usize,
            "researchRunSourcesOne",
            "researchRunSources"
        )
    )
}

fn depth_key(depth: &str) -> &'static str {
    match depth {
        "quick" => "researchDepthQuick",
        "deep" => "researchDepthDeep",
        _ => "researchDepthStandard",
    }
}

/// A day count since 1970-01-01 as year, month and day.
fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run() -> RunView {
        serde_json::from_str(
            r#"{"id":"r1","question":"Why","depth":"standard","endedAt":5,
            "questions":[{"text":"a","notes":1},{"text":"b","notes":0}],
            "sources":[{"id":"s1","url":"https://x.org/a","title":"A & B","site":"x.org","published":"2026-01-02T00:00","status":"read"},
                       {"id":"s2","url":"https://y.org","title":"Y","status":"read"}],
            "notes":[{"id":"n1","sourceId":"s2","quote":"q","verified":true},{"id":"n2","sourceId":"s1","quote":"r"}],
            "hosts":["x.org"]}"#,
        )
        .expect("view")
    }

    #[test]
    fn note_ids_become_chips_and_bare_numbers_stay() {
        let marked = link_citations("Yes [n1] and [1] and [n9] and [n2].", &run());
        assert!(marked.contains("<a href=\"https://y.org\""));
        assert!(marked.contains("> 1 </span>"));
        assert!(marked.contains("> 2 </span>"));
        assert!(marked.contains("[1]") && marked.contains("[n9]"));
    }

    #[test]
    fn the_source_list_follows_the_notes() {
        let lines = source_list_markup(&run());
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("1. <a href=\"https://x.org/a\">A &amp; B</a>"));
        assert!(lines[1].starts_with("2. <a href=\"https://y.org\">Y</a>"));
    }

    #[test]
    fn only_research_run_steps_parse() {
        let step = StepRecord {
            kind: "research_run".into(),
            content: Some(r#"{"id":"r","depth":"deep"}"#.into()),
            ..StepRecord::default()
        };
        assert_eq!(
            parse_step(&step).map(|view| view.depth),
            Some("deep".to_owned())
        );
        assert!(
            parse_step(&StepRecord {
                kind: "search".into(),
                ..step
            })
            .is_none()
        );
    }

    #[test]
    fn counts_are_singular_when_one() {
        let one = t("researchRunNotesOne").replace("{n}", "1");
        assert_eq!(count(1, "researchRunNotesOne", "researchRunNotes"), one);
        assert_ne!(count(2, "researchRunNotesOne", "researchRunNotes"), one);
    }

    #[test]
    fn texts_exist_in_all_four_locales() {
        for (key, texts) in TEXTS {
            assert!(texts.iter().all(|text| !text.is_empty()), "{key}");
        }
        assert_eq!(text_in("ru", "researchRunTitle"), "Исследование");
        assert_eq!(text_in("de", "researchRunTitle"), "Research");
    }

    #[test]
    fn a_site_badge_is_its_name_letter_on_a_steady_colour() {
        let badge = site_badge("https://www.bbc.co.uk/news");
        assert!(badge.contains("> b <"), "{badge}");
        assert_eq!(badge, site_badge("http://bbc.com:8080/"));
        assert_eq!(hsl_hex(0), "#be2d2d");
    }

    #[test]
    fn a_source_sits_under_the_question_its_note_answers() {
        let mut view = run();
        view.notes[0].sub_question = Some(2);
        let (groups, other) = group_sources(&view);
        assert!(groups[0].is_empty());
        assert_eq!(groups[1][0].id, "s2");
        assert_eq!(other.len(), 1);
        assert_eq!(card_header(&view).matches(" · ").count(), 1);
    }

    #[test]
    fn a_finished_run_without_notes_warns() {
        assert!(no_notes_line(&run()).is_none());
        let mut bare = run();
        bare.notes.clear();
        assert!(no_notes_line(&bare).is_some());
        bare.ended_at = None;
        assert!(no_notes_line(&bare).is_none());
    }

    #[test]
    fn dates_are_civil() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_453), (2025, 12, 31));
        assert!(past_run_line("deep", 3, 0).ends_with("1970-01-01"));
    }
}
