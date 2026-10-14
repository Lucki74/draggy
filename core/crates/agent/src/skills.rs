//! Skills as the model meets them: a slash command, the loaded instructions and the rendered text of each. A port of
//! the pure helpers in `src/skills/skills.ts`. Reading a skill's body is a trait, since it lives in the main process.

use serde_json::{Value, json};

use crate::agent_loop::ToolContext;
use crate::js::{is_js_space, trim_js, trim_start_js};
use crate::prompts::PromptSkill;
use crate::resume::SearchStep;
use crate::task_manager::Message;

/// Skills kept loaded at once. Each stays for the rest of the conversation, and a small window cannot carry a shelf.
pub const MAX_LOADED_SKILLS: usize = 5;

/// Anything longer than this in the prompt is a skill list nobody reads.
pub const MAX_LISTED_SKILLS: usize = 40;

/// The side of the app a turn runs on. A project is Code's; everything else is Chat's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Chat,
    Code,
}

/// The side a skill is offered on. A skill with none is offered on both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    Chat,
    Code,
    Both,
}

/// A skill as the shelf holds it: installed, switched on or off, and the side it is offered on.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct InstalledSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub surface: Option<Surface>,
    /// A missing flag reads as on, as `enabled !== false` does in the reference.
    pub enabled: Option<bool>,
    /// False when only a slash command may start it, never the model on its own.
    pub model_invocable: Option<bool>,
}

impl From<&InstalledSkill> for PromptSkill {
    fn from(skill: &InstalledSkill) -> Self {
        Self {
            id: skill.id.clone(),
            name: skill.name.clone(),
            description: skill.description.clone(),
            model_invocable: skill.model_invocable,
        }
    }
}

/// `skillsFor`: the skills switched on for one side, in shelf order. A skill with no side of its own is on both.
pub fn skills_for(skills: &[InstalledSkill], side: Side) -> Vec<&InstalledSkill> {
    skills
        .iter()
        .filter(|skill| skill.enabled != Some(false))
        .filter(|skill| match skill.surface {
            None | Some(Surface::Both) => true,
            Some(Surface::Chat) => side == Side::Chat,
            Some(Surface::Code) => side == Side::Code,
        })
        .collect()
}

/// A file that came with a skill, as `use_skill` reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillFile {
    pub name: String,
    pub content: String,
}

/// A skill loaded instructions, from the shell's store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillLookup {
    /// The skill, and the file asked for when it was found.
    Found {
        skill: LoadedSkill,
        file: Option<SkillFile>,
    },
    /// Switched off, gone, or unreadable. The error is what the model is told, when there is one.
    Missing { error: Option<String> },
}

/// Reads a skill for a `use_skill` call. Each read is one call to the main process in the app.
pub trait SkillSource {
    fn lookup(&mut self, workspace_id: &str, id: &str, file: Option<&str>) -> SkillLookup;
}

/// `renderSkillFile`: one file that came with a skill, as the model is handed it.
pub fn render_skill_file(skill: &LoadedSkill, file: &SkillFile) -> String {
    format!("SKILL FILE: {}/{}\n\n{}", skill.id, file.name, file.content)
}

/// `use_skill` in `src/tools/skills.ts`: loads a skill's instructions, or one file that came with it. The step it
/// shows is pushed first, then settled once the read answers. `text` is the host's translation.
pub fn use_skill(
    ctx: &mut ToolContext<'_>,
    source: &mut dyn SkillSource,
    workspace_id: &str,
    id: &str,
    file: Option<&str>,
    text: &dyn Fn(&str) -> String,
) -> String {
    let file = file.map(trim_js).filter(|name| !name.is_empty());
    let step_id = ctx.new_id();
    let label = match file {
        Some(name) => format!("{id}/{name}"),
        None => id.to_string(),
    };

    ctx.steps.push(SearchStep {
        id: Some(step_id.clone()),
        kind: "skill".to_string(),
        content: Some(format!("{} **{}**", text("usingSkill"), label)),
        is_complete: Some(false),
        ..SearchStep::default()
    });

    match source.lookup(workspace_id, id, file) {
        SkillLookup::Missing { error } => {
            patch_step(ctx.steps, &step_id, |step| {
                step.is_complete = Some(true);
                step.kind = "error".to_string();
            });
            let message = error
                .filter(|error| !error.is_empty())
                .unwrap_or_else(|| "Skills are not available in this build.".to_string());
            format!("TOOL RESULT (use_skill): {message}")
        }
        SkillLookup::Found { skill, file: found } => {
            let shown = match file {
                Some(_) => label.clone(),
                None => skill.name.clone(),
            };
            patch_step(ctx.steps, &step_id, |step| {
                step.is_complete = Some(true);
                step.content = Some(format!("{} **{}**", text("usedSkill"), shown));
                // Instructions stay loaded for the rest of the conversation; a file read once does not.
                if file.is_none() {
                    step.extra.insert("skill".to_string(), json!(skill.id));
                }
            });

            match (file, found) {
                (Some(_), Some(found)) => {
                    format!(
                        "TOOL RESULT (use_skill):\n{}",
                        render_skill_file(&skill, &found)
                    )
                }
                _ => format!("TOOL RESULT (use_skill):\n{}", render_skill(&skill)),
            }
        }
    }
}

/// Settles the step a tool pushed. A step that has gone missing is left alone, as the reference does.
fn patch_step(steps: &mut [SearchStep], id: &str, patch: impl FnOnce(&mut SearchStep)) {
    if let Some(step) = steps.iter_mut().find(|step| step.id.as_deref() == Some(id)) {
        patch(step);
    }
}

/// A skill whose instructions are loaded: what the shell reads for an id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedSkill {
    pub id: String,
    pub name: String,
    pub body: String,
    /// Anything else in the skill's folder, relative to it.
    pub files: Vec<String>,
}

/// Reads the instructions of a skill for a workspace. Each read is one call to the main process in the app.
pub trait SkillReader {
    /// `None` when the skill is switched off or can no longer be read; the turn then goes on without it.
    fn read(&mut self, workspace_id: &str, id: &str) -> Option<LoadedSkill>;
}

/// A message that starts with a skill's slash command, and the request that came with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SkillInvocation<'a> {
    pub skill: &'a PromptSkill,
    pub request: &'a str,
}

/// `skillInvocation`: `/code-review src/app.ts` starts the skill whose id matches, ignoring case.
pub fn skill_invocation<'a>(
    text: &'a str,
    skills: &'a [PromptSkill],
) -> Option<SkillInvocation<'a>> {
    let rest = trim_js(text).strip_prefix('/')?;
    let first = rest.bytes().next()?;
    if !first.is_ascii_alphanumeric() {
        return None;
    }
    let name_len = rest
        .bytes()
        .take_while(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
        .count();
    let (name, tail) = rest.split_at(name_len);

    // The request follows the name after at least one space, or the message ends with the name.
    let request = if tail.is_empty() {
        ""
    } else if tail.starts_with(is_js_space) {
        trim_start_js(tail)
    } else {
        return None;
    };

    let wanted = name.to_lowercase();
    let skill = skills.iter().find(|one| one.id.to_lowercase() == wanted)?;
    Some(SkillInvocation { skill, request })
}

/// `renderInvokedSkill`: what a slash command adds to the message it starts. The instructions sit with the loaded skills.
pub fn render_invoked_skill(skill: &PromptSkill, request: &str) -> String {
    let task = if request.is_empty() {
        "It came with no further request, so ask what the user wants it applied to if that is not clear from the conversation."
            .to_string()
    } else {
        format!("The request that came with it: {request}")
    };

    format!(
        "The user started this message with /{}, which runs the {} skill. Its instructions are loaded under LOADED SKILLS in your instructions, so there is no need to call use_skill for it. {task}",
        skill.id, skill.name
    )
}

/// `loadedSkillIds`: the skills a conversation has loaded, most recent last, by a slash command or by the model's
/// `use_skill`. Only ids still offered count, and only the last `MAX_LOADED_SKILLS` are kept.
pub fn loaded_skill_ids(messages: &[Message], skills: &[PromptSkill]) -> Vec<String> {
    let mut order: Vec<String> = Vec::new();
    let mut note = |id: &str| {
        if !skills.iter().any(|skill| skill.id == id) {
            return;
        }
        order.retain(|kept| kept != id);
        order.push(id.to_string());
    };

    for message in messages {
        if message.role == "user" {
            if let Some(invocation) = skill_invocation(&message.content, skills) {
                note(&invocation.skill.id);
            }
            continue;
        }

        for step in message.steps.iter().flatten() {
            if step.kind != "skill" || step.is_complete != Some(true) {
                continue;
            }
            if let Some(id) = step.extra.get("skill").and_then(Value::as_str) {
                note(id);
            }
        }
    }

    let start = order.len().saturating_sub(MAX_LOADED_SKILLS);
    order[start..].to_vec()
}

/// `renderSkill`: what the model is handed for one skill.
pub fn render_skill(skill: &LoadedSkill) -> String {
    let files = if skill.files.is_empty() {
        String::new()
    } else {
        let listed: Vec<String> = skill.files.iter().map(|name| format!("- {name}")).collect();
        format!(
            "\n\nFiles that came with it. Read one with use_skill, passing this skill's id and the file:\n{}",
            listed.join("\n")
        )
    };
    format!("SKILL: {}\n\n{}{files}", skill.name, skill.body)
}

/// `renderLoadedSkills`: the instructions of every loaded skill, kept in the system prompt for the turns after.
pub fn render_loaded_skills(loaded: &[LoadedSkill]) -> String {
    if loaded.is_empty() {
        return String::new();
    }
    let bodies: Vec<String> = loaded.iter().map(render_skill).collect();
    format!(
        "LOADED SKILLS\n\nThese skills were loaded earlier in this conversation. Keep following them wherever they apply, without calling use_skill for them again.\n\n{}",
        bodies.join("\n\n---\n\n")
    )
}
