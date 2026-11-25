//! Where the pane sits and which of its tabs is on screen. Pure, so the rules Electron's
//! `browserPane.cjs` followed can be tested without a window.

use serde_json::Value;

/// The most tabs the pane keeps open.
pub const MAX_TABS: usize = 8;

/// A rectangle in logical window pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Rejects anything but a rectangle of finite numbers, then keeps it inside `limit`, as Electron did.
pub fn sanitise_bounds(raw: &Value, limit: (f64, f64)) -> Option<Bounds> {
    let object = raw.as_object()?;
    let mut values = [0.0; 4];
    for (slot, key) in values.iter_mut().zip(["x", "y", "width", "height"]) {
        let number = js_number(object.get(key)?)?;
        if !number.is_finite() {
            return None;
        }
        *slot = number.round().max(0.0);
    }
    let [x, y, width, height] = values;
    let left = x.min(limit.0);
    let top = y.min(limit.1);
    Some(Bounds {
        x: left,
        y: top,
        width: width.min(limit.0 - left),
        height: height.min(limit.1 - top),
    })
}

/// What `Number(value)` gives in the renderer: null is 0, booleans are 0 or 1, numeric text parses,
/// and anything else is NaN.
fn js_number(value: &Value) -> Option<f64> {
    match value {
        Value::Null => Some(0.0),
        Value::Bool(flag) => Some(if *flag { 1.0 } else { 0.0 }),
        Value::Number(number) => number.as_f64(),
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Some(0.0)
            } else {
                trimmed.parse::<f64>().ok()
            }
        }
        _ => None,
    }
}

/// Every open tab, one in front. The rest stay alive but hidden, as in Electron.
#[derive(Debug)]
pub struct Tabs<T> {
    views: Vec<T>,
    front: usize,
    visible: bool,
    bounds: Option<Bounds>,
}

impl<T> Default for Tabs<T> {
    fn default() -> Self {
        Self {
            views: Vec::new(),
            front: 0,
            visible: false,
            bounds: None,
        }
    }
}

impl<T> Tabs<T> {
    pub fn views(&self) -> &[T] {
        &self.views
    }

    pub fn front(&self) -> usize {
        self.front
    }

    pub fn current(&self) -> Option<&T> {
        self.views.get(self.front)
    }

    /// Adds a tab in front. Gives the tab back when the pane is full.
    pub fn open(&mut self, view: T) -> Result<usize, T> {
        if self.views.len() >= MAX_TABS {
            return Err(view);
        }
        self.views.push(view);
        self.front = self.views.len() - 1;
        Ok(self.front)
    }

    pub fn select(&mut self, at: usize) -> bool {
        if at >= self.views.len() {
            return false;
        }
        self.front = at;
        true
    }

    /// The last tab stays, so the pane always has a page to show.
    pub fn close(&mut self, at: usize) -> Option<T> {
        if at >= self.views.len() || self.views.len() == 1 {
            return None;
        }
        let gone = self.views.remove(at);
        if self.front >= at && self.front > 0 {
            self.front -= 1;
        }
        Some(gone)
    }

    pub fn set_visible(&mut self, on: bool) {
        self.visible = on;
    }

    /// Stores the sanitised rectangle. A zero-sized one hides the pane without losing it.
    pub fn set_bounds(&mut self, bounds: Bounds) {
        self.bounds = Some(bounds);
    }

    /// Whether the front page is on screen with a size, which is when input and screenshots mean
    /// something.
    pub fn shown(&self) -> bool {
        self.current().is_some()
            && self.visible
            && self.bounds.is_some_and(|b| b.width > 0.0 && b.height > 0.0)
    }

    /// Per tab, where it belongs: `Some` for the front tab while shown, `None` for every hidden one.
    pub fn layout(&self) -> Vec<Option<Bounds>> {
        let show = self.shown();
        (0..self.views.len())
            .map(|at| {
                if at == self.front && show {
                    self.bounds
                } else {
                    None
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const LIMIT: (f64, f64) = (1200.0, 800.0);

    #[test]
    fn bounds_are_rounded_and_clamped_into_the_window() {
        let raw = json!({ "x": 10.4, "y": 20.6, "width": 5000, "height": 300 });
        let got = sanitise_bounds(&raw, LIMIT).unwrap();
        assert_eq!(
            got,
            Bounds {
                x: 10.0,
                y: 21.0,
                width: 1190.0,
                height: 300.0
            }
        );
    }

    #[test]
    fn a_start_past_the_edge_is_pulled_back_to_it() {
        let raw = json!({ "x": 5000, "y": 900, "width": 10, "height": 10 });
        let got = sanitise_bounds(&raw, LIMIT).unwrap();
        assert_eq!(
            got,
            Bounds {
                x: 1200.0,
                y: 800.0,
                width: 0.0,
                height: 0.0
            }
        );
    }

    #[test]
    fn negative_values_become_zero_and_numeric_text_is_read() {
        let raw = json!({ "x": -4, "y": "12", "width": "", "height": null });
        let got = sanitise_bounds(&raw, LIMIT).unwrap();
        assert_eq!(
            got,
            Bounds {
                x: 0.0,
                y: 12.0,
                width: 0.0,
                height: 0.0
            }
        );
    }

    #[test]
    fn non_rectangles_are_rejected() {
        assert!(sanitise_bounds(&json!(null), LIMIT).is_none());
        assert!(sanitise_bounds(&json!([1, 2, 3, 4]), LIMIT).is_none());
        assert!(
            sanitise_bounds(
                &json!({ "x": 1, "y": 2, "width": "wide", "height": 3 }),
                LIMIT
            )
            .is_none()
        );
        assert!(sanitise_bounds(&json!({ "x": 1, "y": 2, "width": 3 }), LIMIT).is_none());
    }

    fn rect() -> Bounds {
        Bounds {
            x: 0.0,
            y: 48.0,
            width: 900.0,
            height: 600.0,
        }
    }

    #[test]
    fn only_the_front_tab_is_laid_out_and_only_when_shown() {
        let mut tabs: Tabs<&str> = Tabs::default();
        assert!(!tabs.shown());
        tabs.open("a").unwrap();
        tabs.open("b").unwrap();
        tabs.set_bounds(rect());
        assert_eq!(tabs.layout(), [None, None], "hidden until made visible");
        tabs.set_visible(true);
        assert_eq!(tabs.layout(), [None, Some(rect())]);
        assert!(tabs.select(0));
        assert_eq!(tabs.layout(), [Some(rect()), None]);
    }

    #[test]
    fn a_zero_sized_pane_is_not_shown() {
        let mut tabs: Tabs<&str> = Tabs::default();
        tabs.open("a").unwrap();
        tabs.set_visible(true);
        tabs.set_bounds(Bounds {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 10.0,
        });
        assert!(!tabs.shown());
        assert_eq!(tabs.layout(), [None]);
    }

    #[test]
    fn the_pane_holds_eight_tabs_and_the_ninth_is_given_back() {
        let mut tabs: Tabs<usize> = Tabs::default();
        for n in 0..MAX_TABS {
            tabs.open(n).unwrap();
        }
        assert_eq!(tabs.open(99), Err(99));
        assert_eq!(tabs.views().len(), MAX_TABS);
    }

    #[test]
    fn closing_keeps_the_front_pointing_at_a_page() {
        let mut tabs: Tabs<&str> = Tabs::default();
        tabs.open("a").unwrap();
        tabs.open("b").unwrap();
        tabs.open("c").unwrap();
        assert_eq!(tabs.front(), 2);
        assert_eq!(tabs.close(0), Some("a"));
        assert_eq!(tabs.front(), 1);
        assert_eq!(tabs.current(), Some(&"c"));
        assert_eq!(tabs.close(1), Some("c"));
        assert_eq!(tabs.front(), 0);
        assert_eq!(tabs.close(0), None, "the last tab stays");
        assert_eq!(tabs.close(5), None);
    }

    #[test]
    fn select_rejects_a_missing_index() {
        let mut tabs: Tabs<&str> = Tabs::default();
        tabs.open("a").unwrap();
        assert!(!tabs.select(1));
        assert_eq!(tabs.front(), 0);
    }
}
