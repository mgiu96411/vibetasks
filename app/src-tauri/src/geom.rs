//! Pure window-geometry policy, kept free of Tauri types so it can be unit-tested.
//!
//! `tauri-plugin-window-state` restores a window's SIZE unconditionally but only
//! restores its POSITION when the saved frame still intersects a connected
//! monitor (see the plugin's `restore_state`). When the saved geometry is stale
//! — a different/disconnected monitor layout — you get the old (often oversized)
//! size dropped at an arbitrary spot, leaving the window mostly off-screen.
//!
//! [`corrected_window_rect`] detects that situation and returns a frame that is
//! guaranteed to fit on, and sit on, a currently-connected monitor.

/// A rectangle in physical pixels, top-left origin (matches Tauri monitor coords).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn new(x: i32, y: i32, w: i32, h: i32) -> Self {
        Self { x, y, w, h }
    }
}

/// Overlap area (px²) between two rectangles; 0 if they don't intersect.
fn overlap_area(a: Rect, b: Rect) -> i64 {
    let l = a.x.max(b.x);
    let t = a.y.max(b.y);
    let r = (a.x + a.w).min(b.x + b.w);
    let bo = (a.y + a.h).min(b.y + b.h);
    ((r - l).max(0) as i64) * ((bo - t).max(0) as i64)
}

/// Is the window's top-left corner (its title bar) inside some monitor, i.e.
/// reachable so the user can drag it?
fn corner_reachable(win: Rect, monitors: &[Rect]) -> bool {
    monitors
        .iter()
        .any(|m| win.x >= m.x && win.x < m.x + m.w && win.y >= m.y && win.y < m.y + m.h)
}

/// Given the just-restored window frame and the currently-available monitors
/// (physical px; the first entry should be the primary monitor), return a
/// corrected frame, or `None` when the window is already fine.
///
/// A correction is made when the window is larger than the monitor it lives on,
/// or when its title bar isn't on any monitor. The corrected window is clamped
/// to the target monitor and centered on it.
pub fn corrected_window_rect(win: Rect, monitors: &[Rect]) -> Option<Rect> {
    if monitors.is_empty() {
        return None;
    }

    let on_a_monitor = monitors.iter().any(|m| overlap_area(win, *m) > 0);

    // Live on the monitor we overlap most; if stranded, fall back to primary.
    let target = if on_a_monitor {
        *monitors
            .iter()
            .max_by_key(|m| overlap_area(win, **m))
            .unwrap()
    } else {
        monitors[0]
    };

    // Clamp the window to fit the target monitor.
    let w = win.w.min(target.w);
    let h = win.h.min(target.h);

    let needs_fix = w != win.w || h != win.h || !corner_reachable(win, monitors);
    if !needs_fix {
        return None;
    }

    // Center the (possibly clamped) window on the target monitor.
    let x = target.x + ((target.w - w) / 2).max(0);
    let y = target.y + ((target.h - h) / 2).max(0);
    Some(Rect::new(x, y, w, h))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Three-monitor layout (primary first), physical px.
    fn monitors() -> Vec<Rect> {
        vec![
            Rect::new(0, 0, 2560, 1440),     // primary
            Rect::new(2560, 0, 1920, 1080),  // right
            Rect::new(-1728, 0, 3456, 2234), // retina to the left
        ]
    }

    #[test]
    fn corrects_the_real_off_screen_oversized_frame() {
        // The exact corrupt state observed: 5252x2068 at (-2272, 2528).
        let bad = Rect::new(-2272, 2528, 5252, 2068);
        let fixed = corrected_window_rect(bad, &monitors())
            .expect("an off-screen oversized window must be corrected");

        // Fits within the primary monitor...
        let primary = monitors()[0];
        assert!(
            fixed.w <= primary.w && fixed.h <= primary.h,
            "must be clamped to fit"
        );
        // ...and its title bar lands on a monitor.
        assert!(corner_reachable(fixed, &monitors()), "corner must be reachable");
    }

    #[test]
    fn leaves_a_healthy_window_untouched() {
        // A normal 1280x820 window comfortably inside the primary monitor.
        let ok = Rect::new(100, 100, 1280, 820);
        assert_eq!(corrected_window_rect(ok, &monitors()), None);
    }

    #[test]
    fn clamps_an_oversized_but_on_screen_window() {
        // Overlaps the primary monitor but is bigger than it.
        let big = Rect::new(0, 0, 3000, 1500);
        let fixed = corrected_window_rect(big, &monitors()).expect("oversized must be clamped");
        assert_eq!(fixed.w, 2560);
        assert_eq!(fixed.h, 1440);
        assert_eq!((fixed.x, fixed.y), (0, 0)); // centered on primary
    }

    #[test]
    fn recenters_a_window_whose_titlebar_is_off_screen() {
        // Right-sized, but the title bar sits in the dead space below all monitors.
        let stranded = Rect::new(100, 5000, 1280, 820);
        let fixed = corrected_window_rect(stranded, &monitors())
            .expect("a stranded window must be recentered");
        assert!(corner_reachable(fixed, &monitors()));
    }

    #[test]
    fn no_monitors_means_no_change() {
        let win = Rect::new(-2272, 2528, 5252, 2068);
        assert_eq!(corrected_window_rect(win, &[]), None);
    }
}
