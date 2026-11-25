//! One-time import of the renderer's localStorage from Electron's Chromium profile. Electron kept it in
//! `<userData>/Local Storage/leveldb` under `app://draggy`; WebView2 starts empty. Read with a small LevelDB
//! reader (write-ahead logs, plain and Snappy tables), so no new crate is needed.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use draggy_diagnostics::Diagnostics;
use draggy_storage::Storage;

/// Where the Electron profile keeps localStorage, relative to the data folder.
const LEVELDB_DIR: [&str; 2] = ["Local Storage", "leveldb"];
/// The origin key prefix Chromium uses for the renderer: `_<origin>\0`.
const ORIGIN_PREFIX: &[u8] = b"_app://draggy\0";
/// Set in the database once the import has run, so it never runs twice.
const FLAG: &str = "legacy_local_storage_v1";
/// Set in the webview's localStorage once its keys are copied, so each key is copied at most once.
const WEBVIEW_FLAG: &str = "draggy_electron_import_v1";

const CORRUPT: &str = "the file is corrupt";
const LOG_BLOCK: usize = 32 * 1024;
const LOG_HEADER: usize = 7;
const TABLE_FOOTER: usize = 48;
const BLOCK_TRAILER: usize = 5;

type Res<T> = Result<T, &'static str>;
/// User key to its latest value, or None when a later write deleted it.
type Entries = BTreeMap<Vec<u8>, Option<Vec<u8>>>;
/// Table rows: user key and value, None for a deletion.
type Rows = Vec<(Vec<u8>, Option<Vec<u8>>)>;

/// Reads a LevelDB-format directory and returns the renderer's localStorage pairs, values as text.
pub fn read_pairs(dir: &Path) -> Result<Vec<(String, String)>, String> {
    let mut files = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("could not list the folder: {e}"))? {
        let entry = entry.map_err(|e| format!("could not list the folder: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let digits: String = name.chars().take_while(char::is_ascii_digit).collect();
        let Ok(number) = digits.parse::<u64>() else {
            continue;
        };
        if name.ends_with(".log") {
            files.push((number, entry.path(), true));
        } else if name.ends_with(".ldb") || name.ends_with(".sst") {
            files.push((number, entry.path(), false));
        }
    }
    files.sort_by_key(|file| file.0);

    let mut entries = Entries::new();
    for (_, path, is_log) in files {
        let bytes = fs::read(&path).map_err(|e| format!("a data file could not be read: {e}"))?;
        if is_log {
            for payload in wal_payloads(&bytes) {
                let _ = apply_batch(&payload, &mut entries);
            }
        } else {
            for (key, value) in table_entries(&bytes).map_err(str::to_owned)? {
                entries.insert(key, value);
            }
        }
    }

    Ok(entries
        .into_iter()
        .filter_map(|(key, value)| {
            let value = value?;
            let key = key.strip_prefix(ORIGIN_PREFIX)?;
            Some((decode_text(key)?, decode_text(&value)?))
        })
        .collect())
}

/// Chromium stores text as a kind byte (0 UTF-16LE, 1 Latin-1) followed by the bytes.
fn decode_text(bytes: &[u8]) -> Option<String> {
    let Some((&kind, rest)) = bytes.split_first() else {
        return Some(String::new());
    };
    match kind {
        0 => {
            if rest.len() % 2 == 1 {
                return None;
            }
            let units: Vec<u16> = rest
                .chunks(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            String::from_utf16(&units).ok()
        }
        1 => Some(rest.iter().map(|&byte| char::from(byte)).collect()),
        _ => None,
    }
}

fn varint(data: &[u8], pos: &mut usize) -> Option<usize> {
    let mut value = 0usize;
    let mut shift = 0u32;
    loop {
        let byte = *data.get(*pos)?;
        *pos += 1;
        if shift >= 64 {
            return None;
        }
        value |= usize::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some(value);
        }
        shift += 7;
    }
}

fn take_bytes(data: &[u8], pos: &mut usize) -> Option<Vec<u8>> {
    let len = varint(data, pos)?;
    let end = pos.checked_add(len)?;
    let slice = data.get(*pos..end)?;
    *pos = end;
    Some(slice.to_vec())
}

/// Reassembles the records of a write-ahead log. Blocks are 32 KiB; a record may span several.
fn wal_payloads(bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut partial: Option<Vec<u8>> = None;
    let mut pos = 0;
    while pos + LOG_HEADER <= bytes.len() {
        let block_left = LOG_BLOCK - pos % LOG_BLOCK;
        let kind = bytes[pos + 6];
        let len = usize::from(u16::from_le_bytes([bytes[pos + 4], bytes[pos + 5]]));
        // Kinds 5 to 8 are recyclable records, which carry a 4-byte log number after the header.
        let header = if (5..=8).contains(&kind) {
            LOG_HEADER + 4
        } else {
            LOG_HEADER
        };
        if block_left < LOG_HEADER || (kind == 0 && len == 0) {
            pos += block_left;
            continue;
        }
        let start = pos + header;
        let end = start + len;
        if end > bytes.len() || end > pos - pos % LOG_BLOCK + LOG_BLOCK {
            break;
        }
        let chunk = &bytes[start..end];
        match kind {
            1 | 5 => out.push(chunk.to_vec()),
            2 | 6 => partial = Some(chunk.to_vec()),
            3 | 7 => {
                if let Some(part) = partial.as_mut() {
                    part.extend_from_slice(chunk);
                }
            }
            4 | 8 => {
                if let Some(mut part) = partial.take() {
                    part.extend_from_slice(chunk);
                    out.push(part);
                }
            }
            _ => break,
        }
        pos = end;
    }
    out
}

/// A write batch: sequence (8 bytes), count (4 bytes), then puts (1) and deletes (0).
fn apply_batch(payload: &[u8], entries: &mut Entries) -> Option<()> {
    let count = usize::try_from(u32::from_le_bytes(payload.get(8..12)?.try_into().ok()?)).ok()?;
    let mut pos = 12;
    for _ in 0..count {
        let kind = *payload.get(pos)?;
        pos += 1;
        let key = take_bytes(payload, &mut pos)?;
        match kind {
            1 => {
                let value = take_bytes(payload, &mut pos)?;
                entries.insert(key, Some(value));
            }
            0 => {
                entries.insert(key, None);
            }
            _ => return None,
        }
    }
    Some(())
}

/// Every (internal key, value) of a table. The last 8 key bytes hold sequence and kind (1 is a value).
fn table_entries(bytes: &[u8]) -> Res<Rows> {
    let footer_at = bytes.len().checked_sub(TABLE_FOOTER).ok_or(CORRUPT)?;
    let footer = &bytes[footer_at..];
    let mut pos = 0;
    let _metaindex = read_handle(footer, &mut pos)?;
    let index = read_handle(footer, &mut pos)?;

    let mut out = Vec::new();
    for (_, handle) in block_entries(&read_block(bytes, index)?)? {
        let mut at = 0;
        let data = read_block(bytes, read_handle(&handle, &mut at)?)?;
        for (key, value) in block_entries(&data)? {
            let Some(split) = key.len().checked_sub(8) else {
                continue;
            };
            let kind = key[split];
            let user = key[..split].to_vec();
            out.push((user, (kind == 1).then_some(value)));
        }
    }
    Ok(out)
}

fn read_handle(data: &[u8], pos: &mut usize) -> Res<(usize, usize)> {
    let offset = varint(data, pos).ok_or(CORRUPT)?;
    let size = varint(data, pos).ok_or(CORRUPT)?;
    Ok((offset, size))
}

/// The contents of a block, unpacked when its trailer says Snappy (1).
fn read_block(bytes: &[u8], (offset, size): (usize, usize)) -> Res<Vec<u8>> {
    let end = offset.checked_add(size).ok_or(CORRUPT)?;
    let trailer_end = end.checked_add(BLOCK_TRAILER).ok_or(CORRUPT)?;
    if trailer_end > bytes.len() {
        return Err(CORRUPT);
    }
    let contents = &bytes[offset..end];
    match bytes[end] {
        0 => Ok(contents.to_vec()),
        1 => snappy_decompress(contents),
        _ => Err(CORRUPT),
    }
}

/// Restart-point block: prefix-compressed entries, then restart offsets and their count.
fn block_entries(block: &[u8]) -> Res<Vec<(Vec<u8>, Vec<u8>)>> {
    let count_at = block.len().checked_sub(4).ok_or(CORRUPT)?;
    let restarts = usize::try_from(u32::from_le_bytes(
        block[count_at..].try_into().map_err(|_| CORRUPT)?,
    ))
    .map_err(|_| CORRUPT)?;
    let data_end = count_at
        .checked_sub(restarts.checked_mul(4).ok_or(CORRUPT)?)
        .ok_or(CORRUPT)?;
    let data = &block[..data_end];

    let mut out = Vec::new();
    let mut key = Vec::new();
    let mut pos = 0;
    while pos < data.len() {
        let shared = varint(data, &mut pos).ok_or(CORRUPT)?;
        let non_shared = varint(data, &mut pos).ok_or(CORRUPT)?;
        let value_len = varint(data, &mut pos).ok_or(CORRUPT)?;
        let key_end = pos.checked_add(non_shared).ok_or(CORRUPT)?;
        let value_end = key_end.checked_add(value_len).ok_or(CORRUPT)?;
        if shared > key.len() || value_end > data.len() {
            return Err(CORRUPT);
        }
        key.truncate(shared);
        key.extend_from_slice(&data[pos..key_end]);
        out.push((key.clone(), data[key_end..value_end].to_vec()));
        pos = value_end;
    }
    Ok(out)
}

fn snappy_decompress(input: &[u8]) -> Res<Vec<u8>> {
    let mut pos = 0;
    let expected = varint(input, &mut pos).ok_or(CORRUPT)?;
    let mut out = Vec::with_capacity(expected);
    while pos < input.len() {
        let tag = input[pos];
        pos += 1;
        match tag & 3 {
            0 => {
                let mut len = usize::from(tag >> 2);
                if len >= 60 {
                    let extra = len - 59;
                    let bytes = input.get(pos..pos + extra).ok_or(CORRUPT)?;
                    len = bytes
                        .iter()
                        .rev()
                        .fold(0usize, |acc, &byte| (acc << 8) | usize::from(byte));
                    pos += extra;
                }
                let len = len + 1;
                out.extend_from_slice(input.get(pos..pos + len).ok_or(CORRUPT)?);
                pos += len;
            }
            1 => {
                let low = *input.get(pos).ok_or(CORRUPT)?;
                pos += 1;
                let offset = (usize::from(tag >> 5) << 8) | usize::from(low);
                copy_back(&mut out, offset, usize::from((tag >> 2) & 7) + 4)?;
            }
            2 => {
                let bytes = input.get(pos..pos + 2).ok_or(CORRUPT)?;
                let offset = usize::from(u16::from_le_bytes([bytes[0], bytes[1]]));
                pos += 2;
                copy_back(&mut out, offset, usize::from(tag >> 2) + 1)?;
            }
            _ => {
                let bytes = input.get(pos..pos + 4).ok_or(CORRUPT)?;
                let offset =
                    usize::try_from(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
                        .map_err(|_| CORRUPT)?;
                pos += 4;
                copy_back(&mut out, offset, usize::from(tag >> 2) + 1)?;
            }
        }
    }
    if out.len() != expected {
        return Err(CORRUPT);
    }
    Ok(out)
}

fn copy_back(out: &mut Vec<u8>, offset: usize, len: usize) -> Res<()> {
    if offset == 0 || offset > out.len() {
        return Err(CORRUPT);
    }
    let start = out.len() - offset;
    for k in 0..len {
        let byte = out[start + k];
        out.push(byte);
    }
    Ok(())
}

/// The script that copies the imported pairs into the webview's localStorage, or None when there is
/// nothing to do. Runs once: the database flag is set here, and the script sets its own flag on the page.
/// Existing webview keys are never overwritten.
pub fn import_script(data_dir: &Path, storage: &Storage, diag: &Diagnostics) -> Option<String> {
    match storage.get_value(FLAG) {
        Ok(None) => {}
        Ok(Some(_)) => return None,
        Err(error) => {
            diag.error(
                "localStorage",
                &format!("import state could not be read: {error}"),
                None,
            );
            return None;
        }
    }

    let dir = LEVELDB_DIR
        .iter()
        .fold(data_dir.to_path_buf(), |path, part| path.join(part));
    let pairs = if dir.is_dir() {
        match read_pairs(&dir) {
            Ok(pairs) => pairs,
            Err(error) => {
                diag.error(
                    "localStorage",
                    &format!("Electron localStorage was not read: {error}"),
                    None,
                );
                return None;
            }
        }
    } else {
        Vec::new()
    };

    if let Err(error) = storage.set_value(FLAG, "done") {
        diag.error(
            "localStorage",
            &format!("import state could not be saved: {error}"),
            None,
        );
        return None;
    }
    diag.info(
        "localStorage",
        &format!(
            "found {} renderer keys in the Electron profile",
            pairs.len()
        ),
        None,
    );
    if pairs.is_empty() {
        return None;
    }

    let payload = serde_json::to_string(&pairs).ok()?;
    Some(format!(
        "(function () {{ try {{ var h = location.hostname; if (h !== \"tauri.localhost\" && h !== \"localhost\") return; \
         var flag = \"{WEBVIEW_FLAG}\"; if (localStorage.getItem(flag) !== null) return; \
         var pairs = {payload}; for (var i = 0; i < pairs.length; i++) {{ \
         if (localStorage.getItem(pairs[i][0]) === null) localStorage.setItem(pairs[i][0], pairs[i][1]); }} \
         localStorage.setItem(flag, \"1\"); }} catch (e) {{}} }})();"
    ))
}

#[cfg(test)]
#[path = "legacy_local_storage_tests.rs"]
mod tests;
