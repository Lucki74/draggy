//! What a model can do, asked of the engine rather than guessed from its name. The two questions fail the opposite way:
//! an unknown model may chat, but may not index. Port of src/modelKinds.ts.

/// A model with a capability list the engine reports.
pub trait Capabilities {
    fn capabilities(&self) -> &[String];
}

/// Whether a model cannot hold a conversation. An empty list (the reference's `undefined` too) is no objection.
pub fn cannot_generate(capabilities: &[String]) -> bool {
    !capabilities.is_empty()
        && !capabilities
            .iter()
            .any(|capability| capability == "completion")
}

/// Whether this model can turn text into vectors for the library.
pub fn is_embedding_model(capabilities: &[String]) -> bool {
    capabilities
        .iter()
        .any(|capability| capability == "embedding")
}

/// Whether this model draws pictures.
pub fn is_image_model(capabilities: &[String]) -> bool {
    capabilities
        .iter()
        .any(|capability| capability == "image-generation")
}

/// The installed models worth offering in chat and Talk: both rule out exactly the models that cannot generate text.
pub fn selectable_models<T: Capabilities>(models: &[T]) -> Vec<&T> {
    models
        .iter()
        .filter(|model| {
            !cannot_generate(model.capabilities()) && !is_image_model(model.capabilities())
        })
        .collect()
}
