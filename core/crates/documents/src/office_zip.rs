//! Reads the parts of an Office package. A package is a zip file, so the zip crate does the container work.

use std::io::{Cursor, Read};

use zip::ZipArchive;
use zip::result::ZipError;

use crate::office_error::OfficeError;

/// An open package. A part that is not in the archive reads as None rather than as an error.
pub(crate) struct Package<'a> {
    archive: ZipArchive<Cursor<&'a [u8]>>,
}

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
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)
            .map_err(|error| OfficeError::Corrupt(error.to_string()))?;
        Ok(Some(String::from_utf8_lossy(&buffer).into_owned()))
    }
}

/// The names of every entry in a package, directories included. Refuses bytes that are not a zip archive.
pub fn part_names(bytes: &[u8]) -> Result<Vec<String>, OfficeError> {
    Ok(Package::open(bytes)?.names())
}
