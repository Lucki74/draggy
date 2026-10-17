use draggy_core::ModelLibrary;

fn library(dir: &std::path::Path) -> ModelLibrary {
    ModelLibrary::new(dir.to_string_lossy().into_owned()).unwrap()
}

#[test]
fn a_missing_models_folder_lists_as_empty() {
    let dir = tempfile::tempdir().unwrap();
    let library = library(&dir.path().join("not-made-yet"));
    assert!(library.installed().unwrap().is_empty());
}

#[test]
fn deleting_a_file_that_is_not_there_says_so() {
    let dir = tempfile::tempdir().unwrap();
    assert!(!library(dir.path()).delete("nothing.gguf".into()).unwrap());
}

#[test]
fn a_file_that_is_not_a_model_is_not_listed() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("notes.txt"), b"x").unwrap();
    assert!(library(dir.path()).installed().unwrap().is_empty());
}
