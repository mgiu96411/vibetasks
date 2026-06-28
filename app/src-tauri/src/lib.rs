mod commands;
mod db;
mod geom;
mod models;

use commands::Db;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::open();

    let mut builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

    // Remember the window's size + position across launches (desktop only).
    // `skip_initial_state("main")` disables the plugin's own auto-restore on
    // window creation (which is unreliable for a config-declared window and can
    // flash the window at the wrong size). We restore explicitly in `setup`
    // below, then show the (config: visible:false) window once it's sized.
    #[cfg(desktop)]
    {
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::default()
                .skip_initial_state("main")
                .build(),
        );
    }

    builder
        .manage(Db(Mutex::new(conn)))
        .setup(|app| {
            // The "main" window is NOT declared in tauri.conf.json: we build it
            // here so it is *born* at the restored geometry. A config-declared
            // window is created at its config size (1280x820) on whatever monitor
            // the OS picks, and our restore's `set_size`/`set_position` only apply
            // a tick later — so the window would visibly flash at the wrong
            // place/size before snapping into position. Building it hidden, at the
            // correct geometry, then showing it once is flash-free.
            let mut builder =
                tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                    .title("Vibe Tasks")
                    .min_inner_size(820.0, 560.0)
                    .visible(false);

            // The saved frame to build at (logical points), or `None` to open at
            // the default centered size.
            let placement: Option<Placement> = {
                #[cfg(desktop)]
                {
                    let monitors: Vec<(geom::Rect, f64)> = app
                        .available_monitors()
                        .map(|ms| {
                            ms.iter()
                                .map(|m| (monitor_rect(m), m.scale_factor()))
                                .collect()
                        })
                        .unwrap_or_default();
                    saved_logical_placement(app.handle(), &monitors)
                }
                #[cfg(not(desktop))]
                {
                    None
                }
            };

            builder = match placement {
                Some(p) => builder
                    .inner_size(p.w, p.h)
                    .position(p.x, p.y)
                    .maximized(p.maximized),
                // No saved frame (or its monitor is gone) — open at the default
                // size, centered on the primary monitor.
                None => builder.inner_size(1280.0, 820.0).center(),
            };

            let w = builder.build().expect("failed to create main window");

            #[cfg(desktop)]
            {
                // Safety net for a frame that still lands off-screen/oversized
                // (e.g. an in-between monitor layout). Reads are accurate here
                // because the geometry was applied at window creation.
                ensure_window_on_screen(&w);
            }

            // The window is born hidden and stays hidden until the frontend has
            // painted its first frame (it calls the `show_main_window` command) —
            // otherwise the correctly-sized window would flash *blank* for a frame
            // while the webview bundle loads and React mounts. A fallback timer
            // reveals it anyway if the frontend never calls (JS error, etc.) so
            // the app can never get stuck invisible.
            {
                let wc = w.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(4000));
                    if !wc.is_visible().unwrap_or(true) {
                        let _ = wc.show();
                        let _ = wc.set_focus();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::get_data_version,
            commands::create_space,
            commands::rename_space,
            commands::delete_space,
            commands::reorder_spaces,
            commands::move_project_to_space,
            commands::create_project,
            commands::rename_project,
            commands::delete_project,
            commands::set_project_repo_path,
            commands::start_task,
            commands::open_claude,
            commands::detect_terminals,
            commands::show_main_window,
            commands::add_task,
            commands::update_task,
            commands::move_task,
            commands::reorder_tasks,
            commands::delete_task,
            commands::add_subtask,
            commands::set_refs,
            commands::link_tasks,
            commands::unlink_tasks,
            commands::add_todo,
            commands::toggle_todo,
            commands::update_todo,
            commands::delete_todo,
            commands::set_notes,
            commands::set_goal,
            commands::set_guardrails,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Bridge the just-restored native window geometry through the pure
/// [`geom::corrected_window_rect`] policy and apply any correction.
#[cfg(desktop)]
fn ensure_window_on_screen<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let Ok(monitors) = window.available_monitors() else {
        return;
    };
    if monitors.is_empty() {
        return;
    }
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };

    // Primary monitor first, so geom uses it as the off-screen fallback.
    let mut rects: Vec<geom::Rect> = Vec::with_capacity(monitors.len());
    if let Ok(Some(primary)) = window.primary_monitor() {
        rects.push(monitor_rect(&primary));
    }
    for m in &monitors {
        let r = monitor_rect(m);
        if !rects.contains(&r) {
            rects.push(r);
        }
    }

    let win = geom::Rect::new(pos.x, pos.y, size.width as i32, size.height as i32);
    if let Some(fixed) = geom::corrected_window_rect(win, &rects) {
        // A maximized window ignores set_size/set_position; and if it was maximized
        // onto a now-disconnected monitor it lands off-screen ("launches without
        // showing"). Drop maximize first, then place it on a connected monitor.
        // (The caller shows + focuses the window afterwards.)
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        }
        let _ = window.set_size(tauri::PhysicalSize::new(fixed.w as u32, fixed.h as u32));
        let _ = window.set_position(tauri::PhysicalPosition::new(fixed.x, fixed.y));
    }
}

#[cfg(desktop)]
fn monitor_rect(m: &tauri::Monitor) -> geom::Rect {
    let p = m.position();
    let s = m.size();
    geom::Rect::new(p.x, p.y, s.width as i32, s.height as i32)
}

/// A window frame to create the main window at, in LOGICAL points.
#[cfg_attr(not(desktop), allow(dead_code))]
struct Placement {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    maximized: bool,
}

/// Read the saved window frame from `tauri-plugin-window-state`'s state file and
/// turn it into a LOGICAL [`Placement`] the window can be *built* at, so the
/// window is born at the right geometry (no restore-then-snap flash).
///
/// We read the file ourselves rather than using the plugin's `restore_state`:
/// the plugin's in-memory cache is clobbered with the window's creation-time
/// geometry by its own `Resized`/`Moved` handlers, and it stores PHYSICAL px,
/// which mis-scale when re-applied across a scale-factor boundary. The file is
/// the source of truth. Stored values are PHYSICAL px relative to the monitor
/// the window occupied at save time; Cocoa is natively points-based and keeps a
/// window's point geometry stable across monitors, so we divide the saved frame
/// by the scale of the monitor that owned it (via [`geom::scale_at_point`]) to
/// get logical points — otherwise a frame saved on a Retina (2x) display would
/// open half-size on a 1x display (and vice-versa).
///
/// Returns `None` (→ caller opens at the default centered size) when there is no
/// saved frame or its monitor is gone, so we never build the window off-screen.
#[cfg(desktop)]
fn saved_logical_placement<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    monitors: &[(geom::Rect, f64)],
) -> Option<Placement> {
    use tauri::Manager;

    let dir = app.path().app_config_dir().ok()?;
    // Matches the plugin's DEFAULT_FILENAME (we don't override it).
    let text = std::fs::read_to_string(dir.join(".window-state.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    let s = json.get("main")?;

    let get_i = |k: &str| s.get(k).and_then(|v| v.as_i64());
    let maximized = s
        .get("maximized")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // The plugin keeps `width`/`height` as the *non-maximized* frame and, while
    // maximized, stores the pre-maximize origin in `prev_x`/`prev_y`. Build at
    // that underlying frame and let `.maximized(true)` re-maximize it.
    let (px, py) = if maximized {
        (get_i("prev_x")?, get_i("prev_y")?)
    } else {
        (get_i("x")?, get_i("y")?)
    };
    let (pw, ph) = (get_i("width")?, get_i("height")?);
    if pw <= 0 || ph <= 0 {
        return None;
    }

    // `None` here means the saved monitor is gone (layout changed) — bail so the
    // caller opens centered at the default size instead of off-screen.
    let scale = geom::scale_at_point(px as i32, py as i32, monitors)?;

    Some(Placement {
        x: px as f64 / scale,
        y: py as f64 / scale,
        w: pw as f64 / scale,
        h: ph as f64 / scale,
        maximized,
    })
}
