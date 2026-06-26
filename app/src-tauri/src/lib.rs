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
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .manage(Db(Mutex::new(conn)))
        .setup(|app| {
            // Explicitly restore the saved window size/position once the window
            // exists. The plugin's own on_window_ready restore is unreliable for a
            // window declared in tauri.conf.json; restoring here makes size restore
            // reliably (position restores when the saved coords are on a connected monitor).
            #[cfg(desktop)]
            {
                use tauri::Manager;
                use tauri_plugin_window_state::{StateFlags, WindowExt};
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.restore_state(StateFlags::all());
                    // The plugin restores SIZE unconditionally but only restores
                    // POSITION when the saved frame still hits a connected monitor,
                    // so a stale multi-monitor layout can leave an oversized window
                    // stranded off-screen. Clamp + recenter onto a live monitor.
                    ensure_window_on_screen(&w);
                }
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
        // showing"). Drop maximize first, then place it on a connected monitor and
        // make sure it's actually shown + focused.
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        }
        let _ = window.set_size(tauri::PhysicalSize::new(fixed.w as u32, fixed.h as u32));
        let _ = window.set_position(tauri::PhysicalPosition::new(fixed.x, fixed.y));
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn monitor_rect(m: &tauri::Monitor) -> geom::Rect {
    let p = m.position();
    let s = m.size();
    geom::Rect::new(p.x, p.y, s.width as i32, s.height as i32)
}
