pub trait CloudTtsProvider: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
}
