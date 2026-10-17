//! Reading documents through the boundary call, with files written by the documents crate itself.

use draggy_core::{CoreError, read_document};
use draggy_documents::office_files::write_generated_file;

fn read(path: &std::path::Path) -> Result<String, CoreError> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(read_document(path.display().to_string()))
}

#[test]
fn a_word_file_gives_its_text() {
    let folder = tempfile::tempdir().expect("folder");
    let path = folder.path().join("note.docx");
    write_generated_file(&path, "<h1>Plan</h1><p>Ship the beta on Friday.</p>").expect("write");

    let text = read(&path).expect("text");

    assert!(text.contains("Plan"), "{text}");
    assert!(text.contains("Ship the beta on Friday."), "{text}");
}

#[test]
fn a_plain_text_file_is_refused() {
    let folder = tempfile::tempdir().expect("folder");
    let path = folder.path().join("note.txt");
    std::fs::write(&path, "hello").expect("write");

    let error = read(&path).expect_err("refused");

    assert!(matches!(&error, CoreError::Invalid { message } if message.starts_with("note.txt")));
}

#[test]
fn a_missing_file_is_reported_by_name() {
    let folder = tempfile::tempdir().expect("folder");

    let error = read(&folder.path().join("gone.docx")).expect_err("missing");

    assert!(matches!(&error, CoreError::Invalid { message } if message.starts_with("gone.docx")));
}

#[test]
fn a_file_that_is_not_a_package_is_refused() {
    let folder = tempfile::tempdir().expect("folder");
    let path = folder.path().join("broken.xlsx");
    std::fs::write(&path, "not a zip").expect("write");

    let error = read(&path).expect_err("refused");

    assert!(matches!(&error, CoreError::Invalid { message } if message.contains("broken.xlsx")));
}
