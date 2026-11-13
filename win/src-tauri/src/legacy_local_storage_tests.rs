use super::*;

fn push_varint(out: &mut Vec<u8>, mut n: usize) {
    loop {
        let low = (n & 0x7f) as u8;
        n >>= 7;
        if n == 0 {
            out.push(low);
            return;
        }
        out.push(low | 0x80);
    }
}

fn push_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    push_varint(out, bytes.len());
    out.extend_from_slice(bytes);
}

/// A write batch with puts (kind 1) and deletes (kind 0).
fn batch(seq: u64, ops: &[(u8, &str, &str)]) -> Vec<u8> {
    let mut out = seq.to_le_bytes().to_vec();
    out.extend_from_slice(&u32::try_from(ops.len()).unwrap().to_le_bytes());
    for (kind, key, value) in ops {
        out.push(*kind);
        push_bytes(&mut out, key.as_bytes());
        if *kind == 1 {
            push_bytes(&mut out, value.as_bytes());
        }
    }
    out
}

/// Splits payloads into 32 KiB log blocks the way LevelDB writes them.
fn wal_bytes(payloads: &[Vec<u8>]) -> Vec<u8> {
    let mut out = Vec::new();
    for payload in payloads {
        let mut rest = &payload[..];
        let mut first = true;
        loop {
            let left = LOG_BLOCK - out.len() % LOG_BLOCK;
            if left < LOG_HEADER {
                out.resize(out.len() + left, 0);
                continue;
            }
            let take = rest.len().min(left - LOG_HEADER);
            let last = take == rest.len();
            let kind = match (first, last) {
                (true, true) => 1u8,
                (true, false) => 2,
                (false, false) => 3,
                (false, true) => 4,
            };
            out.extend_from_slice(&[0, 0, 0, 0]);
            out.extend_from_slice(&u16::try_from(take).unwrap().to_le_bytes());
            out.push(kind);
            out.extend_from_slice(&rest[..take]);
            rest = &rest[take..];
            first = false;
            if last {
                break;
            }
        }
    }
    out
}

/// One restart point per entry, so every key is stored whole.
fn block(entries: &[(Vec<u8>, Vec<u8>)]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut restarts = Vec::new();
    for (key, value) in entries {
        restarts.push(u32::try_from(out.len()).unwrap());
        push_varint(&mut out, 0);
        push_varint(&mut out, key.len());
        push_varint(&mut out, value.len());
        out.extend_from_slice(key);
        out.extend_from_slice(value);
    }
    for restart in &restarts {
        out.extend_from_slice(&restart.to_le_bytes());
    }
    out.extend_from_slice(&u32::try_from(restarts.len()).unwrap().to_le_bytes());
    out
}

/// A table key: the user key, then sequence and kind (1 is a value, 0 a deletion).
fn internal(user: &str, kind: u8) -> Vec<u8> {
    let mut key = user.as_bytes().to_vec();
    key.extend_from_slice(&((1u64 << 8) | u64::from(kind)).to_le_bytes());
    key
}

/// Appends a block with an uncompressed trailer and returns its handle bytes.
fn push_block(out: &mut Vec<u8>, contents: &[u8]) -> Vec<u8> {
    let offset = out.len();
    out.extend_from_slice(contents);
    out.push(0);
    out.extend_from_slice(&[0; 4]);
    let mut handle = Vec::new();
    push_varint(&mut handle, offset);
    push_varint(&mut handle, contents.len());
    handle
}

/// A one-block table: data, index, empty metaindex, footer.
fn table(entries: &[(Vec<u8>, Vec<u8>)]) -> Vec<u8> {
    let mut out = Vec::new();
    let data_handle = push_block(&mut out, &block(entries));
    let last_key = entries
        .last()
        .map(|(key, _)| key.clone())
        .unwrap_or_default();
    let index_handle = push_block(&mut out, &block(&[(last_key, data_handle)]));
    let meta_handle = push_block(&mut out, &block(&[]));

    let mut footer = meta_handle;
    footer.extend_from_slice(&index_handle);
    footer.resize(TABLE_FOOTER - 8, 0);
    footer.extend_from_slice(&[0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]);
    out.extend_from_slice(&footer);
    out
}

/// The Chromium key for one renderer localStorage item: origin, NUL, then a kind byte and the name.
fn origin_key(name: &str) -> String {
    format!("_app://draggy\0\u{1}{name}")
}

fn leveldb_dir(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("Local Storage").join("leveldb")
}

#[test]
fn decodes_utf16_and_latin1_text() {
    let mut utf16 = vec![0u8];
    utf16.extend("draft".encode_utf16().flat_map(u16::to_le_bytes));
    assert_eq!(decode_text(&utf16).as_deref(), Some("draft"));
    assert_eq!(decode_text(b"\x01caf\xe9").as_deref(), Some("caf\u{e9}"));
    assert_eq!(decode_text(&[]).as_deref(), Some(""));
    assert_eq!(decode_text(&[7, 1, 2]), None);
}

#[test]
fn varints_round_trip() {
    for n in [0usize, 1, 127, 128, 300, 70_000] {
        let mut out = Vec::new();
        push_varint(&mut out, n);
        let mut pos = 0;
        assert_eq!(varint(&out, &mut pos), Some(n));
        assert_eq!(pos, out.len());
    }
}

#[test]
fn log_replays_puts_and_deletes_across_blocks() {
    let big = "x".repeat(40_000);
    let payloads = vec![
        batch(1, &[(1, "a", "one")]),
        batch(2, &[(1, "big", big.as_str()), (0, "a", "")]),
        batch(3, &[(1, "b", "two")]),
    ];
    let mut entries = Entries::new();
    for payload in wal_payloads(&wal_bytes(&payloads)) {
        apply_batch(&payload, &mut entries).expect("batch");
    }
    assert_eq!(entries.get(b"a".as_slice()), Some(&None));
    assert_eq!(entries.get(b"b".as_slice()), Some(&Some(b"two".to_vec())));
    let stored = entries
        .get(b"big".as_slice())
        .and_then(|v| v.as_ref())
        .map(Vec::len);
    assert_eq!(stored, Some(40_000));
}

#[test]
fn snappy_literals_and_copies() {
    // Literal "abc", then a two-byte-offset copy of 6 bytes from 3 back.
    let stream = [9u8, 8, b'a', b'b', b'c', (5 << 2) | 2, 3, 0];
    assert_eq!(snappy_decompress(&stream).unwrap(), b"abcabcabc");
    // An offset that reaches before the output start is corrupt.
    assert!(snappy_decompress(&[4u8, 8, b'a', b'b', b'c', 0x02, 9, 0]).is_err());
}

#[test]
fn table_yields_values_and_deletions() {
    let entries = vec![
        (internal("keep", 1), b"v".to_vec()),
        (internal("gone", 0), Vec::new()),
    ];
    let found = table_entries(&table(&entries)).expect("table");
    assert_eq!(
        found,
        vec![
            (b"keep".to_vec(), Some(b"v".to_vec())),
            (b"gone".to_vec(), None)
        ]
    );
}

#[test]
fn reads_only_the_renderer_origin_from_log_and_table() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let dir = leveldb_dir(tmp.path());
    fs::create_dir_all(&dir).unwrap();

    let settings = origin_key("draggy_settings");
    let other = "_other://site\0\u{1}draggy_settings".to_owned();
    let table_rows = vec![
        (internal(&settings, 1), b"\x01{}".to_vec()),
        (internal(&other, 1), b"\x01no".to_vec()),
    ];
    fs::write(dir.join("000003.ldb"), table(&table_rows)).unwrap();

    let workspace = origin_key("draggy_workspace");
    let draft = origin_key("draggy_draft");
    let log = wal_bytes(&[
        batch(10, &[(1, workspace.as_str(), "\u{1}w")]),
        batch(
            11,
            &[(1, draft.as_str(), "\u{1}d1"), (0, settings.as_str(), "")],
        ),
    ]);
    fs::write(dir.join("000004.log"), log).unwrap();

    let pairs = read_pairs(&dir).expect("read");
    assert_eq!(
        pairs,
        vec![
            ("draggy_draft".to_owned(), "d1".to_owned()),
            ("draggy_workspace".to_owned(), "w".to_owned()),
        ]
    );
}

#[test]
fn import_script_runs_once_and_copies_nothing_twice() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let dir = leveldb_dir(tmp.path());
    fs::create_dir_all(&dir).unwrap();
    let key = origin_key("draggy_last_project");
    fs::write(
        dir.join("000001.log"),
        wal_bytes(&[batch(1, &[(1, key.as_str(), "\u{1}p-1")])]),
    )
    .unwrap();

    let storage = draggy_storage::Storage::open(tmp.path()).expect("storage");
    let diag = crate::storage::test_diag(tmp.path());

    let script = import_script(tmp.path(), &storage, &diag).expect("script");
    assert!(script.contains("draggy_last_project"));
    assert!(script.contains("p-1"));
    assert!(import_script(tmp.path(), &storage, &diag).is_none());
}

#[test]
fn import_marks_done_when_there_is_no_electron_profile() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let storage = draggy_storage::Storage::open(tmp.path()).expect("storage");
    let diag = crate::storage::test_diag(tmp.path());

    assert!(import_script(tmp.path(), &storage, &diag).is_none());
    assert_eq!(storage.get_value(FLAG).unwrap().as_deref(), Some("done"));
}
