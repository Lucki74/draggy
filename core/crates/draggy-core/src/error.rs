//! The one error type that crosses the boundary. It is flat: a kind and a message the shell can show.

/// Why a core call failed. A stopped turn is not an error; it returns an outcome with `aborted` set.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, uniffi::Error)]
pub enum CoreError {
    /// The caller passed something the core cannot use.
    #[error("{message}")]
    Invalid { message: String },
    /// The built-in engine could not be reached or started.
    #[error("{message}")]
    Engine { message: String },
    /// The model or its provider failed, with a message worded for the user.
    #[error("{message}")]
    Model { message: String },
    /// The core is shutting down or a worker died.
    #[error("{message}")]
    Internal { message: String },
}

impl From<draggy_agent::agent_loop::TurnError> for CoreError {
    fn from(error: draggy_agent::agent_loop::TurnError) -> Self {
        use draggy_agent::agent_loop::TurnError;
        match error {
            TurnError::Engine(message) => Self::Engine { message },
            TurnError::Model(message) => Self::Model { message },
        }
    }
}
