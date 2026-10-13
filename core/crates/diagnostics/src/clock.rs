//! Where the writer reads time. Tests inject a fixed clock so every stamp and duration is exact.

use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Wall time stamps each line; monotonic time only ever measures a duration.
pub trait Clock: Send + Sync {
    /// Unix milliseconds.
    fn unix_ms(&self) -> i64;
    /// Milliseconds on a monotonic clock. Only the difference between two readings means anything.
    fn mono_ms(&self) -> f64;
}

/// The real clock. Wall time comes from the OS, durations from `Instant`.
pub struct SystemClock {
    origin: Instant,
}

impl Default for SystemClock {
    fn default() -> Self {
        Self {
            origin: Instant::now(),
        }
    }
}

impl Clock for SystemClock {
    fn unix_ms(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
            .unwrap_or(0)
    }

    fn mono_ms(&self) -> f64 {
        self.origin.elapsed().as_secs_f64() * 1000.0
    }
}

const MS_PER_DAY: i64 = 86_400_000;

/// The text `Date.prototype.toISOString` gives, so the Rust lines carry the same stamps as the Electron ones.
pub(crate) fn iso_ms(unix_ms: i64) -> String {
    let (year, month, day) = civil_from_days(unix_ms.div_euclid(MS_PER_DAY));
    let within_day = unix_ms.rem_euclid(MS_PER_DAY);
    let hours = within_day / 3_600_000;
    let minutes = within_day / 60_000 % 60;
    let seconds = within_day / 1_000 % 60;
    let millis = within_day % 1_000;
    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{millis:03}Z")
}

/// Days since 1970-01-01 to a proleptic Gregorian (year, month, day). Howard Hinnant's algorithm, no calendar crate needed.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::iso_ms;

    #[test]
    fn formats_known_instants_like_to_iso_string() {
        assert_eq!(iso_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_ms(1_700_000_000_123), "2023-11-14T22:13:20.123Z");
        assert_eq!(iso_ms(951_782_400_000), "2000-02-29T00:00:00.000Z");
        assert_eq!(iso_ms(1_767_225_600_123), "2026-01-01T00:00:00.123Z");
        assert_eq!(iso_ms(-1), "1969-12-31T23:59:59.999Z");
    }
}
