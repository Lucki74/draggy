//! Reads the parts of an Office package. A package is a zip file, so the zip crate does the container work.

use std::io::{Cursor, Read};

use zip::ZipArchive;
use zip::result::ZipError;

use crate::office_error::OfficeError;

/// An open package. A part that is not in the archive reads as None rather than as an error.
pub(crate) struct Package<'a> {
    archive: ZipArchive<Cursor<&'a [u8]>>,
}

/// The most one part of a package may inflate to.
#[cfg(not(test))]
const MAX_PART_BYTES: u64 = 256 * 1024 * 1024;
/// Small under test, so the refusal can be shown with a part that is cheap to build.
#[cfg(test)]
const MAX_PART_BYTES: u64 = 1024 * 1024;

impl<'a> Package<'a> {
    pub(crate) fn open(bytes: &'a [u8]) -> Result<Self, OfficeError> {
        let archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| OfficeError::NotAPackage)?;
        Ok(Self { archive })
    }

    pub(crate) fn names(&self) -> Vec<String> {
        self.archive
            .file_names()
            .filter_map(|name| name.ok().map(|name| name.into_owned()))
            .collect()
    }

    /// The text of one part, with bytes that are not UTF-8 replaced, or None when the part is absent.
    pub(crate) fn text(&mut self, name: &str) -> Result<Option<String>, OfficeError> {
        let mut file = match self.archive.by_name(name) {
            Ok(file) => file,
            Err(ZipError::FileNotFound) => return Ok(None),
            Err(error) => return Err(OfficeError::Corrupt(error.to_string())),
        };
        // A few kilobytes of zip can inflate to gigabytes, so a part is read only up to a size no real document has.
        let mut buffer = Vec::new();
        file.by_ref()
            .take(MAX_PART_BYTES + 1)
            .read_to_end(&mut buffer)
            .map_err(|error| OfficeError::Corrupt(error.to_string()))?;
        if buffer.len() as u64 > MAX_PART_BYTES {
            return Err(OfficeError::Corrupt(
                "a part of the package is too large".to_owned(),
            ));
        }
        Ok(Some(String::from_utf8_lossy(&buffer).into_owned()))
    }
}

/// The names of every entry in a package, directories included. Refuses bytes that are not a zip archive.
pub fn part_names(bytes: &[u8]) -> Result<Vec<String>, OfficeError> {
    Ok(Package::open(bytes)?.names())
}
